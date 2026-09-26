from __future__ import annotations

from dataclasses import asdict, is_dataclass
from contextlib import contextmanager
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import hashlib
import json
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.types.json import Jsonb

from app.config import ReportProfile, Settings, get_settings
from app.db import database_connection
from app.models import (
    DailyReport,
    GenerationSnapshot,
    LifePatternState,
    PreparedReport,
    ReportContent,
    ReportSource,
    ReportInputs,
    StoredReport,
)
from app.pattern_service import LIFE_METRIC_CODES, VALID_DAY_POLICY


REPORTING_TABLE = "public.reporting_data"
HOUSEHOLD_TYPE_BY_PROFILE: dict[ReportProfile, str] = {
    "one_person": "one_person",
    "two_to_three": "two_to_three_person",
}

SELECT_COLUMNS = (
    "reporting_id",
    "resident_thinq_id",
    "household_type",
    "data_date",
    "event_time",
    "record_type",
    "subject_type",
    "subject",
    "metric_code",
    "value",
    "unit",
    "baseline_value",
    "delta_value",
    "baseline_days",
    "data_status",
    "evidence",
)


def parse_report_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"날짜 형식이 올바르지 않습니다: {value}") from exc


def table_name_for_profile(profile: ReportProfile) -> str:
    # profile은 API 호환성을 위해 유지하지만, 데이터는 통합 테이블에서 조회한다.
    HOUSEHOLD_TYPE_BY_PROFILE[profile]
    return REPORTING_TABLE


def _date_range(start_date: date, end_date: date) -> list[date]:
    if start_date > end_date:
        raise ValueError("시작일은 종료일보다 늦을 수 없습니다.")
    return [
        start_date + timedelta(days=offset)
        for offset in range((end_date - start_date).days + 1)
    ]


