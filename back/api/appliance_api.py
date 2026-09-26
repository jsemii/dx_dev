"""Serve a resident's daily care dashboard from PostgreSQL, read-only."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
import re
import shutil
import subprocess
from typing import Callable
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

try:  # Package execution: python -m back.api.appliance_api
    from .appliance_intervals import CALCULATED, calculate_tv_intervals
except ImportError:  # Docker/script execution: python appliance_api.py
    from appliance_intervals import CALCULATED, calculate_tv_intervals


SEOUL = ZoneInfo("Asia/Seoul")
HOME_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
CARE_EVENT_ID_PATTERN = re.compile(r"(?:^|;)care_event_id=([0-9a-fA-F-]{36})(?:;|$)")
RESPONSE_TYPE_PATTERN = re.compile(r"(?:^|;)response_event_type=([^;]+)(?:;|$)")
RESPONSE_ID_PATTERN = re.compile(r"(?:^|;)response_event_id=([^;]+)(?:;|$)")
CARE_CODES = {"care_guidance_sent_event", "care_response_confirmed_event"}
APPLIANCE_NAMES = {
    "AIR_CONDITIONER": "에어컨", "AIR_FRYER": "에어프라이어",
    "AIR_PURIFIER": "공기청정기", "COMPUTER": "컴퓨터",
    "DEHUMIDIFIER": "제습기", "DISHWASHER": "식기세척기",
    "ELECTRIC_BLANKET": "전기장판", "ELECTRIC_KETTLE": "전기주전자",
    "FAN": "선풍기", "HAIR_DRYER": "헤어드라이어",
    "MICROWAVE": "전자레인지", "PURIFIER": "정수기",
    "REFRIGERATOR": "냉장고", "ROUTER_SET_TOP_BOX": "공유기·셋톱박스",
    "TV": "TV",
}
PRODUCTS = (
    ("purifier", "PURIFIER", "정수기", "dispensed_volume_l", "L"),
    ("refrigerator", "REFRIGERATOR", "냉장고", "door_open_count", "번"),
    ("tv", "TV", "TV", "power_active_duration_hours", "시간"),
)
LOGGER = logging.getLogger(__name__)


class DatabaseUnavailable(Exception):
    """The configured database or required dashboard schema is unavailable."""


def seoul_now() -> datetime:
    return datetime.now(SEOUL)


def parse_inputs(query: str, *, today: date | None = None) -> tuple[str, date]:
    params = parse_qs(query, keep_blank_values=True)
    if set(params) != {"home_id", "date"} or any(len(values) != 1 for values in params.values()):
        raise ValueError("home_id와 date를 각각 하나씩 지정하세요.")
    home_id = params["home_id"][0]
    if not HOME_ID_PATTERN.fullmatch(home_id):
        raise ValueError("home_id는 영문, 숫자, 밑줄, 하이픈 1~128자여야 합니다.")
    day_text = params["date"][0]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day_text):
        raise ValueError("date는 YYYY-MM-DD 형식이어야 합니다.")
    try:
        day = date.fromisoformat(day_text)
    except ValueError as error:
        raise ValueError("유효한 날짜를 입력하세요.") from error
    if day > (today or seoul_now().date()):
        raise ValueError("미래 날짜는 조회할 수 없습니다.")
    return home_id, day


class PsqlRepository:
    """Read all dashboard sources with one read-only psql statement."""

    DASHBOARD_SQL = r"""
