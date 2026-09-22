from datetime import date
import json
from pathlib import Path

from app.models import DailyReport


def _safe_segment(value: str, label: str) -> str:
    safe_value = "".join(
        char for char in value if char.isalnum() or char in {"-", "_", "."}
    )
    if not safe_value or safe_value != value:
        raise ValueError(f"{label} 값이 올바르지 않습니다.")
    return safe_value


def report_path(
    output_dir: Path,
    home_id: str,
    report_date: str,
    model: str,
) -> Path:
    try:
        date.fromisoformat(report_date)
    except ValueError as exc:
        raise ValueError("report_date 값이 올바르지 않습니다.") from exc
    safe_home_id = "".join(char for char in home_id if char.isalnum() or char in {"-", "_"})
    if not safe_home_id or safe_home_id != home_id:
        raise ValueError("home_id가 올바르지 않습니다.")
    safe_model = _safe_segment(model, "model")
    return output_dir / f"report_{safe_home_id}_{report_date}_{safe_model}.json"


def save_report(report: DailyReport, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = report_path(
        output_dir,
        report.home_id,
        report.report_date,
        report.source.model,
    )
    path.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    return path


def load_report(
    output_dir: Path,
    home_id: str,
    report_date: str,
    model: str,
) -> DailyReport:
    path = report_path(output_dir, home_id, report_date, model)
    if not path.exists():
        raise FileNotFoundError("생성된 리포트가 없습니다.")
    payload = json.loads(path.read_text(encoding="utf-8"))
    # Version 1 used one free-form description per highlight. Normalize it so
    # the service can detect the old version and regenerate it once.
    payload.setdefault("format_version", 1)
    for highlight in payload.get("content", {}).get("highlights", []):
        description = highlight.pop("description", "")
        highlight.setdefault(
            "baseline",
            (description[:160] if description else "이전 형식의 비교 내용"),
        )
        highlight.setdefault("today", "이전 형식의 오늘 내용")
    return DailyReport.model_validate(payload)
