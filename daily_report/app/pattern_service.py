from __future__ import annotations

from collections import defaultdict
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from app.models import LifePatternState


PATTERN_WINDOW = 30
LIFE_METRIC_CODES = (
    "first_activity_time",
    "last_activity_time",
    "activity_event_count",
    "longest_inactivity_minutes",
    "no_motion_event_count",
    "fall_event_count",
    "night_movement_count",
    "bed_to_toilet_count",
    "meal_count",
    "first_meal_time",
    "last_meal_time",
    "meal_preparation_count",
    "dishwashing_count",
    "meal_to_dishwashing_minutes",
    "outing_count",
    "total_outing_minutes",
    "first_outing_time",
    "last_return_time",
    "short_return_reexit_count",
    "fridge_open_count",
    "fridge_total_open_seconds",
    "fridge_max_open_seconds",
    "fridge_long_open_count",
    "fridge_no_motion_count",
    "tv_on_count",
    "tv_usage_minutes",
    "purifier_dispense_count",
    "purifier_volume_ml",
    "cooling_usage_minutes",
    "heating_usage_minutes",
)

CARE_SOURCE_CODES = (
    "care_guidance_count",
    "care_completed_count",
    "care_no_response_count",
    "care_response_minutes_avg",
    "care_emergency_alert_count",
    "care_resolved_after_alert_count",
)

VALID_DAY_POLICY = "ALL_30_METRIC_ROWS_PRESENT"


