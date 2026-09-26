from contextlib import contextmanager
from datetime import date, time, timedelta
from uuid import uuid4

import pytest

from app.config import Settings
from app.models import GenerationSnapshot, LifePatternState, ReportInputs, StoredReport
from app.pattern_service import CARE_SOURCE_CODES, LIFE_METRIC_CODES
from app.report_service import (
    _prepare_one,
    create_report_if_absent,
    migrate_report_range,
    prepare_report_migration,
    validate_generation_date_policy,
    validate_lookup_date_policy,
)


def metric(code: str, day: date, value: float = 1.0) -> dict:
    care = code in CARE_SOURCE_CODES
    return {
        "reporting_id": uuid4(), "resident_thinq_id": "home_test",
        "household_type": "one_person", "data_date": day, "event_time": None,
        "record_type": "metric", "subject_type": "care" if care else "behavior",
        "subject": "돌봄" if care else "생활", "metric_code": code,
        "value": value, "unit": "minute" if code == "care_response_minutes_avg" else "count",
        "baseline_value": None, "delta_value": None, "baseline_days": 0,
        "data_status": "test", "evidence": "test",
    }


def life() -> LifePatternState:
    return LifePatternState(
        "home_test", date(2026, 9, 1), None, time(21), None, time(12, 30),
        time(18), 6, {}, {}, date(2026, 9, 25)
    )


def inputs(day: date, history: list[dict] | None = None) -> ReportInputs:
    records = [metric(code, day) for code in LIFE_METRIC_CODES]
    return ReportInputs(
        "home_test", "one_person", day, life(), records,
        history if history is not None else records, "fingerprint"
    )


def test_first_data_date_can_use_empty_retrospective_baseline() -> None:
    prepared = _prepare_one(
        inputs(date(2025, 9, 23), []), Settings(),
        lambda payload, settings: "요약입니다."
    )
    assert prepared.baseline_pattern == {
        "baseline_source": "RETROSPECTIVE",
        "valid_day_policy": "ALL_30_METRIC_ROWS_PRESENT",
        "baseline_as_of_date": None,
        "baseline_days": 0,
        "metrics": {},
    }
    assert len(prepared.content.highlights) == 4
    assert all(item.severity == "attention" for item in prepared.content.highlights)


def test_service_pattern_rebuilds_d_minus_one_with_initial_weight() -> None:
    day = date(2026, 9, 11)
    history = [
        metric(code, date(2026, 9, 1) + timedelta(days=offset), 1200)
        for code in LIFE_METRIC_CODES for offset in range(10)
    ]
    prepared = _prepare_one(
        inputs(day, history), Settings(), lambda payload, settings: "요약입니다."
    )
    assert prepared.baseline_pattern["baseline_source"] == "SERVICE_PATTERN"
    assert prepared.baseline_pattern["baseline_as_of_date"] == "2026-09-10"
    assert prepared.baseline_pattern["valid_day_policy"] == "ALL_30_METRIC_ROWS_PRESENT"
    assert prepared.baseline_pattern["metrics"]["last_activity_time"]["average_value"] == 1240.0


def test_service_baseline_days_are_complete_prior_dates() -> None:
    start = date(2026, 9, 1)
    history = [
        metric(code, start + timedelta(days=offset), None if code == "first_outing_time" else 1)
        for offset in range(30)
        for code in LIFE_METRIC_CODES
    ]
    actual = []
    for offset in range(8):
        selected = date(2026, 9, 23) + timedelta(days=offset)
        prepared = _prepare_one(
            inputs(selected, history), Settings(),
            lambda payload, settings: "요약입니다.",
        )
        actual.append(prepared.baseline_pattern["baseline_days"])
    assert actual == [22, 23, 24, 25, 26, 27, 28, 29]


def test_service_baseline_days_caps_at_30() -> None:
    start = date(2026, 9, 1)
    history = [
        metric(code, start + timedelta(days=offset), 1)
        for offset in range(40)
        for code in LIFE_METRIC_CODES
    ]
    prepared = _prepare_one(
        inputs(date(2026, 10, 11), history), Settings(),
        lambda payload, settings: "요약입니다.",
    )
    assert prepared.baseline_pattern["baseline_days"] == 30


