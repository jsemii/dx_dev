from datetime import date, time, timedelta
from uuid import uuid4

from app.models import LifePatternState
import pytest

from app.pattern_service import (
    CARE_SOURCE_CODES,
    LIFE_METRIC_CODES,
    calculate_life_pattern,
    calculate_retrospective_pattern,
)


def row(code: str, day: date, value: float | None, *, care: bool = False) -> dict:
    return {
        "reporting_id": uuid4(),
        "data_date": day,
        "metric_code": code,
        "value": value,
        "subject_type": "care" if care else "behavior",
        "subject": "돌봄" if care else "생활",
        "unit": "minute" if code == "care_response_minutes_avg" else "count",
    }


def test_last_30_non_null_values_and_care_patterns() -> None:
    end = date(2026, 9, 30)
    history: list[dict] = []
    for code in LIFE_METRIC_CODES:
        history.extend(
            row(code, end - timedelta(days=i), None if i == 2 else float(i))
            for i in range(35)
        )
    for i in range(8):
        day = end - timedelta(days=7 - i)
        values = {
            "care_guidance_count": 2,
            "care_completed_count": 1,
            "care_no_response_count": 1,
            "care_response_minutes_avg": 10 + i,
            "care_emergency_alert_count": 0,
            "care_resolved_after_alert_count": 0,
        }
        history.extend(row(code, day, values[code], care=True) for code in CARE_SOURCE_CODES)
    initial = LifePatternState(
        "home_test", date(2026, 9, 1), time(7), None, None, None, None, 30, {}, {}, end - timedelta(days=1)
    )
    result = calculate_life_pattern(initial, history, end)
    assert result.standard_pattern["meal_count"]["valid_day_count"] == 29
    assert result.standard_pattern["meal_count"]["average_value"] == 14.931
    assert result.observed_pattern["meal_count"] == result.standard_pattern["meal_count"]
    assert result.initial_wake_time == time(7)
    assert result.valid_day_count == 30
    assert result.standard_pattern["guidance_completion_rate"]["average_value"] == 0.5
    assert result.standard_pattern["average_response_minutes"]["average_value"] == 13.5
    assert result.standard_pattern["resolved_after_alert_rate"]["average_value"] is None
    assert result.standard_pattern["days_without_guidance_rate"]["unit"] == "ratio"
    assert result.standard_pattern["days_without_guidance_rate"]["valid_day_count"] == 8


def test_rounds_average_to_three_decimals() -> None:
    end = date(2026, 9, 30)
    history = [
        row(code, end, 1 / 3) for code in LIFE_METRIC_CODES
    ]
    current = LifePatternState("home_test", end, None, None, None, None, None, 1, {}, {}, None)
    result = calculate_life_pattern(current, history, end)
    assert result.standard_pattern["meal_count"]["average_value"] == 0.333


def test_null_value_still_counts_as_global_valid_day_and_internal_counts_differ() -> None:
    start = date(2026, 9, 1)
    history = [
        row(code, start + timedelta(days=offset), None if code == "first_outing_time" else 10)
        for offset in range(25)
        for code in LIFE_METRIC_CODES
    ]
    current = LifePatternState(
        "home_test", start, None, time(21), None, time(12, 30), time(18),
        0, {}, {}, None,
    )
    result = calculate_life_pattern(current, history, date(2026, 9, 25))
    assert result.valid_day_count == 25
    assert result.standard_pattern["first_outing_time"]["valid_day_count"] == 0
    assert result.standard_pattern["first_outing_time"]["average_value"] is None
    assert result.standard_pattern["meal_count"]["valid_day_count"] == 25


def test_missing_metric_row_is_data_error() -> None:
    selected = date(2026, 9, 1)
    history = [row(code, selected, 1) for code in LIFE_METRIC_CODES[:-1]]
    current = LifePatternState(
        "home_test", selected, None, None, None, None, None, 0, {}, {}, None
    )
    with pytest.raises(ValueError, match="missing"):
        calculate_life_pattern(current, history, selected)


def test_duplicate_metric_row_is_data_error() -> None:
    selected = date(2026, 9, 1)
    history = [row(code, selected, 1) for code in LIFE_METRIC_CODES]
    history.append(row(LIFE_METRIC_CODES[0], selected, None))
    current = LifePatternState(
        "home_test", selected, None, None, None, None, None, 0, {}, {}, None
    )
    with pytest.raises(ValueError, match="duplicated"):
        calculate_life_pattern(current, history, selected)


def test_initial_weight_uses_each_metrics_non_null_count() -> None:
    start = date(2026, 9, 1)
    history = [
        row(
            code,
            start + timedelta(days=offset),
            None if code == "last_activity_time" and offset >= 10 else 600,
        )
        for offset in range(20)
        for code in LIFE_METRIC_CODES
    ]
    current = LifePatternState(
        "home_test", start, None, time(21), None, None, None, 0, {}, {}, None
    )
    result = calculate_life_pattern(current, history, date(2026, 9, 20))
    # 10개 관찰값: 21:00 초기값 2/3 + 10:00 관찰값 1/3
    assert result.standard_pattern["last_activity_time"]["valid_day_count"] == 10
    assert result.standard_pattern["last_activity_time"]["average_value"] == 1040.0
    assert result.valid_day_count == 20


def test_retrospective_policy_counts_complete_rows_and_caps_at_30() -> None:
    start = date(2025, 8, 1)
    history = [
        row(code, start + timedelta(days=offset), None if offset == 4 else 1)
        for offset in range(35)
        for code in LIFE_METRIC_CODES
    ]
    current = LifePatternState(
        "home_test", date(2026, 9, 1), None, None, None, None, None,
        0, {}, {}, None,
    )
    result = calculate_retrospective_pattern(
        current, history, start + timedelta(days=34)
    )
    assert result.valid_day_count == 30
    assert result.standard_pattern["meal_count"]["valid_day_count"] == 30
