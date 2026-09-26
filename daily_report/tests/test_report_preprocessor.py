from datetime import date, datetime
from uuid import UUID

from app.report_preprocessor import preprocess_daily_records


def test_splits_events_and_metrics() -> None:
    records = [
        {
            "reporting_id": UUID("00000000-0000-0000-0000-000000000001"),
            "resident_thinq_id": "home_23",
            "household_type": "one_person",
            "data_date": date(2026, 9, 17),
            "event_time": datetime(2026, 9, 17, 9, 28),
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
            "evidence": "test-event",
        },
        {
            "reporting_id": UUID("00000000-0000-0000-0000-000000000002"),
            "resident_thinq_id": "home_23",
            "household_type": "one_person",
            "data_date": date(2026, 9, 17),
            "event_time": None,
            "record_type": "metric",
            "subject_type": "behavior",
            "subject": "식사",
            "metric_code": "first_meal_time",
            "value": 568.0,
            "unit": "minute_of_day",
            "baseline_value": 508.0,
            "delta_value": 60.0,
            "baseline_days": 30,
            "data_status": "synthetic",
            "evidence": "test-metric",
        },
    ]

    result = preprocess_daily_records("one_person", "2026-09-17", records)

    assert result["home_id"] == "home_23"
    assert result["event_count"] == 1
    assert result["metric_count"] == 1
    assert result["timeline_events"][0]["event_time"] == "2026-09-17T09:28:00"
    assert result["daily_metrics"][0]["baseline_value"] == 508.0


def test_adds_minute_display_values_for_second_metrics() -> None:
    records = [
        {
            "reporting_id": UUID("00000000-0000-0000-0000-000000000001"),
            "resident_thinq_id": "home_23",
            "household_type": "one_person",
            "data_date": date(2026, 9, 17),
            "event_time": None,
            "record_type": "metric",
            "subject_type": "appliance",
            "subject": "일반 냉장고",
            "metric_code": "fridge_open_duration_total",
            "value": 620.0,
            "unit": "second",
            "baseline_value": 480.0,
            "delta_value": 140.0,
            "baseline_days": 30,
            "data_status": "synthetic",
            "evidence": "test-metric",
        }
    ]

    result = preprocess_daily_records("one_person", "2026-09-17", records)
    metric = result["daily_metrics"][0]

    assert metric["display_value"] == "약 10분"
    assert metric["display_baseline_value"] == "8분"
    assert metric["display_delta_value"] == "약 2분"
