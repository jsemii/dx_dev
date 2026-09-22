import csv
from datetime import date, datetime
from pathlib import Path
from typing import Any


REQUIRED_COLUMNS = {
    "home_id", "date", "event_time", "subject_type", "subject",
    "metric_code", "value", "unit", "baseline_value", "delta_value",
    "baseline_days", "data_status", "evidence",
}
NUMBER_COLUMNS = {"value", "baseline_value", "delta_value", "baseline_days"}
ALLOWED_DATA_STATUSES = {
    "observed",
    "synthetic",
    "estimated",
    "source_based_inference_with_synthetic_baseline",
    "derived_from_source_events_with_synthetic_baseline",
    "virtual_timeline_with_synthetic_baseline",
    "derived_virtual_interval_with_synthetic_baseline",
}


def _number_or_none(value: str) -> int | float | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError as exc:
        raise ValueError(f"숫자 열에 잘못된 값이 있습니다: {value}") from exc
    return int(number) if number.is_integer() else number


def _validate_iso_date(value: str) -> None:
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"날짜 형식이 올바르지 않습니다: {value}") from exc


def load_daily_metrics(path: Path, home_id: str, report_date: str) -> list[dict[str, Any]]:
    _validate_iso_date(report_date)
    if not path.exists():
        raise FileNotFoundError(f"CSV 파일을 찾을 수 없습니다: {path}")

    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        columns = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise ValueError(f"필수 열이 없습니다: {sorted(missing)}")

        selected: list[dict[str, Any]] = []
        for source_row_number, row in enumerate(reader, start=2):
            if (row["home_id"] or "").strip() != home_id:
                continue
            if (row["date"] or "").strip() != report_date:
                continue
            normalized = {key: (value or "").strip() for key, value in row.items()}
            try:
                datetime.fromisoformat(normalized["event_time"])
            except ValueError as exc:
                raise ValueError(
                    f"{source_row_number}행 event_time이 올바르지 않습니다: "
                    f"{normalized['event_time']}"
                ) from exc
            if normalized["data_status"] not in ALLOWED_DATA_STATUSES:
                raise ValueError(
                    f"{source_row_number}행 data_status가 올바르지 않습니다: "
                    f"{normalized['data_status']}"
                )
            for column in NUMBER_COLUMNS:
                normalized[column] = _number_or_none(row[column])
            normalized["source_row_number"] = source_row_number
            selected.append(normalized)

    if not selected:
        raise ValueError(f"home_id={home_id}, date={report_date}에 해당하는 행이 없습니다.")
    selected.sort(key=lambda item: datetime.fromisoformat(item["event_time"]))
    for row_id, row in enumerate(selected, start=1):
        row["row_id"] = row_id
    return selected
