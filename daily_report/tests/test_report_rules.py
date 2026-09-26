from datetime import datetime
from uuid import uuid4

import pytest

from app.pattern_service import CARE_SOURCE_CODES, LIFE_METRIC_CODES
from app.report_rules import (
    HIGHLIGHT_GROUPS,
    METRIC_DISPLAYS,
    SAFETY_HIGHLIGHT_CODES,
    VISIBLE_HIGHLIGHT_CODES,
    build_highlights,
    build_timeline,
    fallback_summary,
)


EXCLUDED_HIGHLIGHT_CODES = {
    "first_activity_time",
    "last_activity_time",
    "activity_event_count",
    "longest_inactivity_minutes",
    "no_motion_event_count",
    "meal_preparation_count",
    "dishwashing_count",
    "first_outing_time",
    "fridge_total_open_seconds",
    "fridge_max_open_seconds",
    "tv_on_count",
    "purifier_dispense_count",
    "cooling_usage_minutes",
    "heating_usage_minutes",
    "care_guidance_count",
    "care_completed_count",
    "care_resolved_after_alert_count",
}


SUBJECTS = {
    "first_meal_time": ("behavior", "식사"),
    "tv_usage_minutes": ("appliance", "TV"),
    "total_outing_minutes": ("behavior", "외출"),
    "purifier_volume_ml": ("appliance", "정수기"),
    "fridge_open_count": ("appliance", "일반 냉장고"),
}


def metric(
    code: str,
    value: float,
    unit: str,
    subject_type: str | None = None,
    subject: str | None = None,
) -> dict:
    mapped_type, mapped_subject = SUBJECTS.get(code, ("behavior", "테스트"))
    return {
        "reporting_id": uuid4(),
        "record_type": "metric",
        "subject_type": subject_type or mapped_type,
        "subject": subject or mapped_subject,
        "metric_code": code,
        "value": value,
        "unit": unit,
    }


def highlight_for(code: str, value: float, unit: str, baseline: float):
    return build_highlights(
        [metric(code, value, unit)],
        {code: {"average_value": baseline}},
    )[0]


def test_time_highlights_use_hh_mm_and_later_or_earlier() -> None:
    later = highlight_for("first_meal_time", 568, "minute_of_day", 508)
    earlier = highlight_for("first_meal_time", 448, "minute_of_day", 508)

    assert later.title == "첫 식사 행동이 평소보다 1시간 늦었어요."
    assert later.baseline == "최근 한 달 평균 식사 시각: 08:28"
    assert later.today == "오늘 식사 시각: 09:28"
    assert earlier.title == "첫 식사 행동이 평소보다 1시간 빨랐어요."
    assert earlier.today == "오늘 식사 시각: 07:28"


def test_duration_highlights_use_natural_hour_and_minute_text() -> None:
    shorter = highlight_for("tv_usage_minutes", 142, "minute", 360)
    longer = highlight_for("total_outing_minutes", 265, "minute", 170)

    assert shorter.title == "TV 시청 시간이 평소보다 3시간 38분 짧았어요."
    assert shorter.baseline == "최근 한 달 평균 시청 시간: 6시간"
    assert shorter.today == "오늘 시청 시간: 2시간 22분"
    assert longer.title == "외출한 시간이 평소보다 1시간 35분 길었어요."
    assert longer.baseline == "최근 한 달 평균 외출 시간: 2시간 50분"
    assert longer.today == "오늘 외출 시간: 4시간 25분"


def test_duration_under_one_hour_is_shown_as_minutes() -> None:
    item = highlight_for("tv_usage_minutes", 45, "minute", 75)
    assert item.today == "오늘 시청 시간: 45분"
    assert item.title == "TV 시청 시간이 평소보다 30분 짧았어요."


