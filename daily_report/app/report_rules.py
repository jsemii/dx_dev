from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Any
from zoneinfo import ZoneInfo

from app.models import Highlight, ReportContent, TimelineItem


TIME_DIFFERENCE_MINUTES = 30.0
COUNT_ABSOLUTE_DIFFERENCE = 1.0
COUNT_RELATIVE_DIFFERENCE = 0.30
MINUTE_DIFFERENCE = 30.0
SECOND_DIFFERENCE = 60.0
MILLILITER_DIFFERENCE = 250.0
MAX_TIMELINE_ITEMS = 30
MAX_HIGHLIGHTS = 8

VISIBLE_HIGHLIGHT_CODES = {
    "fall_event_count",
    "night_movement_count",
    "bed_to_toilet_count",
    "meal_count",
    "first_meal_time",
    "last_meal_time",
    "meal_to_dishwashing_minutes",
    "outing_count",
    "total_outing_minutes",
    "last_return_time",
    "short_return_reexit_count",
    "fridge_open_count",
    "fridge_long_open_count",
    "fridge_no_motion_count",
    "tv_usage_minutes",
    "purifier_volume_ml",
    "care_no_response_count",
    "care_response_minutes_avg",
    "care_emergency_alert_count",
}
SAFETY_HIGHLIGHT_CODES = {
    "fall_event_count",
    "fridge_long_open_count",
    "fridge_no_motion_count",
    "care_no_response_count",
    "care_emergency_alert_count",
    "short_return_reexit_count",
}
HIGHLIGHT_GROUPS = {
    "meal": (
        "meal_count",
        "first_meal_time",
        "last_meal_time",
        "meal_to_dishwashing_minutes",
    ),
    "outing": ("outing_count", "total_outing_minutes", "last_return_time"),
    "fridge": ("fridge_open_count",),
    "tv": ("tv_usage_minutes",),
    "hydration": ("purifier_volume_ml",),
    "night": ("night_movement_count", "bed_to_toilet_count"),
    "care_response": ("care_response_minutes_avg",),
}
MAX_NORMAL_HIGHLIGHTS = 4
SAFETY_HIGHLIGHT_ORDER = (
    "fall_event_count",
    "fridge_long_open_count",
    "fridge_no_motion_count",
    "care_no_response_count",
    "care_emergency_alert_count",
    "short_return_reexit_count",
)
NORMAL_HIGHLIGHT_ORDER = (
    "care_response",
    "meal",
    "hydration",
    "outing",
    "fridge",
    "tv",
    "night",
)
CODE_TO_HIGHLIGHT_GROUP = {
    code: group for group, codes in HIGHLIGHT_GROUPS.items() for code in codes
}
CARE_EVENT_ID_PATTERN = re.compile(r"(?:^|;)care_event_id=([0-9a-fA-F-]{36})(?:;|$)")


@dataclass(frozen=True)
class MetricDisplay:
    kind: str
    title_prefix: str
    baseline_label: str
    today_label: str
    higher: str
    lower: str


