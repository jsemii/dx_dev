"""Serve daily appliance usage for the selected one-person household.

Only SELECT statements are issued. PostgreSQL credentials are read from the
server process environment and are never included in HTTP responses.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import shutil
import subprocess
from urllib.parse import parse_qs, urlsplit


TABLE_CANDIDATES = ("appliance_data_one_person",)
REQUIRED_COLUMNS = frozenset(
    {"home_id", "appliance", "action", "event_time", "episode_id", "phase",
     "data_status", "evidence", "source_file", "source_anchor",
     "scenario_note", "volume_ml"}
)
HOME_ID_PATTERN = re.compile(r"[A-Za-z0-9_]{1,128}\Z")
DEVICES = (
    ("purifier", "정수기", "dispensed_volume_l", "L"),
    ("refrigerator", "냉장고", "door_open_count", "회"),
    ("tv", "TV", "power_active_duration_hours", "시간"),
)
APPLIANCE_ALIASES = {"일반 냉장고": "냉장고"}


class DatabaseUnavailable(Exception):
    """The configured database or required appliance schema is unavailable."""


def parse_inputs(query: str) -> tuple[str, date]:
    params = parse_qs(query, keep_blank_values=True)
    if set(params) != {"home_id", "date"} or any(len(values) != 1 for values in params.values()):
        raise ValueError("home_id와 date를 각각 하나씩 지정하세요.")
    home_id = params["home_id"][0]
    if not HOME_ID_PATTERN.fullmatch(home_id):
        raise ValueError("home_id는 영문, 숫자, 밑줄 1~128자여야 합니다.")
    day_text = params["date"][0]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day_text):
        raise ValueError("date는 YYYY-MM-DD 형식이어야 합니다.")
    try:
        day = date.fromisoformat(day_text)
    except ValueError as error:
        raise ValueError("유효한 날짜를 입력하세요.") from error
    if day == date.max:
        raise ValueError("지원하지 않는 날짜입니다.")
    return home_id, day


class PsqlRepository:
    """Read from a validated, discovered public table using the local psql CLI."""

    def __init__(self, environ: dict[str, str] | None = None) -> None:
        self.environ = dict(os.environ if environ is None else environ)
        self.psql = self.environ.get("PSQL_BIN") or shutil.which("psql")

    def _query(self, sql: str) -> list[str]:
        required = ("PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD")
        if not self.psql or any(not self.environ.get(name) for name in required):
            raise DatabaseUnavailable("Database configuration is incomplete")
        environment = self.environ.copy()
        environment["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=5000"
        environment["PGCONNECT_TIMEOUT"] = "5"
        # Never use a local password file: the password must come from PGPASSWORD.
        environment["PGPASSFILE"] = "/private/tmp/wifi-care-api-no-pgpass"
        try:
            result = subprocess.run(
                [self.psql, "-X", "-w", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
                 "-c", sql],
                env=environment, capture_output=True, text=True, timeout=12, check=True,
            )
        except (OSError, subprocess.SubprocessError) as error:
            # Do not return stderr: it may reveal server or account details.
            raise DatabaseUnavailable("Database query failed") from error
        return [line for line in result.stdout.splitlines() if line]

    def _discover_table(self) -> str:
        rows = self._query(
            "SELECT table_name || E'\\t' || column_name "
            "FROM information_schema.columns "
            "WHERE table_schema = 'public' "
            "AND table_name = 'appliance_data_one_person' "
            "ORDER BY table_name, ordinal_position"
        )
        columns: dict[str, set[str]] = defaultdict(set)
        for row in rows:
            table, separator, column = row.partition("\t")
            if separator and table in TABLE_CANDIDATES:
                columns[table].add(column)
        for table in TABLE_CANDIDATES:
            if table in columns:
                if not REQUIRED_COLUMNS.issubset(columns[table]):
                    raise DatabaseUnavailable("Appliance schema is incompatible")
                return table
        raise DatabaseUnavailable("Appliance table was not found")

    def list_events(self, home_id: str, day: date) -> tuple[str, list[dict]]:
        # Both identifiers below are validated or drawn from fixed constants.
        if not HOME_ID_PATTERN.fullmatch(home_id):
            raise ValueError("Invalid home_id")
        table = self._discover_table()
        start = day.isoformat()
        end = (day + timedelta(days=1)).isoformat()
        columns = ", ".join(sorted(REQUIRED_COLUMNS))
        rows = self._query(
            "SELECT row_to_json(e)::text FROM ("
            f"SELECT {columns} FROM public.{table} "
            f"WHERE home_id = '{home_id}' "
            f"AND ((event_time >= '{start}' AND event_time < '{end}') OR appliance = 'TV') "
            "ORDER BY event_time, episode_id, action"
            ") AS e"
        )
        try:
            return table, [json.loads(row) for row in rows]
        except json.JSONDecodeError as error:
            raise DatabaseUnavailable("Database returned invalid event data") from error


def build_daily_response(home_id: str, day: date, table: str, rows: list[dict]) -> dict:
    start = datetime.combine(day, time.min)
    end = start + timedelta(days=1)
    events: list[dict] = []
    tv_episodes: dict[str, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        appliance = APPLIANCE_ALIASES.get(row.get("appliance"), row.get("appliance"))
        if appliance not in {device[1] for device in DEVICES}:
            continue
        occurred_at = datetime.fromisoformat(str(row["event_time"]).replace(" ", "T"))
        if appliance == "TV":
            tv_episodes[str(row["episode_id"])][str(row["action"])] = row
        if not start <= occurred_at < end:
            continue
        events.append({
            "appliance": appliance,
            "action": row["action"],
            "event_time": occurred_at.isoformat(timespec="milliseconds"),
            "episode_id": row["episode_id"],
            "volume_ml": row.get("volume_ml") or None,
            "data_status": row.get("data_status"),
            "is_synthetic": row.get("data_status") == "synthetic_scenario",
            "is_inferred": row.get("data_status") == "source_based_inference",
            "evidence": row.get("evidence"),
            "phase": row.get("phase"),
            "source_file": row.get("source_file") or None,
            "source_anchor": row.get("source_anchor") or None,
            "scenario_note": row.get("scenario_note") or None,
        })
    events.sort(key=lambda event: (event["event_time"], str(event["episode_id"]), str(event["action"])))

    tv_seconds = 0.0
    tv_statuses: set[str] = set()
    incomplete_tv_episodes = 0
    for pair in tv_episodes.values():
        on, off = pair.get("켜짐"), pair.get("꺼짐")
        if not on or not off:
            if any(start <= datetime.fromisoformat(str(row["event_time"]).replace(" ", "T")) < end
                   for row in pair.values()):
                incomplete_tv_episodes += 1
            continue
        on_at = datetime.fromisoformat(str(on["event_time"]).replace(" ", "T"))
        off_at = datetime.fromisoformat(str(off["event_time"]).replace(" ", "T"))
        if off_at <= on_at:
            if start <= on_at < end or start <= off_at < end:
                incomplete_tv_episodes += 1
            continue
        overlap = (min(off_at, end) - max(on_at, start)).total_seconds()
        if overlap > 0:
            tv_seconds += overlap
            tv_statuses.update(status for status in (on.get("data_status"), off.get("data_status")) if status)

    appliances = []
    for device_id, name, metric_code, unit in DEVICES:
        history = [event for event in events if event["appliance"] == name]
        if name == "냉장고":
            value = sum(event["action"] == "문 열림" for event in history)
        elif name == "정수기":
            value = round(sum(int(event["volume_ml"] or 0) for event in history
                              if event["action"] == "출수 종료") / 1000, 3)
        else:
            value = round(tv_seconds / 3600, 3)
        statuses = sorted({event["data_status"] for event in history if event["data_status"]}
                          | (tv_statuses if name == "TV" else set()))
        appliances.append({
            "id": device_id, "name": name, "metric_code": metric_code,
            "value": value, "unit": unit, "events": history,
            "has_data": bool(history) or (name == "TV" and tv_seconds > 0),
            "data_statuses": statuses,
            "is_synthetic": "synthetic_scenario" in statuses,
            "is_inferred": "source_based_inference" in statuses,
            "operational_status": "unknown",
            **({"duration_seconds": round(tv_seconds, 3),
                "incomplete_episode_count": incomplete_tv_episodes} if name == "TV" else {}),
        })
    return {
        "home_id": home_id, "date": day.isoformat(), "source_table": f"public.{table}",
        "has_data": any(device["has_data"] for device in appliances),
        "operational_status": "unknown", "appliances": appliances, "events": events,
    }


def create_handler(repository: PsqlRepository, allowed_origins: set[str]):
    class ApplianceHandler(BaseHTTPRequestHandler):
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
            if urlsplit(self.path).path != "/api/appliances/daily":
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
            if url.path != "/api/appliances/daily":
                self._send_json(404, {"error": {"code": "not_found", "message": "Not found"}})
                return
            try:
                home_id, day = parse_inputs(url.query)
            except ValueError as error:
                self._send_json(400, {"error": {"code": "invalid_request", "message": str(error)}})
                return
            try:
                table, rows = repository.list_events(home_id, day)
                response = build_daily_response(home_id, day, table, rows)
            except (ValueError, KeyError, TypeError, OverflowError, DatabaseUnavailable):
                self._send_json(503, {"error": {"code": "database_unavailable",
                                                "message": "가전 DB 또는 스키마를 확인할 수 없습니다."}})
                return
            self._send_json(200, response)

    return ApplianceHandler


def main() -> None:
    port = int(os.environ.get("APPLIANCE_API_PORT", "8000"))
    origins = set(filter(None, (origin.strip() for origin in os.environ.get(
        "APPLIANCE_CORS_ORIGINS", "http://localhost:5173,http://localhost:5174"
    ).split(","))))
    server = ThreadingHTTPServer(("127.0.0.1", port), create_handler(PsqlRepository(), origins))
    print(f"Appliance API listening on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