def test_openai_payload_contains_server_confirmed_timeline_and_highlights() -> None:
    selected = date(2026, 9, 23)
    history = [
        metric(code, date(2026, 9, 1) + timedelta(days=offset), 1)
        for offset in range(22)
        for code in LIFE_METRIC_CODES
    ]
    source = inputs(selected, history)
    first_meal = next(
        row for row in source.daily_records if row["metric_code"] == "first_meal_time"
    )
    first_meal.update(value=600, unit="minute_of_day", subject="식사")
    activity_count = next(
        row for row in source.daily_records if row["metric_code"] == "activity_event_count"
    )
    activity_count.update(value=68, unit="count", subject="생활 활동")
    source.daily_records.append({
        "reporting_id": uuid4(), "resident_thinq_id": "home_test",
        "household_type": "one_person", "data_date": selected,
        "event_time": "2026-09-23T10:00:00", "record_type": "event",
        "subject_type": "behavior", "subject": "식사",
        "metric_code": "meal_observation_event", "value": 1, "unit": "event",
        "baseline_value": None, "delta_value": None, "baseline_days": None,
        "data_status": "test", "evidence": "test",
    })
    payloads: list[dict] = []

    prepared = _prepare_one(
        source,
        Settings(),
        lambda payload, settings: payloads.append(payload) or "서버 사실 요약",
    )

    assert prepared.content.summary == "서버 사실 요약"
    assert len(payloads) == 1
    assert payloads[0]["task"] == "write_summary_only"
    assert payloads[0]["confirmed_facts"]["timeline"][0]["description"] == "식사를 했어요."
    assert any(
        item["title"].startswith("첫 식사 행동이 평소보다")
        for item in payloads[0]["confirmed_facts"]["highlights"]
    )
    assert all(
        "생활 활동" not in item["title"]
        for item in payloads[0]["confirmed_facts"]["highlights"]
    )


def test_existing_report_returns_without_openai(monkeypatch) -> None:
    sentinel = object()
    monkeypatch.setattr("app.report_service.find_stored_report", lambda *args: object())
    monkeypatch.setattr("app.report_service.load_report_from_database", lambda *args: sentinel)
    calls: list[str] = []
    result = create_report_if_absent(
        "one_person", "home_test", "2026-09-23", Settings(),
        summary_generator=lambda *args: calls.append("openai") or "요약",
    )
    assert result is sentinel
    assert calls == []


def test_missing_report_calls_openai_once_and_inserts(monkeypatch) -> None:
    source = inputs(date(2026, 9, 23), [
        metric(code, date(2026, 9, 1) + timedelta(days=i), 1)
        for code in LIFE_METRIC_CODES for i in range(22)
    ])
    state = {"fast": None}
    monkeypatch.setattr("app.report_service.find_stored_report", lambda *args: state["fast"])
    monkeypatch.setattr("app.report_service.find_stored_report_with_connection", lambda *args: None)
    monkeypatch.setattr("app.report_service.load_report_inputs_with_connection", lambda *args: source)
    inserted: list[object] = []
    monkeypatch.setattr("app.report_service.insert_prepared_report", lambda *args: inserted.append(args[1]))
    sentinel = object()
    monkeypatch.setattr("app.report_service.load_report_from_database", lambda *args: sentinel)

    class Connection:
        def commit(self): pass
    @contextmanager
    def lock(*args): yield Connection()
    monkeypatch.setattr("app.report_service.report_creation_lock", lock)
    calls: list[str] = []
    result = create_report_if_absent(
        "one_person", "home_test", "2026-09-23", Settings(),
        summary_generator=lambda *args: calls.append("openai") or "요약입니다."
    )
    assert result is sentinel
    assert calls == ["openai"]
    assert len(inserted) == 1


def test_concurrent_winner_is_found_after_lock_without_openai(monkeypatch) -> None:
    sentinel = object()
    monkeypatch.setattr("app.report_service.find_stored_report", lambda *args: None)
    monkeypatch.setattr(
        "app.report_service.find_stored_report_with_connection", lambda *args: object()
    )
    monkeypatch.setattr("app.report_service.load_report_from_database", lambda *args: sentinel)
    class Connection:
        def commit(self): pass
    @contextmanager
    def lock(*args): yield Connection()
    monkeypatch.setattr("app.report_service.report_creation_lock", lock)
    calls: list[str] = []
    result = create_report_if_absent(
        "one_person", "home_test", "2026-09-23", Settings(),
        summary_generator=lambda *args: calls.append("openai") or "요약",
    )
    assert result is sentinel
    assert calls == []