# 화면 문구는 DB의 subject/unit 조합이 아니라 검증된 metric 의미로만 만든다.
METRIC_DISPLAYS = {
    "first_activity_time": MetricDisplay("time", "하루 첫 활동이", "최근 한 달 평균 첫 활동 시각", "오늘 첫 활동 시각", "늦었어요", "빨랐어요"),
    "last_activity_time": MetricDisplay("time", "하루 마지막 활동이", "최근 한 달 평균 마지막 활동 시각", "오늘 마지막 활동 시각", "늦었어요", "빨랐어요"),
    "activity_event_count": MetricDisplay("count", "생활 활동 횟수가", "최근 한 달 평균 생활 활동 횟수", "오늘 생활 활동 횟수", "많았어요", "적었어요"),
    "longest_inactivity_minutes": MetricDisplay("duration_minutes", "가장 긴 비활동 시간이", "최근 한 달 평균 최장 비활동 시간", "오늘 최장 비활동 시간", "길었어요", "짧았어요"),
    "no_motion_event_count": MetricDisplay("count", "움직임 없음 감지가", "최근 한 달 평균 움직임 없음 횟수", "오늘 움직임 없음 횟수", "많았어요", "적었어요"),
    "fall_event_count": MetricDisplay("count", "낙상 의심 기록이", "최근 한 달 평균 낙상 의심 횟수", "오늘 낙상 의심 횟수", "많았어요", "적었어요"),
    "night_movement_count": MetricDisplay("count", "야간 활동이", "최근 한 달 평균 야간 활동 횟수", "오늘 야간 활동 횟수", "많았어요", "적었어요"),
    "bed_to_toilet_count": MetricDisplay("count", "침실과 화장실 사이 이동이", "최근 한 달 평균 침실·화장실 이동 횟수", "오늘 침실·화장실 이동 횟수", "많았어요", "적었어요"),
    "meal_count": MetricDisplay("count", "식사 횟수가", "최근 한 달 평균 식사 횟수", "오늘 식사 횟수", "많았어요", "적었어요"),
    "first_meal_time": MetricDisplay("time", "첫 식사 행동이", "최근 한 달 평균 식사 시각", "오늘 식사 시각", "늦었어요", "빨랐어요"),
    "last_meal_time": MetricDisplay("time", "마지막 식사 행동이", "최근 한 달 평균 마지막 식사 시각", "오늘 마지막 식사 시각", "늦었어요", "빨랐어요"),
    "meal_preparation_count": MetricDisplay("count", "식사를 준비한 횟수가", "최근 한 달 평균 식사 준비 횟수", "오늘 식사 준비 횟수", "많았어요", "적었어요"),
    "dishwashing_count": MetricDisplay("count", "설거지 횟수가", "최근 한 달 평균 설거지 횟수", "오늘 설거지 횟수", "많았어요", "적었어요"),
    "meal_to_dishwashing_minutes": MetricDisplay("duration_minutes", "식사 후 설거지까지 걸린 시간이", "최근 한 달 평균 식사 후 정리 시간", "오늘 식사 후 정리 시간", "길었어요", "짧았어요"),
    "outing_count": MetricDisplay("count", "외출 횟수가", "최근 한 달 평균 외출 횟수", "오늘 외출 횟수", "많았어요", "적었어요"),
    "total_outing_minutes": MetricDisplay("duration_minutes", "외출한 시간이", "최근 한 달 평균 외출 시간", "오늘 외출 시간", "길었어요", "짧았어요"),
    "first_outing_time": MetricDisplay("time", "첫 외출 시각이", "최근 한 달 평균 첫 외출 시각", "오늘 첫 외출 시각", "늦었어요", "빨랐어요"),
    "last_return_time": MetricDisplay("time", "마지막 귀가 시각이", "최근 한 달 평균 마지막 귀가 시각", "오늘 마지막 귀가 시각", "늦었어요", "빨랐어요"),
    "short_return_reexit_count": MetricDisplay("count", "귀가 후 15분 이내 다시 외출한 경우가", "최근 한 달 평균 단시간 재외출 횟수", "오늘 단시간 재외출 횟수", "많았어요", "적었어요"),
    "fridge_open_count": MetricDisplay("count", "냉장고 문을 연 횟수가", "최근 한 달 평균 사용 횟수", "오늘 사용 횟수", "많았어요", "적었어요"),
    "fridge_total_open_seconds": MetricDisplay("duration_seconds", "냉장고 문이 열려 있던 총시간이", "최근 한 달 평균 총 개방 시간", "오늘 총 개방 시간", "길었어요", "짧았어요"),
    "fridge_max_open_seconds": MetricDisplay("duration_seconds", "냉장고 문이 가장 오래 열린 시간이", "최근 한 달 평균 최장 개방 시간", "오늘 최장 개방 시간", "길었어요", "짧았어요"),
    "fridge_long_open_count": MetricDisplay("count", "냉장고 문이 3분 이상 열린 경우가", "최근 한 달 평균 장시간 개방 횟수", "오늘 장시간 개방 횟수", "많았어요", "적었어요"),
    "fridge_no_motion_count": MetricDisplay("count", "냉장고 문을 연 뒤 움직임 없음이", "최근 한 달 평균 개방 후 움직임 없음 횟수", "오늘 개방 후 움직임 없음 횟수", "많았어요", "적었어요"),
    "tv_on_count": MetricDisplay("count", "TV를 켠 횟수가", "최근 한 달 평균 TV 켜짐 횟수", "오늘 TV 켜짐 횟수", "많았어요", "적었어요"),
    "tv_usage_minutes": MetricDisplay("duration_minutes", "TV 시청 시간이", "최근 한 달 평균 시청 시간", "오늘 시청 시간", "길었어요", "짧았어요"),
    "purifier_dispense_count": MetricDisplay("count", "정수기를 사용한 횟수가", "최근 한 달 평균 정수기 사용 횟수", "오늘 정수기 사용 횟수", "많았어요", "적었어요"),
    "purifier_volume_ml": MetricDisplay("volume_ml", "정수기 출수량이", "최근 한 달 평균 출수량", "오늘 출수량", "많았어요", "적었어요"),
    "cooling_usage_minutes": MetricDisplay("duration_minutes", "에어컨 사용 시간이", "최근 한 달 평균 에어컨 사용 시간", "오늘 에어컨 사용 시간", "길었어요", "짧았어요"),
    "heating_usage_minutes": MetricDisplay("duration_minutes", "난방기구 사용 시간이", "최근 한 달 평균 난방기구 사용 시간", "오늘 난방기구 사용 시간", "길었어요", "짧았어요"),
    "care_guidance_count": MetricDisplay("count", "돌봄 안내 횟수가", "최근 한 달 평균 돌봄 안내 횟수", "오늘 돌봄 안내 횟수", "많았어요", "적었어요"),
    "care_completed_count": MetricDisplay("count", "안내 후 생활 행동 완료가", "최근 한 달 평균 생활 행동 완료 횟수", "오늘 생활 행동 완료 횟수", "많았어요", "적었어요"),
    "care_no_response_count": MetricDisplay("count", "돌봄 안내 미응답이", "최근 한 달 평균 미응답 횟수", "오늘 미응답 횟수", "많았어요", "적었어요"),
    "care_response_minutes_avg": MetricDisplay("duration_minutes", "돌봄 안내에 응답하기까지 걸린 시간이", "최근 한 달 평균 응답 시간", "오늘 평균 응답 시간", "길었어요", "짧았어요"),
    "care_emergency_alert_count": MetricDisplay("count", "긴급 알림이", "최근 한 달 평균 긴급 알림 횟수", "오늘 긴급 알림 횟수", "많았어요", "적었어요"),
    "care_resolved_after_alert_count": MetricDisplay("count", "긴급 알림 뒤 생활 정상화가", "최근 한 달 평균 알림 후 정상화 횟수", "오늘 알림 후 정상화 횟수", "많았어요", "적었어요"),
}


