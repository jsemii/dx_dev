from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.config import ReportProfile, Settings, get_settings
from app.models import DailyReport, ReportContent, ReportSource
from app.openai_report import generate_report_content
from app.prompt_builder import build_report_input
from app.report_preprocessor import preprocess_daily_records
from app.report_repository import load_daily_records, table_name_for_profile
from app.report_store import load_report, report_path, save_report


REPORT_FORMAT_VERSION = 2


def validate_evidence_refs(content: ReportContent, row_count: int) -> None:
    refs = [
        ref
        for collection in (content.timeline, content.highlights)
        for item in collection
        for ref in item.evidence_refs
    ]
    invalid = sorted({ref for ref in refs if ref < 1 or ref > row_count})
    if invalid:
        raise ValueError(f"존재하지 않는 근거 행입니다: {invalid}")


def create_daily_report(
    profile: ReportProfile,
    report_date: str,
    settings: Settings | None = None,
    force: bool = False,
    save_output: bool = True,
) -> tuple[DailyReport, Path | None]:
    active_settings = settings or get_settings()
    rows = load_daily_records(profile, report_date, active_settings)
    preprocessed = preprocess_daily_records(profile, report_date, rows)
    preprocessed["source_table"] = table_name_for_profile(profile)
    home_id = preprocessed["home_id"]

    if save_output and not force:
        try:
            cached = load_report(
                active_settings.report_output_dir,
                home_id,
                report_date,
                active_settings.openai_model,
            )
            if cached.format_version == REPORT_FORMAT_VERSION:
                return cached, report_path(
                    active_settings.report_output_dir,
                    home_id,
                    report_date,
                    active_settings.openai_model,
                )
        except FileNotFoundError:
            pass

    payload = build_report_input(preprocessed)
    content = generate_report_content(payload, active_settings)
    validate_evidence_refs(content, len(rows))
    report = DailyReport(
        format_version=REPORT_FORMAT_VERSION,
        report_id=f"{home_id}_{report_date}_{active_settings.openai_model}",
        home_id=home_id,
        household_type=preprocessed["household_type"],
        report_date=report_date,
        generated_at=datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        source=ReportSource(
            profile=profile,
            table_name=table_name_for_profile(profile),
            row_count=len(rows),
            event_count=preprocessed["event_count"],
            metric_count=preprocessed["metric_count"],
            model=active_settings.openai_model,
        ),
        content=content,
    )
    path = (
        save_report(report, active_settings.report_output_dir)
        if save_output
        else None
    )
    return report, path
