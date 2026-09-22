from datetime import date, datetime
from pathlib import Path

import pytest

from app.config import Settings
from app.models import Highlight, ReportContent
from app.report_service import create_daily_report, validate_evidence_refs


def sample_content(ref: int = 1) -> ReportContent:
    return ReportContent(
        overall_status="normal",
        title="일일 생활 리포트",
        summary="입력 지표를 바탕으로 한 요약입니다.",
        highlights=[Highlight(
            category="behavior", title="활동 시간이 평소와 달랐어요.",
            baseline="최근 한 달 평균 활동 시각: 08:00",
            today="오늘 활동 시각: 09:00",
            severity="normal", evidence_refs=[ref]
        )],
        timeline=[],
    )


def test_rejects_invalid_evidence_reference() -> None:
    with pytest.raises(ValueError, match="존재하지 않는 근거"):
        validate_evidence_refs(sample_content(99), 2)


def test_create_report_with_mocked_openai(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr("app.report_service.generate_report_content", lambda payload, settings: sample_content())
    monkeypatch.setattr(
        "app.report_service.load_daily_records",
        lambda profile, report_date, settings: [
            {
                "row_id": 1,
                "home_id": "home_23",
                "household_type": "one_person",
                "date": date(2026, 9, 20),
                "event_time": datetime(2026, 9, 20, 8, 0),
                "record_type": "event",
                "subject_type": "behavior",
                "subject": "식사",
                "metric_code": "meal_observation_event",
                "value": 1.0,
                "unit": "event",
                "baseline_value": None,
                "delta_value": None,
                "baseline_days": None,
                "data_status": "synthetic",
                "evidence": "test",
            },
            {
                "row_id": 2,
                "home_id": "home_23",
                "household_type": "one_person",
                "date": date(2026, 9, 20),
                "event_time": None,
                "record_type": "metric",
                "subject_type": "behavior",
                "subject": "식사",
                "metric_code": "meal_count",
                "value": 1.0,
                "unit": "count",
                "baseline_value": 1.0,
                "delta_value": 0.0,
                "baseline_days": 30,
                "data_status": "synthetic",
                "evidence": "test",
            },
        ],
    )
    settings = Settings(
        report_output_dir=tmp_path,
    )
    report, path = create_daily_report(
        "one_person", "2026-09-20", settings, force=True
    )
    assert report.source.row_count == 2
    assert report.source.event_count == 1
    assert report.source.metric_count == 1
    assert report.format_version == 2
    assert report.home_id == "home_23"
    assert path is not None
    assert path.exists()


def test_create_report_without_saving(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "app.report_service.generate_report_content",
        lambda payload, settings: sample_content(),
    )
    monkeypatch.setattr(
        "app.report_service.load_daily_records",
        lambda profile, report_date, settings: [
            {
                "row_id": 1,
                "home_id": "home_23",
                "household_type": "one_person",
                "date": date(2026, 9, 20),
                "event_time": datetime(2026, 9, 20, 8, 0),
                "record_type": "event",
                "subject_type": "behavior",
                "subject": "식사",
                "metric_code": "meal_observation_event",
                "value": 1.0,
                "unit": "event",
                "baseline_value": None,
                "delta_value": None,
                "baseline_days": None,
                "data_status": "synthetic",
                "evidence": "test",
            }
        ],
    )
    settings = Settings(report_output_dir=tmp_path)

    report, path = create_daily_report(
        "one_person",
        "2026-09-20",
        settings,
        force=True,
        save_output=False,
    )

    assert report.home_id == "home_23"
    assert path is None
    assert list(tmp_path.glob("*.json")) == []
