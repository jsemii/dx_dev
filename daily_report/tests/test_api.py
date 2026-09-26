from datetime import timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.main import get_report
from app.report_service import SEOUL, datetime as service_datetime


client = TestClient(app)


def test_health() -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_get_missing_report(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.load_report_from_database",
        lambda *args: (_ for _ in ()).throw(FileNotFoundError("missing")),
    )
    response = client.get("/api/v1/reports/home_a/2026-09-20?model=gpt-5-mini")
    assert response.status_code == 404


def test_get_reads_database_without_openai(monkeypatch) -> None:
    sentinel = object()
    monkeypatch.setattr("app.main.load_report_from_database", lambda *args: sentinel)
    monkeypatch.setattr(
        "app.report_service.generate_summary",
        lambda *args: (_ for _ in ()).throw(AssertionError("OpenAI must not run")),
    )
    assert get_report("home_a", "2026-09-20") is sentinel


def test_today_get_returns_existing_report_without_generation(monkeypatch) -> None:
    today = service_datetime.now(SEOUL).date().isoformat()
    sentinel = object()
    monkeypatch.setattr("app.main.load_report_from_database", lambda *args: sentinel)
    monkeypatch.setattr(
        "app.main.create_daily_report",
        lambda *args: (_ for _ in ()).throw(AssertionError("generation must not run")),
    )
    assert get_report("home_23", today) is sentinel


def test_today_missing_report_is_404_without_generation(monkeypatch) -> None:
    today = service_datetime.now(SEOUL).date().isoformat()
    monkeypatch.setattr(
        "app.main.load_report_from_database",
        lambda *args: (_ for _ in ()).throw(FileNotFoundError("missing")),
    )
    monkeypatch.setattr(
        "app.main.create_daily_report",
        lambda *args: (_ for _ in ()).throw(AssertionError("generation must not run")),
    )
    response = client.get(f"/api/v1/reports/home_23/{today}")
    assert response.status_code == 404


def test_future_get_and_today_post_are_blocked_before_repository(monkeypatch) -> None:
    today = service_datetime.now(SEOUL).date()
    future = (today + timedelta(days=1)).isoformat()
    calls = []
    monkeypatch.setattr("app.main.load_report_from_database", lambda *args: calls.append("get"))
    monkeypatch.setattr("app.main.create_daily_report", lambda *args: calls.append("post"))

    get_response = client.get(f"/api/v1/reports/home_23/{future}")
    post_response = client.post("/api/v1/reports/generate", json={
        "profile": "one_person",
        "home_id": "home_23",
        "report_date": today.isoformat(),
        "force": False,
    })
    assert get_response.status_code == 400
    assert post_response.status_code == 400
    assert calls == []