def _decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _round3(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def _validate_metadata(rows: list[dict[str, Any]], metric_code: str) -> dict[str, str]:
    metadata = {
        (str(row["subject_type"]), str(row["subject"]), str(row["unit"]))
        for row in rows
    }
    if len(metadata) != 1:
        raise ValueError(f"{metric_code}의 subject 또는 unit이 일관되지 않습니다.")
    subject_type, subject, unit = metadata.pop()
    return {"subject_type": subject_type, "subject": subject, "unit": unit}


def _life_metrics(
    metric_history: list[dict[str, Any]],
    as_of_date: date,
    observation_start_date: date | None = None,
    initial_values: dict[str, Decimal] | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], int]:
    all_by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    counts_by_date: dict[date, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in metric_history:
        if (
            row["data_date"] > as_of_date
            or (observation_start_date and row["data_date"] < observation_start_date)
            or row["metric_code"] not in LIFE_METRIC_CODES
        ):
            continue
        metric_code = str(row["metric_code"])
        all_by_code[metric_code].append(row)
        counts_by_date[row["data_date"]][metric_code] += 1

    if observation_start_date is not None:
        first_date = observation_start_date
    else:
        first_date = min(counts_by_date, default=None)

    if first_date is None or first_date > as_of_date:
        return {}, {}, 0

    expected_dates = [
        first_date + timedelta(days=offset)
        for offset in range((as_of_date - first_date).days + 1)
    ]
    for selected_date in expected_dates:
        counts = counts_by_date.get(selected_date, {})
        missing = [code for code in LIFE_METRIC_CODES if counts.get(code, 0) == 0]
        duplicated = [code for code in LIFE_METRIC_CODES if counts.get(code, 0) > 1]
        if missing or duplicated:
            raise ValueError(
                f"{selected_date} 생활 metric 행 구성이 잘못됐습니다. "
                f"missing={missing}, duplicated={duplicated}"
            )

    observed: dict[str, dict[str, Any]] = {}
    standard: dict[str, dict[str, Any]] = {}
    for metric_code in LIFE_METRIC_CODES:
        all_rows = all_by_code[metric_code]
        metadata = _validate_metadata(all_rows, metric_code)
        rows = sorted(
            (row for row in all_rows if row["value"] is not None),
            key=lambda row: (row["data_date"], str(row["reporting_id"])),
            reverse=True,
        )[:PATTERN_WINDOW]
        average = (
            sum((_decimal(row["value"]) for row in rows), Decimal(0)) / len(rows)
            if rows
            else None
        )
        item = {
            **metadata,
            "average_value": None if average is None else _round3(average),
            "valid_day_count": len(rows),
        }
        observed[metric_code] = item
        standard_average = average
        initial = (initial_values or {}).get(metric_code)
        if initial is not None and not rows:
            standard_average = initial
        elif initial is not None and len(rows) < PATTERN_WINDOW and average is not None:
            n = Decimal(len(rows))
            standard_average = (
                initial * (Decimal(PATTERN_WINDOW) - n) / PATTERN_WINDOW
                + average * n / PATTERN_WINDOW
            )
        standard[metric_code] = {
            **item,
            "average_value": (
                None if standard_average is None else _round3(standard_average)
            ),
        }
    return observed, standard, min(PATTERN_WINDOW, len(expected_dates))


def _care_metrics(
    metric_history: list[dict[str, Any]],
    as_of_date: date,
    observation_start_date: date | None = None,
) -> dict[str, dict[str, Any]]:
    by_date: dict[date, dict[str, Decimal | None]] = defaultdict(dict)
    for row in metric_history:
        code = str(row["metric_code"])
        if (
            row["data_date"] <= as_of_date
            and (not observation_start_date or row["data_date"] >= observation_start_date)
            and row["subject_type"] == "care"
            and code in CARE_SOURCE_CODES
        ):
            by_date[row["data_date"]][code] = (
                None if row["value"] is None else _decimal(row["value"])
            )

    if not by_date:
        return {}

    valid_dates: list[date] = []
    for selected_date, values in sorted(by_date.items()):
        missing = set(CARE_SOURCE_CODES) - set(values)
        if missing:
            raise ValueError(
                f"{selected_date} 돌봄 metric이 불완전합니다: {sorted(missing)}"
            )
        valid_dates.append(selected_date)
    selected_dates = valid_dates[-PATTERN_WINDOW:]
    selected = [by_date[selected_date] for selected_date in selected_dates]
    day_count = len(selected)

    guidance_total = sum(
        (values["care_guidance_count"] or Decimal(0) for values in selected),
        Decimal(0),
    )
    completed_total = sum(
        (values["care_completed_count"] or Decimal(0) for values in selected),
        Decimal(0),
    )
    emergency_total = sum(
        (values["care_emergency_alert_count"] or Decimal(0) for values in selected),
        Decimal(0),
    )
    resolved_total = sum(
        (values["care_resolved_after_alert_count"] or Decimal(0) for values in selected),
        Decimal(0),
    )
    days_without_guidance = sum(
        1 for values in selected if (values["care_guidance_count"] or 0) == 0
    )
    emergency_days = sum(
        1 for values in selected if (values["care_emergency_alert_count"] or 0) > 0
    )

    weighted_response_total = Decimal(0)
    response_weight = Decimal(0)
    for values in selected:
        average = values["care_response_minutes_avg"]
        completed = values["care_completed_count"] or Decimal(0)
        if average is not None and completed > 0:
            weighted_response_total += average * completed
            response_weight += completed

    def item(subject: str, unit: str, value: Decimal | None) -> dict[str, Any]:
        return {
            "subject_type": "care",
            "subject": subject,
            "unit": unit,
            "average_value": None if value is None else _round3(value),
            "valid_day_count": day_count,
        }

    return {
        "days_without_guidance_rate": item(
            "안내 없는 날 비율",
            "ratio",
            Decimal(days_without_guidance) / day_count if day_count else None,
        ),
        "guidance_completion_rate": item(
            "돌봄 안내 완료율",
            "ratio",
            completed_total / guidance_total if guidance_total > 0 else None,
        ),
        "average_response_minutes": item(
            "돌봄 평균 반응 시간",
            "minute",
            weighted_response_total / response_weight if response_weight > 0 else None,
        ),
        "emergency_alert_day_count": item(
            "긴급 알림 발생일",
            "day",
            Decimal(emergency_days),
        ),
        "resolved_after_alert_rate": item(
            "긴급 알림 후 정상화율",
            "ratio",
            resolved_total / emergency_total if emergency_total > 0 else None,
        ),
    }


def calculate_life_pattern(
    current: LifePatternState,
    metric_history: list[dict[str, Any]],
    as_of_date: date,
) -> LifePatternState:
    initial_values: dict[str, Decimal] = {}
    for code, raw in (
        ("first_activity_time", current.initial_wake_time),
        ("last_activity_time", current.initial_sleep_time),
        ("first_meal_time", current.initial_breakfast_time),
        ("last_meal_time", current.initial_dinner_time),
    ):
        if raw is not None:
            initial_values[code] = Decimal(raw.hour * 60 + raw.minute) + Decimal(raw.second) / 60
    observed_life, standard_life, valid_day_count = _life_metrics(
        metric_history,
        as_of_date,
        current.observation_start_date,
        initial_values,
    )
    care = _care_metrics(metric_history, as_of_date, current.observation_start_date)
    return replace(
        current,
        valid_day_count=valid_day_count,
        observed_pattern={**observed_life, **care},
        standard_pattern={**standard_life, **care},
        as_of_date=as_of_date,
    )


def calculate_retrospective_pattern(
    current: LifePatternState,
    metric_history: list[dict[str, Any]],
    as_of_date: date,
) -> LifePatternState:
    observed, standard, valid_day_count = _life_metrics(
        metric_history, as_of_date, observation_start_date=None, initial_values=None
    )
    care = _care_metrics(metric_history, as_of_date, observation_start_date=None)
    return replace(
        current,
        valid_day_count=valid_day_count,
        observed_pattern={**observed, **care},
        standard_pattern={**standard, **care},
        as_of_date=as_of_date,
    )