def test_volume_is_converted_to_liters_with_half_up_rounding() -> None:
    lower = highlight_for("purifier_volume_ml", 750, "mL", 1050)
    integer = highlight_for("purifier_volume_ml", 1000, "mL", 1500)

    assert lower.title == "정수기 출수량이 평소보다 0.3L 적었어요."
    assert lower.baseline == "최근 한 달 평균 출수량: 1.1L"
    assert lower.today == "오늘 출수량: 0.8L"
    assert integer.today == "오늘 출수량: 1L"


def test_counts_use_integer_today_and_one_decimal_average() -> None:
    item = highlight_for("fridge_open_count", 3, "count", 5.4)
    assert item.title == "냉장고 문을 연 횟수가 평소보다 2.4회 적었어요."
    assert item.baseline == "최근 한 달 평균 사용 횟수: 5.4회"
    assert item.today == "오늘 사용 횟수: 3회"


def test_threshold_boundaries_zero_baseline_and_forbidden_phrases() -> None:
    records = [
        metric("first_meal_time", 510, "minute_of_day"),
        metric("meal_count", 1, "count", subject="식사"),
        metric("purifier_volume_ml", 250, "mL"),
    ]
    baseline = {
        "first_meal_time": {"average_value": 480},
        "meal_count": {"average_value": 0},
        "purifier_volume_ml": {"average_value": 0},
    }
    highlights = build_highlights(records, baseline)
    assert len(highlights) == 2
    visible = " ".join(
        text
        for item in highlights
        for text in (item.title, item.baseline, item.today)
    )
    assert "최근 한 달 평균" in visible
    assert all(forbidden not in visible for forbidden in (
        "최근 기준", "오늘 값", "높게 기록", "낮게 기록", "metric_code"
    ))


def _unit_and_values(code: str) -> tuple[str, float, float]:
    kind = METRIC_DISPLAYS[code].kind
    if kind == "time":
        return "minute_of_day", 540, 480
    if kind == "duration_minutes":
        return "minute", 90, 30
    if kind == "duration_seconds":
        return "second", 180, 60
    if kind == "volume_ml":
        return "mL", 750, 250
    return "count", 3, 1


def test_all_36_metrics_are_explicitly_visible_or_excluded() -> None:
    all_codes = set(LIFE_METRIC_CODES) | set(CARE_SOURCE_CODES)
    assert len(all_codes) == 36
    assert VISIBLE_HIGHLIGHT_CODES.isdisjoint(EXCLUDED_HIGHLIGHT_CODES)
    assert VISIBLE_HIGHLIGHT_CODES | EXCLUDED_HIGHLIGHT_CODES == all_codes


def test_excluded_metrics_never_become_highlights_even_with_large_difference() -> None:
    records = [metric(code, 10_000, "count") for code in EXCLUDED_HIGHLIGHT_CODES]
    baseline = {code: {"average_value": 0} for code in EXCLUDED_HIGHLIGHT_CODES}
    assert build_highlights(records, baseline) == []


@pytest.mark.parametrize("code", sorted(VISIBLE_HIGHLIGHT_CODES))
def test_each_visible_metric_is_displayed_when_its_condition_is_met(code: str) -> None:
    unit, value, baseline = _unit_and_values(code)
    highlights = build_highlights(
        [metric(code, value, unit)],
        {code: {"average_value": baseline}},
    )
    assert len(highlights) == 1


def test_activity_count_and_first_last_activity_are_never_visible() -> None:
    records = [
        metric("activity_event_count", 68, "count"),
        metric("first_activity_time", 900, "minute_of_day"),
        metric("last_activity_time", 100, "minute_of_day"),
    ]
    baseline = {
        "activity_event_count": {"average_value": 1},
        "first_activity_time": {"average_value": 480},
        "last_activity_time": {"average_value": 1200},
    }
    assert build_highlights(records, baseline) == []


