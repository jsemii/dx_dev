from pathlib import Path

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


client = TestClient(app)


def test_health() -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_get_missing_report(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(get_settings(), "report_output_dir", tmp_path)
    response = client.get("/api/v1/reports/home_a/2026-09-20?model=gpt-5-mini")
    assert response.status_code == 404
