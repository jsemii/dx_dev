from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.config import ReportProfile, Settings, get_settings
from app.models import DailyReport, GenerationSnapshot, PreparedReport, ReportInputs
from app.openai_report import generate_summary
from app.pattern_service import (
    CARE_SOURCE_CODES,
    LIFE_METRIC_CODES,
    VALID_DAY_POLICY,
    calculate_life_pattern,
    calculate_retrospective_pattern,
)
from app.prompt_builder import build_summary_input
from app.report_repository import (
    commit_report_migration,
    find_stored_report,
    find_stored_report_with_connection,
    insert_prepared_report,
    load_generation_snapshot,
    load_report_from_database,
    load_report_inputs_with_connection,
    parse_report_date,
    report_creation_lock,
    resolve_single_resident,
)
from app.report_rules import (
    build_confirmed_facts,
    build_highlights,
    build_report_content,
    build_timeline,
    fallback_summary,
)


SummaryGenerator = Callable[[dict, Settings], str]
SEOUL = ZoneInfo("Asia/Seoul")


def validate_lookup_date_policy(selected_date: date) -> None:
    today = datetime.now(SEOUL).date()
    if selected_date > today:
        raise ValueError("미래 날짜의 데일리 리포트는 조회할 수 없습니다.")


def validate_generation_date_policy(selected_date: date) -> None:
    today = datetime.now(SEOUL).date()
    if selected_date >= today:
        raise ValueError("오늘 또는 미래 날짜의 데일리 리포트는 생성할 수 없습니다.")


# 기존 내부 호출과 테스트의 호환성을 유지하되 생성 정책을 적용한다.
validate_date_policy = validate_generation_date_policy


def _validate_daily_metrics(records: list[dict]) -> None:
    codes = [str(row["metric_code"]) for row in records if row["record_type"] == "metric"]
    missing = sorted(set(LIFE_METRIC_CODES) - set(codes))
    duplicated = sorted(code for code in LIFE_METRIC_CODES if codes.count(code) > 1)
    present_care = set(codes) & set(CARE_SOURCE_CODES)
    incomplete_care = sorted(set(CARE_SOURCE_CODES) - present_care) if present_care else []
    if missing or duplicated or incomplete_care:
        raise ValueError(
            "일일 metric 구성이 잘못됐습니다. "
            f"missing={missing}, duplicated={duplicated}, care_missing={incomplete_care}"
        )


def _baseline(inputs: ReportInputs) -> tuple[str, date | None, object]:
    selected_date = inputs.report_date
    prior_date = selected_date - timedelta(days=1)
    if selected_date < inputs.life_pattern.observation_start_date:
        pattern = calculate_retrospective_pattern(
            inputs.life_pattern, inputs.metric_history, prior_date
        )
        available_dates = [
            row["data_date"]
            for row in inputs.metric_history
            if row["data_date"] < selected_date
            and row.get("metric_code") in LIFE_METRIC_CODES
        ]
        return "RETROSPECTIVE", max(available_dates, default=None), pattern
    pattern = calculate_life_pattern(
        inputs.life_pattern, inputs.metric_history, prior_date
    )
    return "SERVICE_PATTERN", prior_date, pattern


def _prepare_one(
    inputs: ReportInputs,
    settings: Settings,
    summary_generator: SummaryGenerator,
    report_id=None,
) -> PreparedReport:
    _validate_daily_metrics(inputs.daily_records)
    household_types = {str(row["household_type"]) for row in inputs.daily_records}
    resident_ids = {str(row["resident_thinq_id"]) for row in inputs.daily_records}
    if len(household_types) != 1 or resident_ids != {inputs.resident_thinq_id}:
        raise ValueError("리포트 원천 데이터의 소유자 또는 가구 유형이 일관되지 않습니다.")

    source, baseline_as_of, pattern = _baseline(inputs)
    baseline_pattern = {
        "baseline_source": source,
        "valid_day_policy": VALID_DAY_POLICY,
        "baseline_as_of_date": None if baseline_as_of is None else baseline_as_of.isoformat(),
        "baseline_days": pattern.valid_day_count,
        "metrics": pattern.standard_pattern,
    }
    timeline = build_timeline(inputs.daily_records)
    highlights = build_highlights(inputs.daily_records, pattern.standard_pattern)
    facts = build_confirmed_facts(inputs.daily_records, timeline, highlights)
    try:
        summary = summary_generator(
            build_summary_input(inputs.report_date.isoformat(), facts), settings
        )
    except Exception:
        summary = fallback_summary(facts)
    content = build_report_content(summary, timeline, highlights)
    return PreparedReport(
        report_id=report_id or uuid4(),
        resident_thinq_id=inputs.resident_thinq_id,
        report_date=inputs.report_date,
        baseline_pattern=baseline_pattern,
        content=content,
        next_life_pattern=pattern,
        household_type=next(iter(household_types)),
        row_count=len(inputs.daily_records),
        event_count=sum(row["record_type"] == "event" for row in inputs.daily_records),
        metric_count=sum(row["record_type"] == "metric" for row in inputs.daily_records),
    )