def resolve_single_resident(
    profile: ReportProfile,
    report_date: str,
    settings: Settings | None = None,
) -> str:
    """현재 요청 형식에 home_id가 없을 때 단일 생활자만 안전하게 선택한다."""
    selected_date = parse_report_date(report_date)
    household_type = HOUSEHOLD_TYPE_BY_PROFILE[profile]
    with database_connection(settings or get_settings()) as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT resident_thinq_id
            FROM public.reporting_data
            WHERE household_type = %s AND data_date = %s
            ORDER BY resident_thinq_id
            """,
            (household_type, selected_date),
        ).fetchall()
    if len(rows) != 1:
        raise ValueError(
            "home_id가 없고 해당 profile/date의 생활자가 정확히 한 명이 아닙니다."
        )
    return str(rows[0]["resident_thinq_id"])


def _load_daily_records_with_connection(
    connection: Connection,
    profile: ReportProfile,
    resident_thinq_id: str,
    selected_date: date,
) -> list[dict[str, Any]]:
    household_type = HOUSEHOLD_TYPE_BY_PROFILE[profile]
    rows = connection.execute(
        f"""
        SELECT {", ".join(SELECT_COLUMNS)}
        FROM public.reporting_data
        WHERE resident_thinq_id = %s
          AND data_date = %s
          AND household_type = %s
        ORDER BY event_time NULLS LAST, record_type, metric_code, reporting_id
        """,
        (resident_thinq_id, selected_date, household_type),
    ).fetchall()
    records = [dict(row) for row in rows]
    if not records:
        raise ValueError(
            f"resident={resident_thinq_id}, date={selected_date.isoformat()} 데이터가 없습니다."
        )
    return records


def load_daily_records(
    profile: ReportProfile,
    report_date: str,
    settings: Settings | None = None,
    resident_thinq_id: str | None = None,
) -> list[dict[str, Any]]:
    selected_date = parse_report_date(report_date)
    active_settings = settings or get_settings()
    resident_id = resident_thinq_id or resolve_single_resident(
        profile, report_date, active_settings
    )
    with database_connection(active_settings) as connection:
        return _load_daily_records_with_connection(
            connection, profile, resident_id, selected_date
        )


def _life_pattern_from_row(row: dict[str, Any]) -> LifePatternState:
    return LifePatternState(
        resident_thinq_id=str(row["resident_thinq_id"]),
        observation_start_date=row["observation_start_date"],
        initial_wake_time=row["initial_wake_time"],
        initial_sleep_time=row["initial_sleep_time"],
        initial_breakfast_time=row["initial_breakfast_time"],
        initial_lunch_time=row["initial_lunch_time"],
        initial_dinner_time=row["initial_dinner_time"],
        valid_day_count=int(row["valid_day_count"]),
        observed_pattern=dict(row["observed_pattern"]),
        standard_pattern=dict(row["standard_pattern"]),
        as_of_date=row["as_of_date"],
    )


def _stored_report_from_row(row: dict[str, Any]) -> StoredReport:
    return StoredReport(
        report_id=row["report_id"],
        resident_thinq_id=str(row["resident_thinq_id"]),
        report_date=row["report_date"],
        baseline_pattern=dict(row["baseline_pattern"]),
        summary=str(row["summary"]),
        timeline=list(row["timeline"]),
        highlights=list(row["highlights"]),
    )


def _json_default(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, (date, datetime, time, Decimal, UUID)):
        return str(value)
    raise TypeError(f"직렬화할 수 없는 값입니다: {type(value).__name__}")


def _canonical(value: Any) -> Any:
    if is_dataclass(value):
        return _canonical(asdict(value))
    if isinstance(value, dict):
        return {str(key): _canonical(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical(item) for item in value]
    if isinstance(value, (date, datetime, time, Decimal, UUID)):
        return str(value)
    return value


def _snapshot_fingerprint(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        _canonical(payload),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=_json_default,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_generation_snapshot_with_connection(
    connection: Connection,
    profile: ReportProfile,
    resident_thinq_id: str,
    start_date: date,
    end_date: date,
) -> GenerationSnapshot:
    dates = _date_range(start_date, end_date)
    life_row = connection.execute(
        "SELECT * FROM public.life_pattern WHERE resident_thinq_id = %s",
        (resident_thinq_id,),
    ).fetchone()
    if life_row is None:
        raise ValueError(f"{resident_thinq_id}의 life_pattern이 없습니다.")
    life_pattern = _life_pattern_from_row(dict(life_row))

    records_by_date = {
        selected_date: _load_daily_records_with_connection(
            connection, profile, resident_thinq_id, selected_date
        )
        for selected_date in dates
    }

    metric_history = [
        dict(row)
        for row in connection.execute(
            """
            SELECT reporting_id, resident_thinq_id, household_type, data_date,
                   subject_type, subject, metric_code, value, unit
            FROM public.reporting_data
            WHERE resident_thinq_id = %s
              AND data_date <= %s
              AND record_type = 'metric'
            ORDER BY data_date, metric_code, reporting_id
            """,
            (resident_thinq_id, end_date),
        ).fetchall()
    ]

    report_rows = connection.execute(
        """
        SELECT report_id, resident_thinq_id, report_date, baseline_pattern,
               summary, timeline, highlights
        FROM public.daily_report
        WHERE resident_thinq_id = %s
          AND report_date BETWEEN %s AND %s
        ORDER BY report_date
        """,
        (resident_thinq_id, start_date, end_date),
    ).fetchall()
    reports_by_date = {
        row["report_date"]: _stored_report_from_row(dict(row)) for row in report_rows
    }
    if len(report_rows) != len(dates) or set(reports_by_date) != set(dates):
        raise ValueError("대상 날짜마다 기존 daily_report가 정확히 한 행씩 있어야 합니다.")

    share_rows = connection.execute(
        """
        SELECT d.report_id, count(s.report_id) AS share_count
        FROM public.daily_report d
        LEFT JOIN public.report_share s ON s.report_id = d.report_id
        WHERE d.resident_thinq_id = %s
          AND d.report_date BETWEEN %s AND %s
        GROUP BY d.report_id
        ORDER BY d.report_id
        """,
        (resident_thinq_id, start_date, end_date),
    ).fetchall()
    share_counts = {row["report_id"]: int(row["share_count"]) for row in share_rows}

    fingerprint_payload = {
        "life_pattern": life_pattern,
        "records_by_date": records_by_date,
        "metric_history": metric_history,
        "reports_by_date": reports_by_date,
        "share_counts": share_counts,
    }
    return GenerationSnapshot(
        resident_thinq_id=resident_thinq_id,
        profile=profile,
        start_date=start_date,
        end_date=end_date,
        life_pattern=life_pattern,
        records_by_date=records_by_date,
        metric_history=metric_history,
        reports_by_date=reports_by_date,
        share_counts=share_counts,
        fingerprint=_snapshot_fingerprint(fingerprint_payload),
    )


def load_generation_snapshot(
    profile: ReportProfile,
    resident_thinq_id: str,
    start_date: date,
    end_date: date,
    settings: Settings | None = None,
) -> GenerationSnapshot:
    with database_connection(settings or get_settings()) as connection:
        connection.execute(
            "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
        )
        return _load_generation_snapshot_with_connection(
            connection, profile, resident_thinq_id, start_date, end_date
        )


def commit_prepared_reports(
    snapshot: GenerationSnapshot,
    prepared_reports: list[PreparedReport],
    settings: Settings | None = None,
) -> None:
    if not prepared_reports:
        raise ValueError("저장할 리포트가 없습니다.")
    expected_dates = _date_range(snapshot.start_date, snapshot.end_date)
    if [item.report_date for item in prepared_reports] != expected_dates:
        raise ValueError("저장 리포트가 대상 날짜 전체와 순서대로 일치하지 않습니다.")
    if any(
        item.report_id != snapshot.reports_by_date[item.report_date].report_id
        for item in prepared_reports
    ):
        raise ValueError("기존 report_id가 변경된 리포트는 저장할 수 없습니다.")
    active_settings = settings or get_settings()
    with database_connection(active_settings) as connection:
        try:
            connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            connection.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (snapshot.resident_thinq_id,),
            )
            current = _load_generation_snapshot_with_connection(
                connection,
                snapshot.profile,
                snapshot.resident_thinq_id,
                snapshot.start_date,
                snapshot.end_date,
            )
            if current.fingerprint != snapshot.fingerprint:
                raise RuntimeError("생성 준비 후 입력 DB 상태가 변경됐습니다.")

            expected_as_of = snapshot.start_date - timedelta(days=1)
            for prepared in prepared_reports:
                if prepared.resident_thinq_id != snapshot.resident_thinq_id:
                    raise ValueError("다른 생활자의 리포트를 함께 저장할 수 없습니다.")
                if expected_as_of != prepared.report_date - timedelta(days=1):
                    raise ValueError("날짜별 life_pattern 갱신 순서가 올바르지 않습니다.")
                result = connection.execute(
                    """
                    UPDATE public.daily_report
                    SET baseline_pattern = %s,
                        summary = %s,
                        timeline = %s,
                        highlights = %s
                    WHERE report_id = %s
                      AND resident_thinq_id = %s
                      AND report_date = %s
                    """,
                    (
                        Jsonb(prepared.baseline_pattern),
                        prepared.content.summary,
                        Jsonb([item.model_dump() for item in prepared.content.timeline]),
                        Jsonb([item.model_dump() for item in prepared.content.highlights]),
                        prepared.report_id,
                        prepared.resident_thinq_id,
                        prepared.report_date,
                    ),
                )
                if result.rowcount != 1:
                    raise RuntimeError("daily_report UPDATE 대상이 정확히 한 행이 아닙니다.")

                expected_as_of = prepared.next_life_pattern.as_of_date

            final_pattern = prepared_reports[-1].next_life_pattern
            result = connection.execute(
                """
                UPDATE public.life_pattern
                SET valid_day_count = %s,
                    observed_pattern = %s,
                    standard_pattern = %s,
                    as_of_date = %s
                WHERE resident_thinq_id = %s
                  AND as_of_date IS NOT DISTINCT FROM %s
                """,
                (
                    final_pattern.valid_day_count,
                    Jsonb(final_pattern.observed_pattern),
                    Jsonb(final_pattern.standard_pattern),
                    final_pattern.as_of_date,
                    snapshot.resident_thinq_id,
                    snapshot.life_pattern.as_of_date,
                ),
            )
            if result.rowcount != 1:
                raise RuntimeError("최종 life_pattern UPDATE에 실패했습니다.")

            shares_after = {
                row["report_id"]: int(row["share_count"])
                for row in connection.execute(
                    """
                    SELECT d.report_id, count(s.report_id) AS share_count
                    FROM public.daily_report d
                    LEFT JOIN public.report_share s ON s.report_id = d.report_id
                    WHERE d.resident_thinq_id = %s
                      AND d.report_date BETWEEN %s AND %s
                    GROUP BY d.report_id
                    """,
                    (
                        snapshot.resident_thinq_id,
                        snapshot.start_date,
                        snapshot.end_date,
                    ),
                ).fetchall()
            }
            if shares_after != snapshot.share_counts:
                raise RuntimeError("report_share 관계가 변경됐습니다.")
            connection.commit()
        except Exception:
            connection.rollback()
            raise


def load_report_from_database(
    profile: ReportProfile,
    resident_thinq_id: str,
    report_date: str,
    settings: Settings | None = None,
) -> DailyReport:
    selected_date = parse_report_date(report_date)
    active_settings = settings or get_settings()
    with database_connection(active_settings) as connection:
        row = connection.execute(
            """
            SELECT report_id, resident_thinq_id, report_date,
                   baseline_pattern, summary, timeline, highlights
            FROM public.daily_report
            WHERE resident_thinq_id = %s AND report_date = %s
            """,
            (resident_thinq_id, selected_date),
        ).fetchone()
        if row is None:
            raise FileNotFoundError("저장된 데일리 리포트가 없습니다.")
        counts = connection.execute(
            """
            SELECT count(*) AS row_count,
                   count(*) FILTER (WHERE record_type = 'event') AS event_count,
                   count(*) FILTER (WHERE record_type = 'metric') AS metric_count,
                   min(household_type) AS household_type,
                   count(DISTINCT household_type) AS household_type_count
            FROM public.reporting_data
            WHERE resident_thinq_id = %s AND data_date = %s
            """,
            (resident_thinq_id, selected_date),
        ).fetchone()
    if not counts or counts["row_count"] == 0:
        raise ValueError("리포트 원천 데이터가 없습니다.")
    if counts["household_type_count"] != 1:
        raise ValueError("생활자 하루 데이터의 가구 유형이 일관되지 않습니다.")
    if counts["household_type"] != HOUSEHOLD_TYPE_BY_PROFILE[profile]:
        raise ValueError("요청 profile과 생활자의 가구 유형이 다릅니다.")

    timeline = list(row["timeline"])
    highlights = list(row["highlights"])
    severity_order = {"normal": 0, "notice": 1, "attention": 2}
    severities = [
        str(item.get("severity", "normal")) for item in timeline + highlights
    ]
    overall_status = max(
        severities or ["normal"], key=lambda value: severity_order.get(value, 0)
    )
    content = ReportContent.model_validate(
        {
            "overall_status": overall_status,
            "title": "일일 생활 리포트",
            "summary": row["summary"],
            "timeline": timeline,
            "highlights": highlights,
        }
    )
    return DailyReport(
        format_version=3,
        report_id=str(row["report_id"]),
        home_id=resident_thinq_id,
        household_type=str(counts["household_type"]),
        report_date=selected_date.isoformat(),
        generated_at=None,
        source=ReportSource(
            profile=profile,
            table_name=REPORTING_TABLE,
            row_count=int(counts["row_count"]),
            event_count=int(counts["event_count"]),
            metric_count=int(counts["metric_count"]),
            model=active_settings.openai_model,
        ),
        content=content,
    )


def _find_stored_report_with_connection(
    connection: Connection, resident_thinq_id: str, selected_date: date
) -> StoredReport | None:
    row = connection.execute(
        """SELECT report_id,resident_thinq_id,report_date,baseline_pattern,summary,timeline,highlights
           FROM public.daily_report WHERE resident_thinq_id=%s AND report_date=%s""",
        (resident_thinq_id, selected_date),
    ).fetchone()
    return None if row is None else _stored_report_from_row(dict(row))


find_stored_report_with_connection = _find_stored_report_with_connection


def find_stored_report(
    resident_thinq_id: str, report_date: str, settings: Settings | None = None
) -> StoredReport | None:
    selected_date = parse_report_date(report_date)
    with database_connection(settings or get_settings()) as connection:
        return _find_stored_report_with_connection(
            connection, resident_thinq_id, selected_date
        )


def _load_report_inputs_with_connection(
    connection: Connection,
    profile: ReportProfile,
    resident_thinq_id: str,
    selected_date: date,
) -> ReportInputs:
    life_row = connection.execute(
        "SELECT * FROM public.life_pattern WHERE resident_thinq_id=%s",
        (resident_thinq_id,),
    ).fetchone()
    if life_row is None:
        raise ValueError(f"{resident_thinq_id}의 life_pattern이 없습니다.")
    life = _life_pattern_from_row(dict(life_row))
    records = _load_daily_records_with_connection(
        connection, profile, resident_thinq_id, selected_date
    )
    history = [
        dict(row)
        for row in connection.execute(
            """SELECT reporting_id,resident_thinq_id,household_type,data_date,
                      subject_type,subject,metric_code,value,unit
               FROM public.reporting_data
               WHERE resident_thinq_id=%s AND data_date<=%s AND record_type='metric'
               ORDER BY data_date,metric_code,reporting_id""",
            (resident_thinq_id, selected_date),
        ).fetchall()
    ]
    payload = {"life": life, "records": records, "history": history}
    return ReportInputs(
        resident_thinq_id=resident_thinq_id,
        profile=profile,
        report_date=selected_date,
        life_pattern=life,
        daily_records=records,
        metric_history=history,
        fingerprint=_snapshot_fingerprint(payload),
    )


def load_report_inputs(
    profile: ReportProfile,
    resident_thinq_id: str,
    report_date: str,
    settings: Settings | None = None,
) -> ReportInputs:
    selected_date = parse_report_date(report_date)
    with database_connection(settings or get_settings()) as connection:
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        return _load_report_inputs_with_connection(
            connection, profile, resident_thinq_id, selected_date
        )


load_report_inputs_with_connection = _load_report_inputs_with_connection


@contextmanager
def report_creation_lock(
    resident_thinq_id: str,
    selected_date: date,
    settings: Settings | None = None,
) -> Iterator[Connection]:
    key = f"daily-report:{resident_thinq_id}:{selected_date.isoformat()}"
    with database_connection(settings or get_settings()) as connection:
        connection.execute("SELECT pg_advisory_lock(hashtextextended(%s,0))", (key,))
        connection.commit()
        try:
            yield connection
        finally:
            connection.rollback()
            connection.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", (key,))
            connection.commit()


def insert_prepared_report(
    connection: Connection,
    prepared: PreparedReport,
    expected_fingerprint: str,
    profile: ReportProfile,
) -> None:
    connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
    existing = _find_stored_report_with_connection(
        connection, prepared.resident_thinq_id, prepared.report_date
    )
    if existing is not None:
        return
    current = _load_report_inputs_with_connection(
        connection, profile, prepared.resident_thinq_id, prepared.report_date
    )
    if current.fingerprint != expected_fingerprint:
        raise RuntimeError("리포트 생성 중 입력 DB 상태가 변경됐습니다.")
    result = connection.execute(
        """INSERT INTO public.daily_report(
               report_id,resident_thinq_id,report_date,baseline_pattern,summary,timeline,highlights)
           VALUES (%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (resident_thinq_id,report_date) DO NOTHING""",
        (
            prepared.report_id,
            prepared.resident_thinq_id,
            prepared.report_date,
            Jsonb(prepared.baseline_pattern),
            prepared.content.summary,
            Jsonb([item.model_dump() for item in prepared.content.timeline]),
            Jsonb([item.model_dump() for item in prepared.content.highlights]),
        ),
    )
    if result.rowcount != 1:
        raise RuntimeError("daily_report 최초 INSERT가 실행되지 않았습니다.")
    connection.commit()


def commit_report_migration(
    snapshot: GenerationSnapshot,
    prepared_reports: list[PreparedReport],
    corrected_life_pattern: LifePatternState,
    settings: Settings | None = None,
) -> None:
    expected_dates = _date_range(snapshot.start_date, snapshot.end_date)
    if [item.report_date for item in prepared_reports] != expected_dates:
        raise ValueError("마이그레이션 날짜 범위가 일치하지 않습니다.")
    if any(
        item.report_id != snapshot.reports_by_date[item.report_date].report_id
        for item in prepared_reports
    ):
        raise ValueError("마이그레이션은 기존 report_id를 변경할 수 없습니다.")
    if corrected_life_pattern.resident_thinq_id != snapshot.resident_thinq_id:
        raise ValueError("다른 생활자의 life_pattern을 함께 저장할 수 없습니다.")
    if corrected_life_pattern.as_of_date != snapshot.life_pattern.as_of_date:
        raise ValueError("정정 작업은 life_pattern의 as_of_date를 변경할 수 없습니다.")
    care_pattern_codes = {
        "days_without_guidance_rate",
        "guidance_completion_rate",
        "average_response_minutes",
        "emergency_alert_day_count",
        "resolved_after_alert_rate",
    }
    expected_pattern_keys = set(LIFE_METRIC_CODES) | care_pattern_codes
    if (
        set(corrected_life_pattern.observed_pattern) != expected_pattern_keys
        or set(corrected_life_pattern.standard_pattern) != expected_pattern_keys
    ):
        raise ValueError("정정 life_pattern은 생활 30개와 돌봄 5개 지표여야 합니다.")
    if any(
        report.baseline_pattern.get("valid_day_policy") != VALID_DAY_POLICY
        for report in prepared_reports
    ):
        raise ValueError("정정 리포트에 유효일 정책 표식이 없습니다.")
    with database_connection(settings or get_settings()) as connection:
        try:
            connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            connection.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                (f"report-migration:{snapshot.resident_thinq_id}",),
            )
            current = _load_generation_snapshot_with_connection(
                connection, snapshot.profile, snapshot.resident_thinq_id,
                snapshot.start_date, snapshot.end_date
            )
            if current.fingerprint != snapshot.fingerprint:
                raise RuntimeError("마이그레이션 입력 fingerprint가 변경됐습니다.")
            if any(
                report.baseline_pattern.get("valid_day_policy") == VALID_DAY_POLICY
                for report in current.reports_by_date.values()
            ):
                raise RuntimeError("이미 현재 유효일 정책으로 정정된 리포트가 있습니다.")

            life_result = connection.execute(
                """UPDATE public.life_pattern
                   SET valid_day_count=%s, observed_pattern=%s, standard_pattern=%s
                   WHERE resident_thinq_id=%s
                     AND as_of_date IS NOT DISTINCT FROM %s
                     AND valid_day_count=%s""",
                (
                    corrected_life_pattern.valid_day_count,
                    Jsonb(corrected_life_pattern.observed_pattern),
                    Jsonb(corrected_life_pattern.standard_pattern),
                    snapshot.resident_thinq_id,
                    snapshot.life_pattern.as_of_date,
                    snapshot.life_pattern.valid_day_count,
                ),
            )
            if life_result.rowcount != 1:
                raise RuntimeError("life_pattern 정정 대상이 정확히 한 행이 아닙니다.")

            for prepared in prepared_reports:
                result = connection.execute(
                    """UPDATE public.daily_report SET baseline_pattern=%s,summary=%s,timeline=%s,highlights=%s
                       WHERE report_id=%s AND resident_thinq_id=%s AND report_date=%s""",
                    (Jsonb(prepared.baseline_pattern),prepared.content.summary,
                     Jsonb([x.model_dump() for x in prepared.content.timeline]),
                     Jsonb([x.model_dump() for x in prepared.content.highlights]),
                     prepared.report_id,prepared.resident_thinq_id,prepared.report_date),
                )
                if result.rowcount != 1:
                    raise RuntimeError("마이그레이션 UPDATE 대상이 1행이 아닙니다.")

            stored_life = connection.execute(
                """SELECT valid_day_count,as_of_date,observed_pattern,standard_pattern
                   FROM public.life_pattern WHERE resident_thinq_id=%s""",
                (snapshot.resident_thinq_id,),
            ).fetchone()
            if (
                stored_life is None
                or int(stored_life["valid_day_count"])
                != corrected_life_pattern.valid_day_count
                or stored_life["as_of_date"] != corrected_life_pattern.as_of_date
                or set(stored_life["observed_pattern"]) != expected_pattern_keys
                or set(stored_life["standard_pattern"]) != expected_pattern_keys
            ):
                raise RuntimeError("저장된 life_pattern 검증에 실패했습니다.")

            report_rows = connection.execute(
                """SELECT report_id,report_date,baseline_pattern,summary,timeline,highlights
                   FROM public.daily_report
                   WHERE resident_thinq_id=%s AND report_date BETWEEN %s AND %s
                   ORDER BY report_date""",
                (snapshot.resident_thinq_id, snapshot.start_date, snapshot.end_date),
            ).fetchall()
            if len(report_rows) != len(prepared_reports):
                raise RuntimeError("정정 후 daily_report 행 수가 달라졌습니다.")
            expected_by_date = {item.report_date: item for item in prepared_reports}
            for row in report_rows:
                expected = expected_by_date[row["report_date"]]
                if (
                    row["report_id"] != expected.report_id
                    or row["baseline_pattern"] != expected.baseline_pattern
                    or not str(row["summary"]).strip()
                    or not isinstance(row["timeline"], list)
                    or not isinstance(row["highlights"], list)
                ):
                    raise RuntimeError("정정 후 daily_report 내용 검증에 실패했습니다.")
            shares = {
                row["report_id"]: int(row["share_count"])
                for row in connection.execute(
                    """SELECT d.report_id,count(s.report_id) share_count FROM public.daily_report d
                       LEFT JOIN public.report_share s USING(report_id)
                       WHERE d.resident_thinq_id=%s AND d.report_date BETWEEN %s AND %s
                       GROUP BY d.report_id""",
                    (snapshot.resident_thinq_id,snapshot.start_date,snapshot.end_date),
                ).fetchall()
            }
            if shares != snapshot.share_counts:
                raise RuntimeError("report_share 관계가 변경됐습니다.")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
