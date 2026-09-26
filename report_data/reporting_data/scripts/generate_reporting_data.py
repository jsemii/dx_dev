#!/usr/bin/env python3
"""Build one report-ready Parquet from augmented appliance and behavior events.

The output contains two record types in a single schema:
  * event: every source appliance/behavior event with an exact event_time
  * metric: 30 fixed daily metrics with rolling baselines from prior valid days

This is augmented demonstration data, not direct observation of 50 households.
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
import json
from pathlib import Path
import statistics
import sys
import tempfile
from typing import Any, Iterable

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from back.api.appliance_intervals import CALCULATED, calculate_tv_intervals

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ModuleNotFoundError as exc:  # pragma: no cover
    raise SystemExit(
        "pyarrow가 필요합니다. 프로젝트 가상환경에서 "
        "`.venv/bin/python -m pip install pyarrow`를 실행하세요."
    ) from exc


START_DATE = date(2025, 9, 23)
END_DATE = date(2026, 9, 22)
BASELINE_WINDOW = 30
LONG_FRIDGE_OPEN_SECONDS = 180
FRIDGE_NO_MOTION_WINDOW_SECONDS = 120
SHORT_REEXIT_MINUTES = 15

COLUMNS = [
    "home_id",
    "household_type",
    "date",
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
]

SCHEMA = pa.schema(
    [
        ("home_id", pa.string()),
        ("household_type", pa.string()),
        ("date", pa.date32()),
        ("event_time", pa.timestamp("ms")),
        ("record_type", pa.string()),
        ("subject_type", pa.string()),
        ("subject", pa.string()),
        ("metric_code", pa.string()),
        ("value", pa.float64()),
        ("unit", pa.string()),
        ("baseline_value", pa.float64()),
        ("delta_value", pa.float64()),
        ("baseline_days", pa.int16()),
        ("data_status", pa.string()),
        ("evidence", pa.string()),
    ]
)


@dataclass(frozen=True)
class MetricSpec:
    code: str
    subject_type: str
    subject: str
    unit: str
    description: str
    calculation: str


METRICS = [
    MetricSpec("first_activity_time", "behavior", "생활 활동", "minute_of_day", "하루 첫 행동 시각", "행동 event_time 최솟값"),
    MetricSpec("last_activity_time", "behavior", "생활 활동", "minute_of_day", "하루 마지막 행동 시각", "행동 event_time 최댓값"),
    MetricSpec("activity_event_count", "behavior", "생활 활동", "count", "전체 행동 사건 수", "행동 이벤트 행 수"),
    MetricSpec("longest_inactivity_minutes", "behavior", "생활 활동", "minute", "가장 긴 행동 미관측 구간", "연속 행동 event_time 간격의 최댓값"),
    MetricSpec("no_motion_event_count", "behavior", "움직임 없음", "count", "움직임 없음 감지 횟수", "behavior=움직임 없음 행 수"),
    MetricSpec("fall_event_count", "behavior", "낙상", "count", "낙상 의심 횟수", "behavior=낙상 행 수"),
    MetricSpec("night_movement_count", "behavior", "야간 활동", "count", "00~06시 활동성 움직임 횟수", "수면·휴식·정적 행동을 제외한 00~06시 행동 수"),
    MetricSpec("bed_to_toilet_count", "behavior", "침실-화장실 이동", "count", "침실·화장실 이동 횟수", "behavior=침실-화장실 이동 행 수"),
    MetricSpec("meal_count", "behavior", "식사", "count", "식사 횟수", "behavior=식사 행 수"),
    MetricSpec("first_meal_time", "behavior", "식사", "minute_of_day", "첫 식사 시각", "식사 event_time 최솟값"),
    MetricSpec("last_meal_time", "behavior", "식사", "minute_of_day", "마지막 식사 시각", "식사 event_time 최댓값"),
    MetricSpec("meal_preparation_count", "behavior", "식사 준비", "count", "식사 준비 횟수", "behavior=식사 준비 행 수"),
    MetricSpec("dishwashing_count", "behavior", "설거지", "count", "설거지 횟수", "behavior=설거지 행 수"),
    MetricSpec("meal_to_dishwashing_minutes", "behavior", "식사 후 정리", "minute", "식사 후 설거지까지 평균 시간", "식사 후 3시간 이내 첫 설거지 간격의 평균"),
    MetricSpec("outing_count", "behavior", "외출", "count", "외출 횟수", "behavior=외출 행 수"),
    MetricSpec("total_outing_minutes", "behavior", "외출", "minute", "하루 총 외출 시간", "외출과 다음 귀가를 짝지은 시간 합계"),
    MetricSpec("first_outing_time", "behavior", "외출", "minute_of_day", "첫 외출 시각", "외출 event_time 최솟값"),
    MetricSpec("last_return_time", "behavior", "귀가", "minute_of_day", "마지막 귀가 시각", "귀가 event_time 최댓값"),
    MetricSpec("short_return_reexit_count", "behavior", "외출", "count", "귀가 후 15분 이내 재외출 횟수", "귀가 다음 외출 간격이 15분 이하인 횟수"),
    MetricSpec("fridge_open_count", "appliance", "일반 냉장고", "count", "냉장고 문 열림 횟수", "문 열림 이벤트 수"),
    MetricSpec("fridge_total_open_seconds", "appliance", "일반 냉장고", "second", "냉장고 문 열린 총시간", "episode_id별 문 열림~닫힘 시간 합계"),
    MetricSpec("fridge_max_open_seconds", "appliance", "일반 냉장고", "second", "가장 긴 냉장고 문 열림 시간", "episode_id별 문 열림~닫힘 시간 최댓값"),
    MetricSpec("fridge_long_open_count", "appliance", "일반 냉장고", "count", "3분 이상 냉장고 문 열림 횟수", "열림 시간이 180초 이상인 episode 수"),
    MetricSpec("fridge_no_motion_count", "appliance", "일반 냉장고", "count", "냉장고 개방 후 움직임 없음 횟수", "문 열림 후 120초 이내 움직임 없음 행동 수"),
    MetricSpec("tv_on_count", "appliance", "TV", "count", "TV 켜짐 횟수", "켜짐 이벤트 수"),
    MetricSpec("tv_usage_minutes", "appliance", "TV", "minute", "TV 총 사용 시간", "episode_id별 켜짐~꺼짐 시간 합계"),
    MetricSpec("purifier_dispense_count", "appliance", "정수기", "count", "정수기 출수 횟수", "출수 종료 이벤트 수"),
    MetricSpec("purifier_volume_ml", "appliance", "정수기", "mL", "정수기 총 출수량", "출수 종료 행 volume_ml 합계"),
    MetricSpec("cooling_usage_minutes", "appliance", "에어컨", "minute", "에어컨 총 사용 시간", "episode_id별 켜짐~꺼짐 시간 합계"),
    MetricSpec("heating_usage_minutes", "appliance", "난방기구", "minute", "전기장판·온수매트 총 사용 시간", "episode_id별 사용 시작~종료 시간 합계"),
]

if len(METRICS) != 30:  # pragma: no cover
    raise RuntimeError("metric_code는 정확히 30개여야 합니다.")

METRIC_BY_CODE = {spec.code: spec for spec in METRICS}

APPLIANCE_SLUGS = {
    "일반 냉장고": "refrigerator",
    "김치 냉장고": "kimchi_refrigerator",
    "정수기": "purifier",
    "전기밥솥": "rice_cooker",
    "전기포트": "kettle",
    "전자레인지": "microwave",
    "에어프라이어": "air_fryer",
    "인덕션": "induction",
    "식기세척기": "dishwasher",
    "TV": "tv",
    "컴퓨터": "computer",
    "무선공유기/셋톱박스": "router_settop",
    "선풍기": "fan",
    "에어컨": "air_conditioner",
    "공기청정기": "air_purifier",
    "제습기": "dehumidifier",
    "세탁기": "washer",
    "의류건조기": "dryer",
    "유선 진공청소기": "vacuum",
    "헤어드라이기": "hair_dryer",
    "전기다리미": "iron",
    "전기장판/담요": "electric_blanket",
    "온수매트": "heated_mat",
}

ACTION_SLUGS = {
    "문 열림": "door_open",
    "문 닫힘": "door_close",
    "출수 시작": "dispense_start",
    "출수 종료": "dispense_end",
    "켜짐": "power_on",
    "꺼짐": "power_off",
    "사용 시작": "usage_start",
    "사용 종료": "usage_end",
    "전력 활성 시작": "power_active_start",
    "전력 활성 종료": "power_active_end",
}

BEHAVIOR_SLUGS = {
    "식사 준비": "meal_preparation",
    "식사": "meal",
    "설거지": "dishwashing",
    "휴식": "relax",
    "수면": "sleep",
    "침실-화장실 이동": "bedroom_bathroom_transition",
    "외출": "outing",
    "귀가": "return_home",
    "집안일": "housework",
    "작업": "work",
    "걷기": "walking",
    "서있음": "standing",
    "앉아있음": "sitting",
    "눕기": "lying_down",
    "자세 전환": "posture_transition",
    "방향 전환": "turning",
    "앉았다 일어나기": "sit_to_stand",
    "움직임 없음": "no_motion",
    "물건 줍기": "bend_pickup",
    "낙상": "fall",
}


def parse_args() -> argparse.Namespace:
    reporting_root = Path(__file__).resolve().parents[1]
    project_root = reporting_root.parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, default=project_root)
    parser.add_argument("--output-dir", type=Path, default=reporting_root / "augmented")
    parser.add_argument("--start-date", type=date.fromisoformat, default=START_DATE)
    parser.add_argument("--end-date", type=date.fromisoformat, default=END_DATE)
    parser.add_argument("--baseline-days", type=int, default=BASELINE_WINDOW)
    parser.add_argument("--limit-homes", type=int, default=None)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def date_range(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def minutes_since_midnight(value: datetime) -> float:
    return round(value.hour * 60 + value.minute + value.second / 60, 3)


def rounded(value: float | int | None) -> float | None:
    return None if value is None else round(float(value), 3)


def read_manifest(path: Path, limit: int | None) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    required = {"home_id", "household_type"}
    if not rows or not required.issubset(rows[0]):
        raise ValueError(f"가전 manifest 형식이 올바르지 않습니다: {path}")
    return rows if limit is None else rows[:limit]


def row_group_map(parquet: pq.ParquetFile) -> dict[str, int]:
    result: dict[str, int] = {}
    for index in range(parquet.num_row_groups):
        values = set(parquet.read_row_group(index, columns=["home_id"])["home_id"].to_pylist())
        if len(values) != 1:
            raise ValueError(f"row group {index}에 home_id가 여러 개 있습니다: {values}")
        home_id = values.pop()
        if home_id in result:
            raise ValueError(f"{home_id}가 여러 row group에 존재합니다.")
        result[home_id] = index
    return result


def appliance_event_code(appliance: str, action: str) -> str:
    return f"{APPLIANCE_SLUGS.get(appliance, 'appliance')}_{ACTION_SLUGS.get(action, 'event')}_event"


def behavior_event_code(behavior: str) -> str:
    return f"{BEHAVIOR_SLUGS.get(behavior, 'behavior')}_observation_event"


def appliance_evidence(data: dict[str, list[Any]], index: int) -> str:
    fields = [
        f"episode_id={data['episode_id'][index]}",
        f"evidence={data['evidence'][index]}",
        f"source_file={data['source_file'][index]}",
        f"source_anchor={data['source_anchor'][index]}",
        f"scenario_note={data['scenario_note'][index]}",
    ]
    return ";".join(fields)


def behavior_status(source_status: str) -> str:
    if "source=CASAS-Aruba" in source_status:
        return "casas_template_augmented"
    if "source=ESP-Fi-HAR" in source_status:
        return "public_csi_context_replay"
    if "source=collected-ESP" in source_status:
        return "collected_csi_context_replay"
    return "augmented_behavior_event"


def build_event_rows(
    home_id: str,
    household_type: str,
    appliance_data: dict[str, list[Any]],
    behavior_data: dict[str, list[Any]],
) -> tuple[dict[date, list[dict[str, Any]]], dict[date, list[dict[str, Any]]], dict[date, list[dict[str, Any]]]]:
    rows_by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)
    appliances_by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)
    behaviors_by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)

    source_event_ids = appliance_data.get("event_id")
    for index, event_time in enumerate(appliance_data["event_time"]):
        appliance = appliance_data["appliance"][index]
        action = appliance_data["action"][index]
        volume = appliance_data["volume_ml"][index]
        item = {
            "event_id": (
                str(source_event_ids[index])
                if source_event_ids is not None and source_event_ids[index] is not None
                else f"{home_id}:appliance:{index}"
            ),
            "event_time": event_time,
            "appliance": appliance,
            "action": action,
            "episode_id": appliance_data["episode_id"][index],
            "volume_ml": volume,
        }
        appliances_by_day[event_time.date()].append(item)
        event_value = float(volume) if appliance == "정수기" and action == "출수 종료" and volume is not None else 1.0
        event_unit = "mL" if appliance == "정수기" and action == "출수 종료" and volume is not None else "event"
        rows_by_day[event_time.date()].append(
            {
                "home_id": home_id,
                "household_type": household_type,
                "date": event_time.date(),
                "event_time": event_time,
                "record_type": "event",
                "subject_type": "appliance",
                "subject": appliance,
                "metric_code": appliance_event_code(appliance, action),
                "value": event_value,
                "unit": event_unit,
                "baseline_value": None,
                "delta_value": None,
                "baseline_days": None,
                "data_status": appliance_data["data_status"][index],
                "evidence": appliance_evidence(appliance_data, index),
            }
        )

    for event_time, location, behavior, source_status in zip(
        behavior_data["event_time"],
        behavior_data["location"],
        behavior_data["behavior"],
        behavior_data["source_status"],
    ):
        item = {"event_time": event_time, "location": location, "behavior": behavior, "source_status": source_status}
        behaviors_by_day[event_time.date()].append(item)
        rows_by_day[event_time.date()].append(
            {
                "home_id": home_id,
                "household_type": household_type,
                "date": event_time.date(),
                "event_time": event_time,
                "record_type": "event",
                "subject_type": "behavior",
                "subject": behavior,
                "metric_code": behavior_event_code(behavior),
                "value": 1.0,
                "unit": "event",
                "baseline_value": None,
                "delta_value": None,
                "baseline_days": None,
                "data_status": behavior_status(source_status),
                "evidence": f"location={location};{source_status}",
            }
        )

    for values in rows_by_day.values():
        values.sort(key=lambda row: (row["event_time"], row["subject_type"], row["metric_code"]))
    for values in appliances_by_day.values():
        values.sort(key=lambda row: row["event_time"])
    for values in behaviors_by_day.values():
        values.sort(key=lambda row: row["event_time"])
    return rows_by_day, appliances_by_day, behaviors_by_day


def paired_durations(
    rows: list[dict[str, Any]],
    appliances: set[str],
    start_actions: set[str],
    end_actions: set[str],
) -> list[float]:
    episodes: dict[str, dict[str, datetime]] = defaultdict(dict)
    for row in rows:
        if row["appliance"] not in appliances:
            continue
        if row["action"] in start_actions:
            episodes[row["episode_id"]]["start"] = row["event_time"]
        elif row["action"] in end_actions:
            episodes[row["episode_id"]]["end"] = row["event_time"]
    durations = []
    for pair in episodes.values():
        if "start" in pair and "end" in pair and pair["end"] >= pair["start"]:
            durations.append((pair["end"] - pair["start"]).total_seconds())
    return durations


def behavior_times(rows: list[dict[str, Any]], name: str) -> list[datetime]:
    return [row["event_time"] for row in rows if row["behavior"] == name]


def meal_cleanup_average(meals: list[datetime], washes: list[datetime]) -> float | None:
    gaps: list[float] = []
    used: set[int] = set()
    for meal in meals:
        for index, wash in enumerate(washes):
            if index in used or wash < meal:
                continue
            gap = (wash - meal).total_seconds() / 60
            if gap <= 180:
                gaps.append(gap)
                used.add(index)
            break
    return statistics.fmean(gaps) if gaps else None


def outing_metrics(rows: list[dict[str, Any]], day: date) -> tuple[float, int]:
    total = 0.0
    outside_at: datetime | None = None
    short_reexit = 0
    previous_return: datetime | None = None
    for row in rows:
        moment = row["event_time"]
        if row["behavior"] == "외출":
            if previous_return is not None and 0 <= (moment - previous_return).total_seconds() <= SHORT_REEXIT_MINUTES * 60:
                short_reexit += 1
            if outside_at is None:
                outside_at = moment
        elif row["behavior"] == "귀가":
            previous_return = moment
            if outside_at is not None and moment >= outside_at:
                total += (moment - outside_at).total_seconds() / 60
                outside_at = None
    if outside_at is not None:
        day_end = datetime.combine(day, time.max).replace(microsecond=0)
        total += max(0.0, (day_end - outside_at).total_seconds() / 60)
    return total, short_reexit


def compute_metrics(
    day: date,
    appliance_rows: list[dict[str, Any]],
    behavior_rows: list[dict[str, Any]],
) -> dict[str, float | None]:
    behavior_moments = [row["event_time"] for row in behavior_rows]
    behavior_counts = Counter(row["behavior"] for row in behavior_rows)
    gaps = [
        (right - left).total_seconds() / 60
        for left, right in zip(behavior_moments, behavior_moments[1:])
        if right >= left
    ]
    meals = behavior_times(behavior_rows, "식사")
    washes = behavior_times(behavior_rows, "설거지")
    outings = behavior_times(behavior_rows, "외출")
    returns = behavior_times(behavior_rows, "귀가")
    total_outing, short_reexit = outing_metrics(behavior_rows, day)

    fridge_rows = [row for row in appliance_rows if row["appliance"] == "일반 냉장고"]
    fridge_opens = [row["event_time"] for row in fridge_rows if row["action"] == "문 열림"]
    fridge_durations = paired_durations(fridge_rows, {"일반 냉장고"}, {"문 열림"}, {"문 닫힘"})
    no_motion = behavior_times(behavior_rows, "움직임 없음")
    fridge_no_motion = sum(
        any(opened <= moment <= opened + timedelta(seconds=FRIDGE_NO_MOTION_WINDOW_SECONDS) for moment in no_motion)
        for opened in fridge_opens
    )

    tv_rows = [row for row in appliance_rows if row["appliance"] == "TV"]
    tv_calculation = calculate_tv_intervals(tv_rows) if tv_rows else None
    tv_usage_minutes = (
        float(tv_calculation["total_seconds"]) / 60
        if tv_calculation is not None and tv_calculation["status"] == CALCULATED
        else (0.0 if not tv_rows else None)
    )
    purifier_ends = [row for row in appliance_rows if row["appliance"] == "정수기" and row["action"] == "출수 종료"]
    cooling_durations = paired_durations(appliance_rows, {"에어컨"}, {"켜짐"}, {"꺼짐"})
    heating_durations = paired_durations(
        appliance_rows,
        {"전기장판/담요", "온수매트"},
        {"사용 시작"},
        {"사용 종료"},
    )
    active_night = {
        "걷기", "자세 전환", "방향 전환", "앉았다 일어나기", "물건 줍기",
        "침실-화장실 이동", "외출", "귀가", "집안일",
    }
    night_count = sum(
        row["behavior"] in active_night and row["event_time"].hour < 6
        for row in behavior_rows
    )

    return {
        "first_activity_time": minutes_since_midnight(behavior_moments[0]) if behavior_moments else None,
        "last_activity_time": minutes_since_midnight(behavior_moments[-1]) if behavior_moments else None,
        "activity_event_count": float(len(behavior_rows)),
        "longest_inactivity_minutes": max(gaps) if gaps else None,
        "no_motion_event_count": float(behavior_counts["움직임 없음"]),
        "fall_event_count": float(behavior_counts["낙상"]),
        "night_movement_count": float(night_count),
        "bed_to_toilet_count": float(behavior_counts["침실-화장실 이동"]),
        "meal_count": float(len(meals)),
        "first_meal_time": minutes_since_midnight(meals[0]) if meals else None,
        "last_meal_time": minutes_since_midnight(meals[-1]) if meals else None,
        "meal_preparation_count": float(behavior_counts["식사 준비"]),
        "dishwashing_count": float(len(washes)),
        "meal_to_dishwashing_minutes": meal_cleanup_average(meals, washes),
        "outing_count": float(len(outings)),
        "total_outing_minutes": total_outing,
        "first_outing_time": minutes_since_midnight(outings[0]) if outings else None,
        "last_return_time": minutes_since_midnight(returns[-1]) if returns else None,
        "short_return_reexit_count": float(short_reexit),
        "fridge_open_count": float(len(fridge_opens)),
        "fridge_total_open_seconds": sum(fridge_durations),
        "fridge_max_open_seconds": max(fridge_durations, default=0.0),
        "fridge_long_open_count": float(sum(value >= LONG_FRIDGE_OPEN_SECONDS for value in fridge_durations)),
        "fridge_no_motion_count": float(fridge_no_motion),
        "tv_on_count": float(sum(row["action"] == "켜짐" for row in tv_rows)),
        "tv_usage_minutes": tv_usage_minutes,
        "purifier_dispense_count": float(len(purifier_ends)),
        "purifier_volume_ml": float(sum((row["volume_ml"] or 0) for row in purifier_ends)),
        "cooling_usage_minutes": sum(cooling_durations) / 60,
        "heating_usage_minutes": sum(heating_durations) / 60,
    }


def metric_rows_for_home(
    home_id: str,
    household_type: str,
    days: Iterable[date],
    appliances_by_day: dict[date, list[dict[str, Any]]],
    behaviors_by_day: dict[date, list[dict[str, Any]]],
    baseline_window: int,
) -> dict[date, list[dict[str, Any]]]:
    history: dict[str, deque[float]] = {
        spec.code: deque(maxlen=baseline_window) for spec in METRICS
    }
    result: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for day in days:
        values = compute_metrics(day, appliances_by_day.get(day, []), behaviors_by_day.get(day, []))
        for spec in METRICS:
            value = rounded(values[spec.code])
            previous = list(history[spec.code])
            baseline = rounded(statistics.fmean(previous)) if previous else None
            delta = rounded(value - baseline) if value is not None and baseline is not None else None
            status = "derived_daily_metric" if value is not None else "unobserved_metric"
            result[day].append(
                {
                    "home_id": home_id,
                    "household_type": household_type,
                    "date": day,
                    "event_time": None,
                    "record_type": "metric",
                    "subject_type": spec.subject_type,
                    "subject": spec.subject,
                    "metric_code": spec.code,
                    "value": value,
                    "unit": spec.unit,
                    "baseline_value": baseline,
                    "delta_value": delta,
                    "baseline_days": len(previous),
                    "data_status": status,
                    "evidence": (
                        f"rule={spec.calculation};baseline=previous_{baseline_window}_valid_days;"
                        f"thresholds=long_fridge_open_{LONG_FRIDGE_OPEN_SECONDS}s,"
                        f"fridge_no_motion_{FRIDGE_NO_MOTION_WINDOW_SECONDS}s,"
                        f"short_reexit_{SHORT_REEXIT_MINUTES}m"
                    ),
                }
            )
            if value is not None:
                history[spec.code].append(value)
    return result


def write_csv_atomic(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8-sig", newline="", dir=path.parent,
        prefix=f".{path.stem}_", suffix=path.suffix, delete=False,
    ) as handle:
        temp = Path(handle.name)
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            out = dict(row)
            if isinstance(out.get("date"), date):
                out["date"] = out["date"].isoformat()
            if isinstance(out.get("event_time"), datetime):
                out["event_time"] = out["event_time"].strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            writer.writerow(out)
    temp.replace(path)


def write_metric_catalog(path: Path) -> None:
    rows = [
        {
            "metric_order": index,
            "metric_code": spec.code,
            "subject_type": spec.subject_type,
            "subject": spec.subject,
            "unit": spec.unit,
            "description": spec.description,
            "calculation": spec.calculation,
        }
        for index, spec in enumerate(METRICS, 1)
    ]
    write_csv_atomic(
        path,
        rows,
        ["metric_order", "metric_code", "subject_type", "subject", "unit", "description", "calculation"],
    )


def main() -> None:
    args = parse_args()
    root = args.project_root.resolve()
    output_dir = args.output_dir.resolve()
    appliance_root = root / "report_data" / "appliance_data" / "augmented"
    behavior_root = root / "report_data" / "behavior_data" / "augmented"
    appliance_path = appliance_root / "appliance_events_2025-09-23_2026-09-22.parquet"
    behavior_path = behavior_root / "behavior_events_2025-09-23_2026-09-22.parquet"
    manifest_path = appliance_root / "manifest.csv"
    for required in (appliance_path, behavior_path, manifest_path):
        if not required.exists():
            raise FileNotFoundError(required)
    if args.start_date > args.end_date:
        raise ValueError("start-date는 end-date보다 늦을 수 없습니다.")
    if args.baseline_days < 1:
        raise ValueError("baseline-days는 1 이상이어야 합니다.")

    homes = read_manifest(manifest_path, args.limit_homes)
    appliance_parquet = pq.ParquetFile(appliance_path)
    behavior_parquet = pq.ParquetFile(behavior_path)
    appliance_groups = row_group_map(appliance_parquet)
    behavior_groups = row_group_map(behavior_parquet)
    selected_ids = {row["home_id"] for row in homes}
    if not selected_ids.issubset(appliance_groups) or not selected_ids.issubset(behavior_groups):
        raise ValueError("가전·행동 Parquet의 home_id 구성이 일치하지 않습니다.")

    suffix = "" if args.limit_homes is None else f"_smoke_{len(homes)}homes"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir = output_dir / "preview"
    output_path = output_dir / f"reporting_data_{args.start_date}_{args.end_date}{suffix}.parquet"
    manifest_out = output_dir / f"manifest{suffix}.csv"
    summary_out = output_dir / f"summary{suffix}.json"
    catalog_out = output_dir / f"metric_catalog{suffix}.csv"
    preview_path = preview_dir / f"home_01_{args.end_date}{suffix}.csv"
    targets = [output_path, manifest_out, summary_out, catalog_out, preview_path]
    existing = [path for path in targets if path.exists()]
    if existing and not args.overwrite:
        raise FileExistsError("이미 결과가 있습니다. --overwrite를 사용하세요: " + ", ".join(map(str, existing)))

    temp_output = output_path.with_name(f".{output_path.name}.tmp")
    temp_output.unlink(missing_ok=True)
    days = list(date_range(args.start_date, args.end_date))
    total_event_rows = 0
    total_metric_rows = 0
    manifest_rows: list[dict[str, Any]] = []
    preview_rows: list[dict[str, Any]] = []
    record_counts = Counter()
    subject_counts = Counter()

    appliance_columns = [
        "home_id", "appliance", "action", "event_time", "episode_id", "data_status",
        "evidence", "source_file", "source_anchor", "scenario_note", "volume_ml",
    ]
    behavior_columns = ["home_id", "location", "event_time", "behavior", "source_status"]
    try:
        with pq.ParquetWriter(temp_output, SCHEMA, compression="zstd", use_dictionary=True) as writer:
            for index, home in enumerate(homes, 1):
                home_id = home["home_id"]
                household_type = home["household_type"]
                appliance_data = appliance_parquet.read_row_group(
                    appliance_groups[home_id], columns=appliance_columns
                ).to_pydict()
                behavior_data = behavior_parquet.read_row_group(
                    behavior_groups[home_id], columns=behavior_columns
                ).to_pydict()
                event_rows, appliances_by_day, behaviors_by_day = build_event_rows(
                    home_id, household_type, appliance_data, behavior_data
                )
                metric_rows = metric_rows_for_home(
                    home_id,
                    household_type,
                    days,
                    appliances_by_day,
                    behaviors_by_day,
                    args.baseline_days,
                )
                home_rows: list[dict[str, Any]] = []
                event_count = 0
                metric_count = 0
                for day in days:
                    daily_events = event_rows.get(day, [])
                    daily_metrics = metric_rows[day]
                    home_rows.extend(daily_events)
                    home_rows.extend(daily_metrics)
                    event_count += len(daily_events)
                    metric_count += len(daily_metrics)
                    if home_id == "home_01" and day == args.end_date:
                        preview_rows = daily_events + daily_metrics

                if metric_count != len(days) * len(METRICS):
                    raise ValueError(f"{home_id} 지표 행 수가 올바르지 않습니다: {metric_count}")
                table = pa.Table.from_pylist(home_rows, schema=SCHEMA)
                writer.write_table(table)
                total_event_rows += event_count
                total_metric_rows += metric_count
                record_counts.update({"event": event_count, "metric": metric_count})
                subject_counts.update(row["subject_type"] for row in home_rows)
                manifest_rows.append(
                    {
                        "home_id": home_id,
                        "household_type": household_type,
                        "start_date": args.start_date.isoformat(),
                        "end_date": args.end_date.isoformat(),
                        "event_row_count": event_count,
                        "metric_row_count": metric_count,
                        "total_row_count": event_count + metric_count,
                        "baseline_window_days": args.baseline_days,
                    }
                )
                print(
                    f"[{index:02d}/{len(homes):02d}] {home_id}: "
                    f"events={event_count:,}, metrics={metric_count:,}, total={event_count + metric_count:,}"
                )
        temp_output.replace(output_path)
    except BaseException:
        temp_output.unlink(missing_ok=True)
        raise

    manifest_fields = [
        "home_id", "household_type", "start_date", "end_date", "event_row_count",
        "metric_row_count", "total_row_count", "baseline_window_days",
    ]
    write_csv_atomic(manifest_out, manifest_rows, manifest_fields)
    write_csv_atomic(preview_path, preview_rows, COLUMNS)
    write_metric_catalog(catalog_out)
    summary = {
        "output_file": output_path.name,
        "schema": COLUMNS,
        "start_date": args.start_date.isoformat(),
        "end_date": args.end_date.isoformat(),
        "days": len(days),
        "home_count": len(homes),
        "one_person_homes": sum(home["household_type"] == "one_person" for home in homes),
        "two_to_three_person_homes": sum(home["household_type"] == "two_to_three_person" for home in homes),
        "metric_code_count": len(METRICS),
        "event_row_count": total_event_rows,
        "metric_row_count": total_metric_rows,
        "total_row_count": total_event_rows + total_metric_rows,
        "record_type_counts": dict(record_counts),
        "subject_type_counts": dict(subject_counts),
        "baseline_policy": f"current day excluded; previous up to {args.baseline_days} valid values",
        "null_policy": {
            "event_baseline_fields": "null",
            "metric_event_time": "null",
            "unobserved_metric_value": "null",
            "observed_but_not_occurred": "0",
        },
        "notes": [
            "가전·행동 증강 이벤트와 30개 일별 지표를 한 Parquet에 저장합니다.",
            "record_type=event는 정확한 시각을, record_type=metric은 일별 집계를 뜻합니다.",
            "데이터는 합성·재배치된 데모용이며 50개 실측 가정을 의미하지 않습니다.",
        ],
    }
    summary_out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Parquet: {output_path}")
    print(f"Manifest: {manifest_out}")
    print(f"Metric catalog: {catalog_out}")
    print(f"Summary: {summary_out}")
    print(f"Preview: {preview_path}")
    print(f"Rows: events={total_event_rows:,}, metrics={total_metric_rows:,}, total={total_event_rows + total_metric_rows:,}")


if __name__ == "__main__":
    main()