BEHAVIOR_TIMELINE_TEXT = {
    "기상": "잠자리에서 일어났어요.",
    "수면": "잠자리에 들었어요.",
    "식사 준비": "식사를 준비했어요.",
    "식사": "식사를 했어요.",
    "설거지": "설거지를 했어요.",
    "휴식": "휴식을 취했어요.",
    "침실-화장실 이동": "침실과 화장실 사이를 이동했어요.",
    "외출": "외출했어요.",
    "귀가": "귀가했어요.",
    "집안일": "집안일을 했어요.",
    "낙상": "낙상 의심 움직임이 기록됐어요.",
}

APPLIANCE_TIMELINE_TEXT = {
    "tv_power_on_event": ("TV 시청", "TV 시청을 시작했어요."),
    "purifier_dispense_end_event": ("수분 섭취", "정수기를 사용해 물을 마셨어요."),
    "refrigerator_door_open_event": ("냉장고 사용", "냉장고 문을 열었어요."),
}


def _number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _event_time(value: Any) -> datetime:
    if isinstance(value, datetime):
        result = value
    else:
        result = datetime.fromisoformat(str(value))
    if result.tzinfo is None:
        result = result.replace(tzinfo=ZoneInfo("Asia/Seoul"))
    return result.astimezone(ZoneInfo("Asia/Seoul"))


def _evidence_ref(row: dict[str, Any]) -> str:
    return str(row["reporting_id"])


def _care_event_id(row: dict[str, Any]) -> str:
    match = CARE_EVENT_ID_PATTERN.search(str(row.get("evidence") or ""))
    if not match:
        raise ValueError("돌봄 event evidence에 care_event_id가 없습니다.")
    return match.group(1).lower()


def _round_half_up(value: float, places: str = "1") -> Decimal:
    return Decimal(str(value)).quantize(Decimal(places), rounding=ROUND_HALF_UP)


def _format_duration_minutes(value: float) -> str:
    total_minutes = int(_round_half_up(value))
    hours, minutes = divmod(total_minutes, 60)
    if hours and minutes:
        return f"{hours}시간 {minutes}분"
    if hours:
        return f"{hours}시간"
    return f"{minutes}분"