def test_openai_failure_inserts_natural_fallback(monkeypatch) -> None:
    source = inputs(date(2026, 9, 23), [
        metric(code, date(2026, 9, 1) + timedelta(days=offset), 1)
        for offset in range(22)
        for code in LIFE_METRIC_CODES
    ])
    monkeypatch.setattr("app.report_service.find_stored_report", lambda *args: None)
    monkeypatch.setattr("app.report_service.find_stored_report_with_connection", lambda *args: None)
    monkeypatch.setattr("app.report_service.load_report_inputs_with_connection", lambda *args: source)
    inserted: list[object] = []
    monkeypatch.setattr("app.report_service.insert_prepared_report", lambda *args: inserted.append(1))
    monkeypatch.setattr("app.report_service.load_report_from_database", lambda *args: object())
    class Connection:
        def commit(self): pass
    @contextmanager
    def lock(*args): yield Connection()
    monkeypatch.setattr("app.report_service.report_creation_lock", lock)
    create_report_if_absent(
        "one_person", "home_test", "2026-09-23", Settings(),
        summary_generator=lambda *args: (_ for _ in ()).throw(RuntimeError("fail")),
    )
    assert inserted == [1]


def test_lookup_allows_today_but_generation_rejects_today_and_future() -> None:
    from app.report_service import datetime as service_datetime, SEOUL
    today = service_datetime.now(SEOUL).date()
    validate_lookup_date_policy(today)
    with pytest.raises(ValueError, match="오늘 또는 미래"):
        validate_generation_date_policy(today)
    with pytest.raises(ValueError, match="미래"):
        validate_lookup_date_policy(today + timedelta(days=1))
    with pytest.raises(ValueError, match="오늘 또는 미래"):
        validate_generation_date_policy(today + timedelta(days=1))


def test_completed_migration_stops_before_openai(monkeypatch) -> None:
    class Report:
        baseline_pattern = {"valid_day_policy": "ALL_30_METRIC_ROWS_PRESENT"}
    class Snapshot:
        reports_by_date = {date(2026, 9, 23): Report()}
    monkeypatch.setattr("app.report_service.load_generation_snapshot", lambda *args: Snapshot())
    calls: list[str] = []
    with pytest.raises(RuntimeError, match="이미 현재 유효일 정책"):
        migrate_report_range(
            "one_person", "home_test", "2026-09-23", "2026-09-30", Settings(),
            summary_generator=lambda *args: calls.append("openai") or "요약",
        )
    assert calls == []


def test_other_residents_daily_records_are_rejected() -> None:
    source = inputs(date(2026, 9, 23), [
        metric(code, date(2026, 9, 1), 1) for code in LIFE_METRIC_CODES
    ])
    source.daily_records[0]["resident_thinq_id"] = "other_home"
    with pytest.raises(ValueError, match="소유자"):
        _prepare_one(source, Settings(), lambda payload, settings: "요약입니다.")


def test_migration_preserves_report_ids_and_share_snapshot() -> None:
    selected = date(2026, 9, 23)
    report_id = uuid4()
    stored = StoredReport(
        report_id, "home_test", selected,
        {"baseline_source": "SERVICE_PATTERN", "baseline_days": 5},
        "이전 요약", [], [],
    )
    history = [
        metric(code, date(2026, 9, 1) + timedelta(days=offset), 1)
        for offset in range(23)
        for code in LIFE_METRIC_CODES
    ]
    snapshot = GenerationSnapshot(
        resident_thinq_id="home_test",
        profile="one_person",
        start_date=selected,
        end_date=selected,
        life_pattern=life(),
        records_by_date={selected: [metric(code, selected) for code in LIFE_METRIC_CODES]},
        metric_history=history,
        reports_by_date={selected: stored},
        share_counts={report_id: 1},
        fingerprint="fingerprint",
    )
    prepared = prepare_report_migration(
        snapshot, Settings(), lambda payload, settings: "새 요약"
    )
    assert prepared[0].report_id == report_id
    assert snapshot.share_counts == {report_id: 1}
    assert prepared[0].baseline_pattern["baseline_days"] == 22
