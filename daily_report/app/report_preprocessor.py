from datetime import date, datetime
from decimal import Decimal
from typing import Any

from app.config import ReportProfile


COMMON_FIELDS = (
    "row_id",
    "subject_type",
    "subject",
    "metric_code",
    "value",
    "unit",
    "data_status",
    "evidence",
)

SECOND_UNITS = {"s", "sec", "second", "seconds", "초"}


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _select_fields(record: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {field: _json_value(record.get(field)) for field in fields}


def _format_seconds_as_minutes(value: Any) -> str | None:
    if value is None:
        return None
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None

    if seconds == 0:
        return "0분"

    sign = "-" if seconds < 0 else ""
    absolute_seconds = abs(seconds)
    if absolute_seconds < 60:
        return f"{sign}1분 미만"

    rounded_minutes = max(1, int(absolute_seconds / 60 + 0.5))
    hours, minutes = divmod(rounded_minutes, 60)
    approximate = "약 " if absolute_seconds % 60 else ""
    if hours and minutes:
        return f"{sign}{approximate}{hours}시간 {minutes}분"
    if hours:
        return f"{sign}{approximate}{hours}시간"
    return f"{sign}{approximate}{minutes}분"


def _add_display_values(row: dict[str, Any]) -> None:
    unit = str(row.get("unit") or "").strip().lower()
    if unit not in SECOND_UNITS:
        return
    row["display_value"] = _format_seconds_as_minutes(row.get("value"))
    if "baseline_value" in row:
        row["display_baseline_value"] = _format_seconds_as_minutes(
            row.get("baseline_value")
        )
        row["display_delta_value"] = _format_seconds_as_minutes(
            row.get("delta_value")
        )


def preprocess_daily_records(
    profile: ReportProfile,
    report_date: str,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    if not records:
        raise ValueError("전처리할 데이터가 없습니다.")

    home_id = str(records[0]["home_id"])
    household_type = str(records[0]["household_type"])
    events: list[dict[str, Any]] = []
    metrics: list[dict[str, Any]] = []

    for record in records:
        if str(record["home_id"]) != home_id:
            raise ValueError("서로 다른 home_id의 행을 한 리포트에 사용할 수 없습니다.")

        if record["record_type"] == "event":
            event = _select_fields(record, COMMON_FIELDS)
            event["event_time"] = _json_value(record.get("event_time"))
            _add_display_values(event)
            events.append(event)
        elif record["record_type"] == "metric":
            metric = _select_fields(record, COMMON_FIELDS)
            metric.update(
                {
                    "baseline_value": _json_value(record.get("baseline_value")),
                    "delta_value": _json_value(record.get("delta_value")),
                    "baseline_days": _json_value(record.get("baseline_days")),
                }
            )
            _add_display_values(metric)
            metrics.append(metric)
        else:
            raise ValueError(f"지원하지 않는 record_type입니다: {record['record_type']}")

    events.sort(key=lambda row: row["event_time"] or "")
    return {
        "profile": profile,
        "home_id": home_id,
        "household_type": household_type,
        "report_date": report_date,
        "row_count": len(records),
        "event_count": len(events),
        "metric_count": len(metrics),
        "timeline_events": events,
        "daily_metrics": metrics,
    }
