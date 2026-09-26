from pathlib import Path

import pytest

from app.csv_loader import load_daily_metrics


FIXTURE = Path(__file__).parent / "fixtures" / "daily_metrics_test.csv"


def test_filters_sorts_and_normalizes_rows() -> None:
    rows = load_daily_metrics(FIXTURE, "home_a", "2026-09-20")
    assert [row["row_id"] for row in rows] == [1, 2]
    assert rows[0]["subject"] == "refrigerator"
    assert rows[1]["value"] == 12.5
    assert rows[0]["baseline_days"] == 7


def test_rejects_missing_selection() -> None:
    with pytest.raises(ValueError, match="해당하는 행이 없습니다"):
        load_daily_metrics(FIXTURE, "missing", "2026-09-20")