def _format_liters(milliliters: float) -> str:
    liters = _round_half_up(milliliters / 1000, "0.1")
    return f"{int(liters)}L" if liters == liters.to_integral() else f"{liters:.1f}L"


def _format_count(value: float, *, average: bool) -> str:
    rounded = _round_half_up(value, "0.1" if average else "1")
    text = str(int(rounded)) if rounded == rounded.to_integral() else f"{rounded:.1f}"
    return f"{text}회"


def build_timeline(records: list[dict[str, Any]]) -> list[TimelineItem]:
    candidates: list[tuple[int, datetime, TimelineItem]] = []
    events = [row for row in records if row["record_type"] == "event"]

    for row in events:
        if row["subject_type"] != "behavior" or row["subject"] not in BEHAVIOR_TIMELINE_TEXT:
            continue
        occurred_at = _event_time(row["event_time"])
        title = str(row["subject"])
        candidates.append(
            (
                2,
                occurred_at,
                TimelineItem(
                    time=occurred_at.strftime("%H:%M"),
                    title=title,
                    description=BEHAVIOR_TIMELINE_TEXT[title],
                    severity="attention" if title == "낙상" else "normal",
                    evidence_refs=[_evidence_ref(row)],
                ),
            )
        )

    for row in events:
        if row["subject_type"] != "appliance":
            continue
        display = APPLIANCE_TIMELINE_TEXT.get(str(row["metric_code"]))
        if display is None:
            continue
        occurred_at = _event_time(row["event_time"])
        title, description = display
        candidates.append(
            (
                3,
                occurred_at,
                TimelineItem(
                    time=occurred_at.strftime("%H:%M"),
                    title=title,
                    description=description,
                    severity="normal",
                    evidence_refs=[_evidence_ref(row)],
                ),
            )
        )

    care_groups: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: {"guidance": [], "response": []}
    )
    for row in events:
        if row["subject_type"] != "care":
            continue
        code = str(row["metric_code"])
        if code not in {"care_guidance_sent_event", "care_response_confirmed_event"}:
            continue
        group = care_groups[_care_event_id(row)]
        group["guidance" if code == "care_guidance_sent_event" else "response"].append(row)

    title_by_subject = {"식사": "식사", "정수기 사용": "수분 섭취", "휴식": "휴식"}
    for care_event_id, group in care_groups.items():
        if len(group["guidance"]) != 1 or len(group["response"]) > 1:
            raise ValueError(f"돌봄 사건 연결이 올바르지 않습니다: {care_event_id}")
        guidance = group["guidance"][0]
        guidance_at = _event_time(guidance["event_time"])
        title = title_by_subject.get(str(guidance["subject"]), str(guidance["subject"]))
        if group["response"]:
            response = group["response"][0]
            response_at = _event_time(response["event_time"])
            if response_at < guidance_at:
                raise ValueError("돌봄 행동 확인 시각이 안내 시각보다 빠릅니다.")
            elapsed = (response_at - guidance_at).total_seconds() / 60
            action = {
                "식사": "식사를 했어요.",
                "수분 섭취": "물을 마셨어요.",
                "휴식": "휴식을 취했어요.",
            }.get(title, "생활 행동을 마쳤어요.")
            item = TimelineItem(
                time=response_at.strftime("%H:%M"),
                title=title,
                description=(
                    f"{guidance_at.strftime('%H:%M')} {title} 안내 후 "
                    f"{_format_duration_minutes(elapsed)} 만에 {action}"
                ),
                severity="normal",
                evidence_refs=[_evidence_ref(guidance), _evidence_ref(response)],
            )
            candidates.append((1, response_at, item))
        else:
            candidates.append(
                (
                    0,
                    guidance_at,
                    TimelineItem(
                        time=guidance_at.strftime("%H:%M"),
                        title=f"{title} 안내",
                        description=f"{title}를 안내했지만 이후 생활 행동 기록은 없어요.",
                        severity="attention",
                        evidence_refs=[_evidence_ref(guidance)],
                    ),
                )
            )

    selected = sorted(candidates, key=lambda item: (item[0], item[1]))[:MAX_TIMELINE_ITEMS]
    return [item for _, _, item in sorted(selected, key=lambda value: value[1])]