def create_report_if_absent(
    profile: ReportProfile,
    resident_thinq_id: str,
    report_date: str,
    settings: Settings | None = None,
    summary_generator: SummaryGenerator = generate_summary,
) -> DailyReport:
    active_settings = settings or get_settings()
    selected_date = parse_report_date(report_date)
    validate_generation_date_policy(selected_date)
    if find_stored_report(resident_thinq_id, report_date, active_settings) is not None:
        return load_report_from_database(profile, resident_thinq_id, report_date, active_settings)

    with report_creation_lock(resident_thinq_id, selected_date, active_settings) as connection:
        if find_stored_report_with_connection(connection, resident_thinq_id, selected_date):
            connection.commit()
        else:
            inputs = load_report_inputs_with_connection(
                connection, profile, resident_thinq_id, selected_date
            )
            connection.commit()
            prepared = _prepare_one(inputs, active_settings, summary_generator)
            insert_prepared_report(
                connection, prepared, inputs.fingerprint, profile
            )
    return load_report_from_database(profile, resident_thinq_id, report_date, active_settings)


def prepare_report_migration(
    snapshot: GenerationSnapshot,
    settings: Settings | None = None,
    summary_generator: SummaryGenerator = generate_summary,
) -> list[PreparedReport]:
    active_settings = settings or get_settings()
    prepared: list[PreparedReport] = []
    selected_date = snapshot.start_date
    while selected_date <= snapshot.end_date:
        inputs = ReportInputs(
            resident_thinq_id=snapshot.resident_thinq_id,
            profile=snapshot.profile,
            report_date=selected_date,
            life_pattern=snapshot.life_pattern,
            daily_records=snapshot.records_by_date[selected_date],
            metric_history=snapshot.metric_history,
            fingerprint=snapshot.fingerprint,
        )
        prepared.append(
            _prepare_one(
                inputs,
                active_settings,
                summary_generator,
                snapshot.reports_by_date[selected_date].report_id,
            )
        )
        selected_date += timedelta(days=1)
    return prepared


def migrate_report_range(
    profile: ReportProfile,
    resident_thinq_id: str,
    start_date: str,
    end_date: str,
    settings: Settings | None = None,
    summary_generator: SummaryGenerator = generate_summary,
) -> list[PreparedReport]:
    active_settings = settings or get_settings()
    snapshot = load_generation_snapshot(
        profile, resident_thinq_id, parse_report_date(start_date),
        parse_report_date(end_date), active_settings
    )
    if any(
        report.baseline_pattern.get("valid_day_policy") == VALID_DAY_POLICY
        for report in snapshot.reports_by_date.values()
    ):
        raise RuntimeError("이미 현재 유효일 정책으로 정정된 리포트가 있습니다.")
    if snapshot.life_pattern.as_of_date is None:
        raise ValueError("현재 life_pattern의 as_of_date가 없습니다.")
    corrected_life_pattern = calculate_life_pattern(
        snapshot.life_pattern,
        snapshot.metric_history,
        snapshot.life_pattern.as_of_date,
    )
    prepared = prepare_report_migration(snapshot, active_settings, summary_generator)
    commit_report_migration(
        snapshot,
        prepared,
        corrected_life_pattern,
        active_settings,
    )
    return prepared


def create_daily_report(
    profile: ReportProfile,
    report_date: str,
    settings: Settings | None = None,
    force: bool = False,
    save_output: bool = True,
    resident_thinq_id: str | None = None,
) -> tuple[DailyReport, Path | None]:
    active_settings = settings or get_settings()
    resident_id = resident_thinq_id or resolve_single_resident(
        profile, report_date, active_settings
    )
    report = create_report_if_absent(
        profile, resident_id, report_date, active_settings
    )
    return report, None