WITH requested AS (
    SELECT :'home_id'::varchar AS resident_thinq_id,
           :'data_date'::date AS data_date
), reporting_rows AS (
    SELECT d.reporting_id::text AS reporting_id,
           d.data_date::text AS data_date,
           d.event_time,
           d.record_type,
           d.subject_type,
           d.subject,
           d.metric_code,
           d.value,
           d.unit,
           d.data_status,
           d.evidence
    FROM public.reporting_data d
    JOIN requested r USING (resident_thinq_id, data_date)
    WHERE (d.record_type = 'event' AND d.subject_type = 'care')
       OR (d.record_type = 'metric' AND d.metric_code IN (
            'care_no_response_count', 'care_emergency_alert_count', 'tv_usage_minutes'
       ))
)
SELECT json_build_object('kind', 'appliance', 'payload', a.appliances)::text
FROM public.appliance_data a
JOIN requested r USING (resident_thinq_id, data_date)
UNION ALL
SELECT json_build_object('kind', 'behavior', 'payload', b.behavior_events)::text
FROM public.behavior_data b
JOIN requested r USING (resident_thinq_id, data_date)
UNION ALL
SELECT json_build_object(
    'kind', 'reporting',
    'payload', COALESCE(
        json_agg(row_to_json(reporting_rows) ORDER BY event_time NULLS LAST, reporting_id),
        '[]'::json
    )
)::text
FROM reporting_rows
"""

    def __init__(self, environ: dict[str, str] | None = None) -> None:
        self.environ = dict(os.environ if environ is None else environ)
        self.psql = self.environ.get("PSQL_BIN") or shutil.which("psql")

    def _query(self, sql: str, params: dict[str, str] | None = None) -> list[str]:
        required = ("PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD")
        if not self.psql or any(not self.environ.get(name) for name in required):
            raise DatabaseUnavailable("Database configuration is incomplete")
        environment = self.environ.copy()
        environment["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=5000"
        environment["PGCONNECT_TIMEOUT"] = "5"
        environment["PGPASSFILE"] = "/tmp/wifi-care-api-no-pgpass"
        command = [self.psql, "-X", "-w", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"]
        for name, value in sorted((params or {}).items()):
            if not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
                raise ValueError("Invalid SQL parameter name")
            command.extend(("-v", f"{name}={value}"))
        try:
            result = subprocess.run(
                command, env=environment, capture_output=True, text=True,
                input=sql, timeout=12, check=True,
            )
        except (OSError, subprocess.SubprocessError) as error:
            # stderr can contain connection details, so it is never propagated.
            raise DatabaseUnavailable("Database query failed") from error
        return [line for line in result.stdout.splitlines() if line]

    def fetch_daily_data(self, home_id: str, day: date) -> dict:
        if not HOME_ID_PATTERN.fullmatch(home_id):
            raise ValueError("Invalid home_id")
        rows = self._query(
            self.DASHBOARD_SQL,
            {"home_id": home_id, "data_date": day.isoformat()},
        )
        payloads: dict[str, object] = {"appliance": [], "behavior": [], "reporting": []}
        seen: set[str] = set()
        try:
            for raw in rows:
                document = json.loads(raw)
                kind = document["kind"]
                if kind not in payloads or kind in seen:
                    raise ValueError("unexpected dashboard payload")
                seen.add(kind)
                payloads[kind] = document["payload"]
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
            raise DatabaseUnavailable("Database returned invalid dashboard data") from error
        if not all(isinstance(payloads[name], list) for name in payloads):
            raise DatabaseUnavailable("Database returned invalid dashboard data")
        return payloads

    # Compatibility for internal callers of the original repository API.
    def list_events(self, home_id: str, day: date) -> tuple[str, list[dict]]:
        snapshot = self.fetch_daily_data(home_id, day)
        return "appliance_data", _normalize_appliances(snapshot["appliance"], day, None)


def _local_event_time(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("event_time must be a string")
    parsed = datetime.fromisoformat(value.replace(" ", "T"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(SEOUL).replace(tzinfo=None)
    return parsed


def _reporting_event_time(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("event_time must be a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=SEOUL)
    return parsed.astimezone(SEOUL)


def _is_visible(local_time: datetime, day: date, now: datetime | None) -> bool:
    if local_time.date() != day:
        return False
    return now is None or day < now.date() or local_time <= now.replace(tzinfo=None)


def _normalize_appliances(raw_appliances: object, day: date, now: datetime | None) -> list[dict]:
    if not isinstance(raw_appliances, list):
        raise ValueError("appliances must be an array")
    normalized: list[dict] = []
    for appliance in raw_appliances:
        if not isinstance(appliance, dict) or not isinstance(appliance.get("events"), list):
            raise ValueError("invalid appliance object")
        appliance_type = appliance.get("appliance_type")
        appliance_id = appliance.get("appliance_id")
        if not isinstance(appliance_type, str) or not isinstance(appliance_id, str):
            raise ValueError("invalid appliance identity")
        for event in appliance["events"]:
            if not isinstance(event, dict):
                raise ValueError("invalid appliance event")
            required = ("event_id", "event_time", "event_type", "episode_id")
            if any(not isinstance(event.get(key), str) for key in required):
                raise ValueError("invalid appliance event fields")
            occurred_at = _local_event_time(event["event_time"])
            if not _is_visible(occurred_at, day, now):
                continue
            value = event.get("event_value")
            if value is not None and not isinstance(value, (int, float)):
                raise ValueError("invalid appliance event value")
            unit = event.get("event_unit")
            if unit is not None and not isinstance(unit, str):
                raise ValueError("invalid appliance event unit")
            normalized.append({
                "event_id": event["event_id"], "event_time": occurred_at,
                "event_type": event["event_type"], "episode_id": event["episode_id"],
                "event_value": value, "event_unit": unit,
                "appliance_id": appliance_id, "appliance_type": appliance_type,
                "appliance_name": APPLIANCE_NAMES.get(appliance_type, "가전"),
            })
    return sorted(normalized, key=lambda item: (item["event_time"], item["event_id"]))


def _normalize_behaviors(raw_behaviors: object, day: date, now: datetime | None) -> list[dict]:
    if not isinstance(raw_behaviors, list):
        raise ValueError("behavior_events must be an array")
    normalized: list[dict] = []
    for event in raw_behaviors:
        if not isinstance(event, dict):
            raise ValueError("invalid behavior event")
        required = ("event_id", "event_time", "behavior_type", "location")
        if any(not isinstance(event.get(key), str) for key in required):
            raise ValueError("invalid behavior event fields")
        occurred_at = _local_event_time(event["event_time"])
        if not _is_visible(occurred_at, day, now):
            continue
        normalized.append({
            "event_id": event["event_id"], "event_time": occurred_at,
            "behavior_type": event["behavior_type"], "location": event["location"],
        })
    return sorted(normalized, key=lambda item: (item["event_time"], item["event_id"]))


def _decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise ValueError("invalid numeric value") from error


def _metric_value(rows: list[dict], code: str) -> Decimal | None:
    matches = [row for row in rows if row.get("record_type") == "metric" and row.get("metric_code") == code]
    if not matches:
        return None
    if len(matches) != 1:
        raise ValueError(f"duplicate metric: {code}")
    return _decimal(matches[0].get("value"))


def _care_evidence(row: dict) -> tuple[str, str | None, str | None]:
    evidence = row.get("evidence")
    if not isinstance(evidence, str):
        raise ValueError("invalid care evidence")
    care_match = CARE_EVENT_ID_PATTERN.search(evidence)
    if not care_match:
        raise ValueError("missing care_event_id")
    type_match = RESPONSE_TYPE_PATTERN.search(evidence)
    id_match = RESPONSE_ID_PATTERN.search(evidence)
    return care_match.group(1), type_match.group(1) if type_match else None, id_match.group(1) if id_match else None


def _care_copy(subject: str, source: dict) -> tuple[str, str]:
    if subject == "식사":
        location = source.get("location")
        return (f"{location}에서 식사를 안내했어요." if location else "식사를 안내했어요."), "식사 행동이 확인됐어요."
    if subject == "휴식":
        location = source.get("location")
        return (f"{location}에서 휴식을 안내했어요." if location else "휴식을 안내했어요."), "휴식 행동이 확인됐어요."
    if subject == "정수기 사용":
        return "물 마시기를 안내했어요.", "정수기 사용이 확인됐어요."
    return f"{subject} 안내가 있었어요.", "생활 행동이 확인됐어요."


def _recent_care(reporting: list[dict], appliances: list[dict], behaviors: list[dict], day: date, now: datetime | None) -> tuple[list[dict], int]:
    groups: dict[str, dict[str, list[dict]]] = defaultdict(lambda: {"guidance": [], "response": []})
    visible_guidance_ids: set[str] = set()
    for row in reporting:
        if row.get("record_type") != "event" or row.get("subject_type") != "care" or row.get("metric_code") not in CARE_CODES:
            continue
        try:
            occurred_at = _reporting_event_time(row.get("event_time"))
            if occurred_at.date() != day or (now is not None and occurred_at > now):
                continue
            care_id, _, _ = _care_evidence(row)
        except ValueError:
            LOGGER.warning("Skipping care event with invalid timestamp or evidence")
            continue
        item = {**row, "_occurred_at": occurred_at}
        key = "guidance" if row["metric_code"] == "care_guidance_sent_event" else "response"
        groups[care_id][key].append(item)
        if key == "guidance":
            visible_guidance_ids.add(care_id)

    appliance_by_id = {event["event_id"]: event for event in appliances}
    behavior_by_id = {event["event_id"]: event for event in behaviors}
    recent: list[dict] = []
    for care_id, group in groups.items():
        if len(group["guidance"]) != 1 or len(group["response"]) != 1:
            continue
        guidance, response = group["guidance"][0], group["response"][0]
        if response["_occurred_at"] < guidance["_occurred_at"]:
            LOGGER.warning("Skipping care process whose response precedes its guidance")
            continue
        try:
            _, response_type, response_id = _care_evidence(response)
        except ValueError:
            continue
        source = appliance_by_id.get(response_id) if response_type == "APPLIANCE" else behavior_by_id.get(response_id) if response_type == "BEHAVIOR" else None
        if source is None:
            LOGGER.warning("Skipping care process with missing %s source event", response_type or "unknown")
            continue
        title, detail = _care_copy(str(guidance.get("subject") or "돌봄"), source)
        recent.append({
            "id": care_id, "title": title, "detail": detail,
            "time": response["_occurred_at"].strftime("%H:%M"),
            "guidance_time": guidance["_occurred_at"].isoformat(),
            "response_time": response["_occurred_at"].isoformat(),
            "response_source_type": response_type,
            "evidence_refs": [guidance.get("reporting_id"), response.get("reporting_id")],
            "_sort_time": response["_occurred_at"],
        })
    recent.sort(key=lambda item: item["_sort_time"], reverse=True)
    for item in recent:
        item.pop("_sort_time")
    answered_ids = {care_id for care_id, group in groups.items() if len(group["response"]) == 1}
    return recent, len(visible_guidance_ids - answered_ids)


def _public_event(event: dict) -> dict:
    value = event.get("event_value")
    return {
        "event_id": event["event_id"], "event_time": event["event_time"].isoformat(timespec="seconds"),
        "action": event["event_type"], "episode_id": event["episode_id"],
        "value": value, "unit": event.get("event_unit"),
        "volume_ml": value if (event.get("event_unit") or "").lower() == "ml" else None,
        "appliance": event["appliance_name"],
    }


def _build_products(
    appliances: list[dict], reporting: list[dict], *, allow_daily_metric: bool = True,
) -> dict[str, dict]:
    by_type: dict[str, list[dict]] = defaultdict(list)
    for event in appliances:
        by_type[event["appliance_type"]].append(event)
    products: dict[str, dict] = {}
    for product_id, appliance_type, name, metric_code, unit in PRODUCTS:
        all_events = by_type.get(appliance_type, [])
        if product_id == "purifier":
            events = [event for event in all_events if event["event_type"] == "출수 종료"]
            milliliters = sum((_decimal(event["event_value"]) or Decimal(0)) for event in events if (event.get("event_unit") or "").lower() == "ml")
            value = float((milliliters / Decimal(1000)).quantize(Decimal("0.001")))
            extra = {}
        elif product_id == "refrigerator":
            events = [event for event in all_events if event["event_type"] in {"문 열림", "문 닫힘"}]
            value = sum(event["event_type"] == "문 열림" for event in events)
            extra = {}
        else:
            events = [event for event in all_events if event["event_type"] in {"켜짐", "꺼짐"}]
            calculation = calculate_tv_intervals(events)
            metric = _metric_value(reporting, "tv_usage_minutes") if allow_daily_metric else None
            if calculation["status"] == CALCULATED:
                total_minutes = Decimal(calculation["total_seconds"]) / Decimal(60)
                value = float((total_minutes / Decimal(60)).quantize(Decimal("0.001")))
            else:
                total_minutes = None
                value = None
            extra = {
                "total_minutes": None if total_minutes is None else float(total_minutes),
                "total_source": calculation["source"],
                "calculation_status": calculation["status"],
                "calculation_reason": calculation["reason"],
                "intervals": calculation["intervals"],
                "valid_episode_count": calculation["valid_episode_count"],
                "incomplete_episode_count": calculation["incomplete_episode_count"],
                "reporting_metric_minutes": None if metric is None else float(metric),
                "reporting_metric_matches": (
                    None if metric is None or total_minutes is None
                    else abs(metric - total_minutes) <= Decimal("0.0005")
                ),
            }
        products[product_id] = {
            "id": product_id, "name": name, "metric_code": metric_code,
            "value": value, "unit": unit,
            "has_data": bool(events),
            "status": "HAS_EVENTS" if events else "NO_EVENTS",
            "events": [_public_event(event) for event in events], **extra,
        }
    return products


def build_dashboard_response(home_id: str, day: date, snapshot: dict, *, now: datetime | None = None) -> dict:
    current = (now or seoul_now()).astimezone(SEOUL)
    cutoff = current if day == current.date() else None
    appliances = _normalize_appliances(snapshot.get("appliance"), day, cutoff)
    behaviors = _normalize_behaviors(snapshot.get("behavior"), day, cutoff)
    reporting = snapshot.get("reporting")
    if not isinstance(reporting, list) or any(not isinstance(row, dict) for row in reporting):
        raise ValueError("reporting rows must be an array")
    recent_care, event_unanswered = _recent_care(reporting, appliances, behaviors, day, cutoff)
    if cutoff is None:
        unanswered_metric = _metric_value(reporting, "care_no_response_count")
        emergency_metric = _metric_value(reporting, "care_emergency_alert_count")
        has_unanswered = (
            unanswered_metric if unanswered_metric is not None else Decimal(event_unanswered)
        ) > 0
        has_emergency = (emergency_metric or Decimal(0)) > 0
    else:
        has_unanswered = event_unanswered > 0
        has_emergency = any(
            row.get("record_type") == "event" and row.get("subject_type") == "care"
            and row.get("metric_code") == "care_emergency_alert_sent_event"
            and _reporting_event_time(row.get("event_time")) <= current
            for row in reporting
        )
    status = "ATTENTION" if has_unanswered or has_emergency else "COMPLETED" if recent_care else "EMPTY"
    if recent_care:
        message = ["오늘의 돌봄 기록을", "확인했어요"] if cutoff else ["선택한 날짜의 돌봄 기록을", "확인했어요"]
    else:
        message = ["오늘의 돌봄 기록이 없어요"] if cutoff else ["선택한 날짜의 돌봄 기록이 없어요"]
    latest = appliances[-1] if appliances else None
    return {
        "resident_thinq_id": home_id, "data_date": day.isoformat(),
        "care_overview": {
            "status": status, "message": message, "completed_count": len(recent_care),
            "has_unanswered": has_unanswered, "has_emergency_alert": has_emergency,
        },
        "recent_care": recent_care,
        "latest_appliance": None if latest is None else {
            "appliance_type": latest["appliance_type"], "name": latest["appliance_name"],
            "event_time": latest["event_time"].isoformat(timespec="seconds"),
        },
        "products": _build_products(appliances, reporting, allow_daily_metric=cutoff is None),
    }


def build_daily_response(home_id: str, day: date, snapshot: dict, *, now: datetime | None = None) -> dict:
    """Return the original appliance endpoint shape from the new JSONB source."""
    dashboard = build_dashboard_response(home_id, day, snapshot, now=now)
    appliances = list(dashboard["products"].values())
    return {
        "home_id": home_id, "date": day.isoformat(), "source_table": "public.appliance_data",
        "has_data": any(device["has_data"] for device in appliances),
        "operational_status": "unknown", "appliances": appliances,
        "events": [event for device in appliances for event in device["events"]],
    }


def create_handler(repository: PsqlRepository, allowed_origins: set[str], now_provider: Callable[[], datetime] = seoul_now):
    allowed_paths = {"/api/appliances/daily", "/api/care/dashboard"}

    class ApplianceHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            # Keep resident identifiers and query strings out of access logs.
            LOGGER.info("%s %s", self.command, urlsplit(self.path).path)

        def _send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            origin = self.headers.get("Origin")
            if origin in allowed_origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            if urlsplit(self.path).path not in allowed_paths:
                self._send_json(404, {"error": {"code": "not_found", "message": "Not found"}})
                return
            origin = self.headers.get("Origin")
            if origin not in allowed_origins:
                self._send_json(403, {"error": {"code": "origin_not_allowed", "message": "Origin not allowed"}})
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def do_GET(self) -> None:
            url = urlsplit(self.path)
            if url.path == "/api/health":
                self._send_json(200, {"status": "ok"})
                return
            if url.path not in allowed_paths:
                self._send_json(404, {"error": {"code": "not_found", "message": "Not found"}})
                return
            current = now_provider().astimezone(SEOUL)
            try:
                home_id, day = parse_inputs(url.query, today=current.date())
            except ValueError as error:
                self._send_json(400, {"error": {"code": "invalid_request", "message": str(error)}})
                return
            try:
                snapshot = repository.fetch_daily_data(home_id, day)
                response = build_dashboard_response(home_id, day, snapshot, now=current) if url.path == "/api/care/dashboard" else build_daily_response(home_id, day, snapshot, now=current)
            except (ValueError, KeyError, TypeError, OverflowError, DatabaseUnavailable):
                self._send_json(503, {"error": {"code": "database_unavailable", "message": "돌봄 데이터를 불러올 수 없습니다."}})
                return
            self._send_json(200, response)

    return ApplianceHandler


def main() -> None:
    host = os.environ.get("APPLIANCE_API_HOST", "0.0.0.0")
    port = int(os.environ.get("APPLIANCE_API_PORT", "8000"))
    origins = set(filter(None, (origin.strip() for origin in os.environ.get(
        "APPLIANCE_CORS_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5175",
    ).split(","))))
    server = ThreadingHTTPServer((host, port), create_handler(PsqlRepository(), origins))
    print(f"Care dashboard API listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