def _format_minute_of_day(value: float) -> str:
    total_minutes = int(_round_half_up(value)) % (24 * 60)
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _format_display_value(value: float, kind: str, *, average: bool) -> str:
    if kind == "time":
        return _format_minute_of_day(value)
    if kind == "duration_minutes":
        return _format_duration_minutes(value)
    if kind == "duration_seconds":
        return _format_duration_minutes(value / 60)
    if kind == "volume_ml":
        return _format_liters(value)
    if kind == "count":
        return _format_count(value, average=average)
    raise ValueError(f"지원하지 않는 화면 표시 유형입니다: {kind}")


def _signed_difference(value: float, baseline: float, kind: str) -> float:
    difference = value - baseline
    if kind == "time":
        return (difference + 720) % 1440 - 720
    return difference


def _format_difference(value: float, kind: str) -> str:
    if kind == "time":
        return _format_duration_minutes(value)
    return _format_display_value(value, kind, average=kind == "count")


def _passes_threshold(code: str, unit: str, value: float, baseline: float) -> bool:
    delta = abs(
        _signed_difference(value, baseline, "time")
        if unit == "minute_of_day"
        else value - baseline
    )
    if unit == "minute_of_day":
        return delta >= TIME_DIFFERENCE_MINUTES
    if unit == "count":
        if delta < COUNT_ABSOLUTE_DIFFERENCE:
            return False
        return baseline == 0 or delta / abs(baseline) >= COUNT_RELATIVE_DIFFERENCE
    if unit == "minute":
        return delta >= MINUTE_DIFFERENCE
    if unit == "second":
        return delta >= SECOND_DIFFERENCE
    if unit == "mL":
        return delta >= MILLILITER_DIFFERENCE
    return False


def _threshold_size(unit: str, baseline: float) -> float:
    if unit == "minute_of_day":
        return TIME_DIFFERENCE_MINUTES
    if unit == "count":
        return max(COUNT_ABSOLUTE_DIFFERENCE, abs(baseline) * COUNT_RELATIVE_DIFFERENCE)
    if unit == "minute":
        return MINUTE_DIFFERENCE
    if unit == "second":
        return SECOND_DIFFERENCE
    if unit == "mL":
        return MILLILITER_DIFFERENCE
    raise ValueError(f"highlight 임계값이 정의되지 않은 단위입니다: {unit}")


def _baseline_text(display: MetricDisplay, baseline: float | None) -> str:
    if baseline is None:
        return f"{display.baseline_label}: 비교 자료 없음"
    return (
        f"{display.baseline_label}: "
        f"{_format_display_value(baseline, display.kind, average=True)}"
    )