def test_tv_and_hydration_duplicates_keep_only_meaningful_metrics() -> None:
    records = [
        metric("tv_on_count", 8, "count", "appliance", "TV"),
        metric("tv_usage_minutes", 180, "minute"),
        metric("purifier_dispense_count", 8, "count", "appliance", "정수기"),
        metric("purifier_volume_ml", 1000, "mL"),
    ]
    baseline = {
        "tv_on_count": {"average_value": 1},
        "tv_usage_minutes": {"average_value": 60},
        "purifier_dispense_count": {"average_value": 1},
        "purifier_volume_ml": {"average_value": 500},
    }
    titles = [item.title for item in build_highlights(records, baseline)]
    assert len(titles) == 2
    assert any("TV 시청 시간" in title for title in titles)
    assert any("정수기 출수량" in title for title in titles)
    assert all("켠 횟수" not in title and "사용한 횟수" not in title for title in titles)


def test_meal_and_outing_groups_choose_largest_normalized_difference() -> None:
    records = [
        metric("meal_count", 4, "count"),
        metric("first_meal_time", 540, "minute_of_day"),
        metric("last_meal_time", 1170, "minute_of_day"),
        metric("meal_to_dishwashing_minutes", 90, "minute"),
        metric("outing_count", 4, "count"),
        metric("total_outing_minutes", 180, "minute"),
        metric("last_return_time", 1140, "minute_of_day"),
    ]
    baseline = {
        "meal_count": {"average_value": 2},
        "first_meal_time": {"average_value": 480},
        "last_meal_time": {"average_value": 1080},
        "meal_to_dishwashing_minutes": {"average_value": 30},
        "outing_count": {"average_value": 2},
        "total_outing_minutes": {"average_value": 90},
        "last_return_time": {"average_value": 1080},
    }
    titles = [item.title for item in build_highlights(records, baseline)]
    assert len(titles) == 2
    assert titles[0].startswith("마지막 식사 행동이")
    assert titles[1].startswith("외출한 시간이")


def test_fridge_duplicate_metrics_do_not_create_duplicate_normal_items() -> None:
    records = [
        metric("fridge_open_count", 5, "count", "appliance", "일반 냉장고"),
        metric("fridge_total_open_seconds", 900, "second", "appliance", "일반 냉장고"),
        metric("fridge_max_open_seconds", 600, "second", "appliance", "일반 냉장고"),
        metric("fridge_long_open_count", 1, "count", "appliance", "일반 냉장고"),
    ]
    baseline = {code: {"average_value": 0} for code in (
        "fridge_open_count", "fridge_total_open_seconds",
        "fridge_max_open_seconds", "fridge_long_open_count",
    )}
    highlights = build_highlights(records, baseline)
    assert len(highlights) == 2
    assert sum("3분 이상" in item.title for item in highlights) == 1
    assert sum("문을 연 횟수" in item.title for item in highlights) == 1


def test_safety_items_are_factual_zero_is_hidden_and_they_precede_normal_items() -> None:
    safety_rows = [metric(code, 1, "count") for code in SAFETY_HIGHLIGHT_CODES]
    normal_rows = []
    baseline = {code: {"average_value": 0} for code in SAFETY_HIGHLIGHT_CODES}
    for group, codes in HIGHLIGHT_GROUPS.items():
        code = codes[0]
        unit, value, normal_baseline = _unit_and_values(code)
        normal_rows.append(metric(code, value, unit))
        baseline[code] = {"average_value": normal_baseline}

    highlights = build_highlights(safety_rows + normal_rows, baseline)
    assert len(highlights) == 8
    assert all(item.severity == "attention" for item in highlights[:6])
    assert all("평소보다" not in item.title for item in highlights[:6])
    assert sum(item.severity == "notice" for item in highlights) == 2

    zero_safety = [metric(code, 0, "count") for code in SAFETY_HIGHLIGHT_CODES]
    assert build_highlights(zero_safety, baseline) == []


def test_normal_highlights_are_limited_to_four_in_display_order() -> None:
    records = []
    baseline = {}
    for group, codes in HIGHLIGHT_GROUPS.items():
        code = codes[0]
        unit, value, normal_baseline = _unit_and_values(code)
        records.append(metric(code, value, unit))
        baseline[code] = {"average_value": normal_baseline}
    highlights = build_highlights(records, baseline)
    assert len(highlights) == 4
    assert highlights[0].title.startswith("돌봄 안내에 응답하기까지")
    assert highlights[1].title.startswith("식사 횟수가")
    assert highlights[2].title.startswith("정수기 출수량이")
    assert highlights[3].title.startswith("외출 횟수가")


def test_emergency_and_resolution_are_combined_into_one_safety_highlight() -> None:
    emergency = metric("care_emergency_alert_count", 1, "count", "care", "돌봄")
    resolved = metric("care_resolved_after_alert_count", 1, "count", "care", "돌봄")
    highlights = build_highlights([emergency, resolved], {})
    assert len(highlights) == 1
    assert "긴급 알림이 1회" in highlights[0].title
    assert "생활 정상화도 1회" in highlights[0].title
    assert highlights[0].evidence_refs == [
        str(emergency["reporting_id"]), str(resolved["reporting_id"])
    ]


def test_care_timeline_pairs_same_evidence_id_without_repeated_response_time() -> None:
    care_id = str(uuid4())
    guidance_id, response_id = uuid4(), uuid4()
    base = {
        "record_type": "event", "subject_type": "care", "subject": "식사",
        "value": 1, "unit": "event", "evidence": f"source=care_event;care_event_id={care_id}",
    }
    records = [
        {**base, "reporting_id": guidance_id, "metric_code": "care_guidance_sent_event", "event_time": datetime(2026, 9, 23, 8, 0)},
        {**base, "reporting_id": response_id, "metric_code": "care_response_confirmed_event", "event_time": datetime(2026, 9, 23, 8, 12)},
        {**base, "reporting_id": uuid4(), "subject_type": "behavior", "subject": "수면", "metric_code": "sleep_observation_event", "event_time": datetime(2026, 9, 23, 22, 0)},
    ]
    timeline = build_timeline(records)

    assert timeline[0].time == "08:12"
    assert timeline[0].description == "08:00 식사 안내 후 12분 만에 식사를 했어요."
    assert "08:12" not in timeline[0].description
    assert "행동이 확인" not in timeline[0].description
    assert "반응 시간" not in timeline[0].description
    assert timeline[0].evidence_refs == [str(guidance_id), str(response_id)]
    assert timeline[-1].description == "잠자리에 들었어요."


def test_timeline_maps_verified_behavior_and_appliance_events_naturally() -> None:
    records = [
        {
            "reporting_id": uuid4(), "record_type": "event", "subject_type": "behavior",
            "subject": "식사", "metric_code": "meal_observation_event",
            "event_time": datetime(2026, 9, 23, 7, 35), "evidence": "test",
        },
        {
            "reporting_id": uuid4(), "record_type": "event", "subject_type": "appliance",
            "subject": "TV", "metric_code": "tv_power_on_event",
            "event_time": datetime(2026, 9, 23, 9, 20), "evidence": "test",
        },
    ]
    timeline = build_timeline(records)
    assert [(item.time, item.description) for item in timeline] == [
        ("07:35", "식사를 했어요."),
        ("09:20", "TV 시청을 시작했어요."),
    ]


def test_fallback_summary_is_natural_and_uses_only_confirmed_care_facts() -> None:
    summary = fallback_summary({
        "timeline": [],
        "highlights": [],
        "care": {
            "guidance_count": 2,
            "completed_count": 1,
            "no_response_count": 1,
            "emergency_alert_count": 0,
        },
    })
    assert summary.count(".") == 3
    assert "돌봄 안내는 2회" in summary
    assert "응답이 없었던 안내는 1회" in summary
    assert all(forbidden not in summary for forbidden in (
        "metric_code", "(", ")", "행동이 확인됐어요"
    ))