def build_highlights(
    records: list[dict[str, Any]], baseline_metrics: dict[str, Any]
) -> list[Highlight]:
    metric_rows = [row for row in records if row["record_type"] == "metric"]
    rows_by_code: dict[str, dict[str, Any]] = {}
    for row in metric_rows:
        code = str(row["metric_code"])
        if code in rows_by_code:
            raise ValueError(f"하루 metric이 중복됐습니다: {code}")
        rows_by_code[code] = row

    safety_candidates: dict[str, Highlight] = {}
    normal_candidates: dict[str, tuple[float, int, Highlight]] = {}
    for row in metric_rows:
        code = str(row["metric_code"])
        if code not in VISIBLE_HIGHLIGHT_CODES:
            continue
        value = _number(row.get("value"))
        if value is None:
            continue
        unit = str(row.get("unit") or "")
        category = str(row["subject_type"])
        display = METRIC_DISPLAYS[code]
        baseline_item = baseline_metrics.get(code)
        baseline = (
            _number(baseline_item.get("average_value"))
            if isinstance(baseline_item, dict)
            else None
        )

        if code in SAFETY_HIGHLIGHT_CODES:
            if value <= 0:
                continue
            title = f"{display.title_prefix} {_format_count(value, average=False)} 있었어요."
            evidence_refs = [_evidence_ref(row)]
            if code == "care_emergency_alert_count":
                resolved_row = rows_by_code.get("care_resolved_after_alert_count")
                resolved = _number(resolved_row.get("value")) if resolved_row else None
                if resolved is not None and resolved > 0:
                    title = (
                        f"긴급 알림이 {_format_count(value, average=False)} 있었고, "
                        f"이후 생활 정상화도 {_format_count(resolved, average=False)} 확인됐어요."
                    )
                    evidence_refs.append(_evidence_ref(resolved_row))
            safety_candidates[code] = Highlight(
                category=category if category in {"appliance", "behavior", "care"} else "other",
                title=title,
                baseline=_baseline_text(display, baseline),
                today=(
                    f"{display.today_label}: "
                    f"{_format_display_value(value, display.kind, average=False)}"
                ),
                severity="attention",
                evidence_refs=evidence_refs,
            )
            continue

        if baseline is None or not _passes_threshold(code, unit, value, baseline):
            continue
        difference = _signed_difference(value, baseline, display.kind)
        direction = display.higher if difference > 0 else display.lower
        difference_display = _format_difference(abs(difference), display.kind)
        group = CODE_TO_HIGHLIGHT_GROUP[code]
        group_position = HIGHLIGHT_GROUPS[group].index(code)
        normalized_difference = abs(difference) / _threshold_size(unit, baseline)
        highlight = Highlight(
            category=category if category in {"appliance", "behavior", "care"} else "other",
            title=f"{display.title_prefix} 평소보다 {difference_display} {direction}.",
            baseline=_baseline_text(display, baseline),
            today=(
                f"{display.today_label}: "
                f"{_format_display_value(value, display.kind, average=False)}"
            ),
            severity="notice",
            evidence_refs=[_evidence_ref(row)],
        )
        previous = normal_candidates.get(group)
        if previous is None or (normalized_difference, -group_position) > (
            previous[0], -previous[1]
        ):
            normal_candidates[group] = (normalized_difference, group_position, highlight)

    safety = [
        safety_candidates[code]
        for code in SAFETY_HIGHLIGHT_ORDER
        if code in safety_candidates
    ]
    selection_order = list(NORMAL_HIGHLIGHT_ORDER)
    if {"fridge_long_open_count", "fridge_no_motion_count"} & safety_candidates.keys():
        selection_order.remove("fridge")
        selection_order.append("fridge")
    normal_limit = min(MAX_NORMAL_HIGHLIGHTS, MAX_HIGHLIGHTS - len(safety))
    selected_groups = [
        group for group in selection_order if group in normal_candidates
    ][:normal_limit]
    selected_group_set = set(selected_groups)
    normal = [
        normal_candidates[group][2]
        for group in NORMAL_HIGHLIGHT_ORDER
        if group in selected_group_set
    ]
    return safety + normal


def build_confirmed_facts(
    records: list[dict[str, Any]],
    timeline: list[TimelineItem],
    highlights: list[Highlight],
) -> dict[str, Any]:
    metrics = {
        str(row["metric_code"]): _number(row.get("value"))
        for row in records
        if row["record_type"] == "metric"
    }
    return {
        "timeline": [item.model_dump(exclude={"evidence_refs"}) for item in timeline],
        "highlights": [item.model_dump(exclude={"evidence_refs"}) for item in highlights],
        "care": {
            "guidance_count": metrics.get("care_guidance_count"),
            "completed_count": metrics.get("care_completed_count"),
            "no_response_count": metrics.get("care_no_response_count"),
            "average_response_minutes": metrics.get("care_response_minutes_avg"),
            "emergency_alert_count": metrics.get("care_emergency_alert_count"),
            "resolved_after_alert_count": metrics.get("care_resolved_after_alert_count"),
        },
    }


def fallback_summary(facts: dict[str, Any]) -> str:
    care = facts["care"]
    guidance = int(care["guidance_count"] or 0)
    completed = int(care["completed_count"] or 0)
    no_response = int(care["no_response_count"] or 0)
    emergency = int(care["emergency_alert_count"] or 0)
    first = "이날의 주요 생활 흐름을 시간 순서대로 정리했어요."
    if guidance:
        second = f"돌봄 안내는 {guidance}회 있었고, 그중 {completed}회는 생활 행동으로 이어졌어요."
    else:
        second = "이날은 별도의 돌봄 안내가 없었어요."
    if no_response == 0 and emergency == 0:
        third = "미응답과 긴급 알림은 없었어요."
    else:
        third = f"응답이 없었던 안내는 {no_response}회, 긴급 알림은 {emergency}회 있었어요."
    return " ".join((first, second, third))


def build_report_content(
    summary: str,
    timeline: list[TimelineItem],
    highlights: list[Highlight],
) -> ReportContent:
    severity_order = {"normal": 0, "notice": 1, "attention": 2}
    severities = [item.severity for item in timeline] + [item.severity for item in highlights]
    overall = max(severities or ["normal"], key=severity_order.__getitem__)
    return ReportContent(
        overall_status=overall,
        title="일일 생활 리포트",
        summary=summary,
        timeline=timeline,
        highlights=highlights,
    )
