"""Offline tests for the read-only care dashboard API."""

from datetime import date, datetime
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

from back.api.appliance_api import (
    DatabaseUnavailable,
    PsqlRepository,
    build_daily_response,
    build_dashboard_response,
    create_handler,
    parse_inputs,
)


SEOUL = ZoneInfo("Asia/Seoul")
DAY = date(2026, 9, 23)
CARE_ONE = "11111111-1111-4111-8111-111111111111"
CARE_TWO = "22222222-2222-4222-8222-222222222222"


def appliance_event(event_id, event_type, when, episode, value=None, unit=None):
    return {
        "event_id": event_id,
        "event_type": event_type,
        "event_time": when,
        "episode_id": episode,
        "event_value": value,
        "event_unit": unit,
    }


def appliance(appliance_type, events):
    return {
        "appliance_id": f"device-{appliance_type.lower()}",
        "appliance_type": appliance_type,
        "events": events,
    }


def behavior_event(event_id, behavior_type, when, location):
    return {
        "event_id": event_id,
        "event_time": when,
        "behavior_type": behavior_type,
        "location": location,
        "sensor_id": "sensor-test",
        "duration_seconds": None,
    }


def care_row(care_id, code, when, subject, *, response_type=None, response_id=None):
    evidence = f"source=public.care_event;care_event_id={care_id};step={'1' if response_id is None else '2'}"
    if response_id is not None:
        evidence += f";response_event_type={response_type};response_event_id={response_id}"
    return {
        "reporting_id": f"report-{care_id}-{code}",
        "data_date": DAY.isoformat(),
        "event_time": when,
        "record_type": "event",
        "subject_type": "care",
        "subject": subject,
        "metric_code": code,
        "value": 1,
        "unit": "event",
        "data_status": "derived_care_event",
        "evidence": evidence,
    }


def metric(code, value):
    return {
        "reporting_id": f"metric-{code}",
        "data_date": DAY.isoformat(),
        "event_time": None,
        "record_type": "metric",
        "subject_type": "care" if code.startswith("care_") else "appliance",
        "subject": "돌봄" if code.startswith("care_") else "TV",
        "metric_code": code,
        "value": value,
        "unit": "count" if code.startswith("care_") else "minute",
        "data_status": "derived",
        "evidence": "test",
    }


def base_snapshot():
    appliances = [
        appliance("PURIFIER", [
            appliance_event("water-start", "출수 시작", "2026-09-23T09:00:00", "water-1"),
            appliance_event("water-end", "출수 종료", "2026-09-23T09:01:00", "water-1", 350, "ml"),
            appliance_event("water-end-2", "출수 종료", "2026-09-23T12:00:00", "water-2", 250, "ml"),
        ]),
        appliance("REFRIGERATOR", [
            appliance_event("fridge-open-1", "문 열림", "2026-09-23T08:00:00", "fridge-1"),
            appliance_event("fridge-close-1", "문 닫힘", "2026-09-23T08:02:00", "fridge-1"),
            appliance_event("fridge-open-2", "문 열림", "2026-09-23T14:00:00", "fridge-2"),
        ]),
        appliance("TV", [
            appliance_event("tv-on", "켜짐", "2026-09-23T10:00:00", "tv-1"),
            appliance_event("tv-off", "꺼짐", "2026-09-23T11:30:00", "tv-1"),
        ]),
        appliance("AIR_PURIFIER", [
            appliance_event("air-off", "꺼짐", "2026-09-23T23:20:00", "air-1"),
        ]),
    ]
    behaviors = [behavior_event("meal-done", "식사", "2026-09-23T08:30:00", "주방")]
    reporting = [
        care_row(CARE_ONE, "care_guidance_sent_event", "2026-09-23T08:15:00+09:00", "식사"),
        care_row(CARE_ONE, "care_response_confirmed_event", "2026-09-23T08:30:00+09:00", "식사", response_type="BEHAVIOR", response_id="meal-done"),
        care_row(CARE_TWO, "care_guidance_sent_event", "2026-09-23T08:45:00+09:00", "정수기 사용"),
        care_row(CARE_TWO, "care_response_confirmed_event", "2026-09-23T09:00:00+09:00", "정수기 사용", response_type="APPLIANCE", response_id="water-start"),
        metric("care_no_response_count", 0),
        metric("care_emergency_alert_count", 0),
        metric("tv_usage_minutes", 72),
    ]
    return {"appliance": appliances, "behavior": behaviors, "reporting": reporting}


class RequestTests(unittest.TestCase):
    def test_valid_inputs_and_hyphenated_home(self):
        self.assertEqual(
            parse_inputs("home_id=home-23&date=2026-09-23", today=date(2026, 9, 26)),
            ("home-23", DAY),
        )

    def test_invalid_and_future_inputs(self):
        queries = (
            "", "home_id=x", "date=2026-09-23", "home_id=x&date=2026-02-30",
            "home_id=x&date=2026-9-23", "home_id=x%27&date=2026-09-23",
            "home_id=x&home_id=y&date=2026-09-23", "home_id=x&date=2026-09-27",
        )
        for query in queries:
            with self.subTest(query=query), self.assertRaises(ValueError):
                parse_inputs(query, today=date(2026, 9, 26))


class DashboardTests(unittest.TestCase):
    def build(self, snapshot=None, *, day=DAY, now=None):
        return build_dashboard_response(
            "home_23", day, snapshot or base_snapshot(),
            now=now or datetime(2026, 9, 26, 12, tzinfo=SEOUL),
        )

    def test_products_and_latest_appliance(self):
        result = self.build()
        purifier = result["products"]["purifier"]
        fridge = result["products"]["refrigerator"]
        tv = result["products"]["tv"]
        self.assertEqual(purifier["value"], 0.6)
        self.assertEqual(len(purifier["events"]), 2)
        self.assertEqual(fridge["value"], 2)
        self.assertEqual([row["action"] for row in fridge["events"]], ["문 열림", "문 닫힘", "문 열림"])
        self.assertEqual(tv["value"], 1.5)
        self.assertEqual(tv["calculation_status"], "CALCULATED")
        self.assertEqual(tv["total_source"], "EPISODE")
        self.assertEqual(result["latest_appliance"]["name"], "공기청정기")

    def test_tv_uses_strict_sequence_when_episode_ids_do_not_match(self):
        snapshot = base_snapshot()
        tv = next(item for item in snapshot["appliance"] if item["appliance_type"] == "TV")
        tv["events"][1]["episode_id"] = "different"
        result = self.build(snapshot)["products"]["tv"]
        self.assertEqual(result["calculation_status"], "CALCULATED")
        self.assertEqual(result["total_source"], "SEQUENCE_FALLBACK")
        self.assertEqual(result["total_minutes"], 90)
        self.assertEqual(result["value"], 1.5)
        self.assertEqual(result["incomplete_episode_count"], 2)
        self.assertFalse(result["reporting_metric_matches"])

    def test_tv_without_pair_ignores_metric_and_keeps_details_without_zero_total(self):
        snapshot = base_snapshot()
        tv = next(item for item in snapshot["appliance"] if item["appliance_type"] == "TV")
        tv["events"] = tv["events"][:1]
        result = self.build(snapshot)["products"]["tv"]
        self.assertEqual(result["calculation_status"], "UNAVAILABLE")
        self.assertEqual(result["total_source"], "UNAVAILABLE")
        self.assertIsNone(result["total_minutes"])
        self.assertIsNone(result["value"])
        self.assertEqual(result["reporting_metric_minutes"], 72)
        self.assertTrue(result["has_data"])

    def test_known_september_sequence_is_210_minutes(self):
        snapshot = base_snapshot()
        tv = next(item for item in snapshot["appliance"] if item["appliance_type"] == "TV")
        tv["events"] = [
            appliance_event("on-1", "켜짐", "2026-09-23T08:50:00", "a"),
            appliance_event("off-1", "꺼짐", "2026-09-23T10:00:00", "b"),
            appliance_event("on-2", "켜짐", "2026-09-23T19:20:00", "c"),
            appliance_event("off-2", "꺼짐", "2026-09-23T21:40:00", "d"),
        ]
        result = self.build(snapshot)["products"]["tv"]
        self.assertEqual(result["total_source"], "SEQUENCE_FALLBACK")
        self.assertEqual(result["total_minutes"], 210)
        self.assertEqual(result["value"], 3.5)

    def test_completed_care_validates_sources_and_sorts_newest_first(self):
        recent = self.build()["recent_care"]
        self.assertEqual(len(recent), 2)
        self.assertEqual([item["time"] for item in recent], ["09:00", "08:30"])
        self.assertEqual(recent[0]["title"], "물 마시기를 안내했어요.")
        self.assertEqual(recent[0]["detail"], "정수기 사용이 확인됐어요.")
        self.assertEqual(recent[1]["title"], "주방에서 식사를 안내했어요.")
        self.assertEqual(recent[1]["detail"], "식사 행동이 확인됐어요.")

    def test_incomplete_early_and_missing_source_care_are_excluded(self):
        snapshot = base_snapshot()
        snapshot["reporting"].append(care_row(
            "33333333-3333-4333-8333-333333333333", "care_guidance_sent_event",
            "2026-09-23T15:00:00+09:00", "휴식",
        ))
        snapshot["reporting"].extend([
            care_row("44444444-4444-4444-8444-444444444444", "care_guidance_sent_event", "2026-09-23T17:00:00+09:00", "휴식"),
            care_row("44444444-4444-4444-8444-444444444444", "care_response_confirmed_event", "2026-09-23T16:59:00+09:00", "휴식", response_type="BEHAVIOR", response_id="meal-done"),
            care_row("55555555-5555-4555-8555-555555555555", "care_guidance_sent_event", "2026-09-23T18:00:00+09:00", "휴식"),
            care_row("55555555-5555-4555-8555-555555555555", "care_response_confirmed_event", "2026-09-23T18:10:00+09:00", "휴식", response_type="BEHAVIOR", response_id="missing"),
        ])
        result = self.build(snapshot)
        self.assertEqual(len(result["recent_care"]), 2)
        self.assertFalse(result["care_overview"]["has_unanswered"])

    def test_empty_day_is_successful_without_previous_day_fallback(self):
        empty = {"appliance": [], "behavior": [], "reporting": []}
        result = self.build(empty)
        self.assertEqual(result["recent_care"], [])
        self.assertIsNone(result["latest_appliance"])
        self.assertEqual(result["care_overview"]["status"], "EMPTY")
        self.assertTrue(all(not product["has_data"] for product in result["products"].values()))

    def test_today_excludes_future_appliance_behavior_and_care(self):
        today = date(2026, 9, 26)
        snapshot = {
            "appliance": [appliance("REFRIGERATOR", [
                appliance_event("past", "문 열림", "2026-09-26T09:00:00", "one"),
                appliance_event("future", "문 열림", "2026-09-26T11:00:00", "two"),
            ])],
            "behavior": [],
            "reporting": [],
        }
        result = build_dashboard_response(
            "home_23", today, snapshot,
            now=datetime(2026, 9, 26, 10, 0, tzinfo=SEOUL),
        )
        self.assertEqual(result["products"]["refrigerator"]["value"], 1)
        self.assertEqual(result["latest_appliance"]["event_time"], "2026-09-26T09:00:00")
        self.assertEqual(result["care_overview"]["message"], ["오늘의 돌봄 기록이 없어요"])

    def test_today_does_not_use_a_full_day_tv_metric(self):
        today = date(2026, 9, 26)
        snapshot = {
            "appliance": [appliance("TV", [
                appliance_event("tv-on", "켜짐", "2026-09-26T09:00:00", "unmatched"),
            ])],
            "behavior": [],
            "reporting": [{**metric("tv_usage_minutes", 120), "data_date": today.isoformat()}],
        }
        result = build_dashboard_response(
            "home_23", today, snapshot,
            now=datetime(2026, 9, 26, 10, 0, tzinfo=SEOUL),
        )["products"]["tv"]
        self.assertEqual(result["total_source"], "UNAVAILABLE")
        self.assertEqual(result["calculation_status"], "UNAVAILABLE")
        self.assertIsNone(result["value"])
        self.assertIsNone(result["reporting_metric_minutes"])

    def test_invalid_top_level_json_structure_is_rejected(self):
        with self.assertRaises(ValueError):
            self.build({"appliance": {}, "behavior": [], "reporting": []})

    def test_legacy_response_uses_new_table_and_shape(self):
        result = build_daily_response(
            "home_23", DAY, base_snapshot(),
            now=datetime(2026, 9, 26, 12, tzinfo=SEOUL),
        )
        self.assertEqual(result["source_table"], "public.appliance_data")
        self.assertEqual([item["id"] for item in result["appliances"]], ["purifier", "refrigerator", "tv"])


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.repository = PsqlRepository({
            "PGHOST": "example.invalid", "PGDATABASE": "db",
            "PGUSER": "user", "PGPASSWORD": "test-secret",
        })
        self.repository.psql = "/usr/bin/psql"

    def test_query_uses_bound_psql_variables_and_selects_new_tables_only(self):
        reporting = json.dumps({"kind": "reporting", "payload": []})
        with patch.object(self.repository, "_query", return_value=[reporting]) as query:
            result = self.repository.fetch_daily_data("home_23", DAY)
        sql, params = query.call_args.args
        self.assertEqual(result, {"appliance": [], "behavior": [], "reporting": []})
        self.assertEqual(params, {"home_id": "home_23", "data_date": "2026-09-23"})
        self.assertIn(":'home_id'", sql)
        self.assertIn("public.appliance_data", sql)
        self.assertIn("public.behavior_data", sql)
        self.assertIn("public.reporting_data", sql)
        self.assertNotIn("appliance_data_one_person", sql)
        self.assertNotIn("FROM public.care_event", sql)

    def test_no_password_in_command_and_read_only_option(self):
        with patch("back.api.appliance_api.subprocess.run") as run:
            run.return_value.stdout = ""
            self.repository._query("SELECT :'home_id'", {"home_id": "home_23"})
        command = run.call_args.args[0]
        self.assertNotIn("test-secret", str(command))
        self.assertIn("home_id=home_23", command)
        self.assertEqual(run.call_args.kwargs["input"], "SELECT :'home_id'")
        self.assertEqual(run.call_args.kwargs["env"]["PGPASSWORD"], "test-secret")
        self.assertIn("default_transaction_read_only=on", run.call_args.kwargs["env"]["PGOPTIONS"])

    def test_invalid_database_json_becomes_repository_error(self):
        with patch.object(self.repository, "_query", return_value=["not-json"]):
            with self.assertRaises(DatabaseUnavailable):
                self.repository.fetch_daily_data("home_23", DAY)

    def test_source_contains_no_deleted_table_query(self):
        source = Path("back/api/appliance_api.py").read_text(encoding="utf-8")
        self.assertNotIn("appliance_data_one_person", source)
        self.assertNotIn("FROM public.care_event", source)


class HttpTests(unittest.TestCase):
    def request(self, repository, path):
        handler = create_handler(
            repository,
            {"http://127.0.0.1:5175"},
            now_provider=lambda: datetime(2026, 9, 26, 10, tzinfo=SEOUL),
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            connection.request("GET", path)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_dashboard_http_success_and_future_rejection(self):
        class Repository:
            def fetch_daily_data(self, home_id, day):
                return base_snapshot()

        status, body = self.request(Repository(), "/api/care/dashboard?home_id=home_23&date=2026-09-23")
        self.assertEqual(status, 200)
        self.assertEqual(body["resident_thinq_id"], "home_23")
        status, body = self.request(Repository(), "/api/care/dashboard?home_id=home_23&date=2026-09-27")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_request")

    def test_database_failure_is_safe_503(self):
        class Repository:
            def fetch_daily_data(self, home_id, day):
                raise DatabaseUnavailable("secret database detail")

        status, body = self.request(Repository(), "/api/care/dashboard?home_id=home_23&date=2026-09-23")
        self.assertEqual(status, 503)
        self.assertEqual(body["error"]["code"], "database_unavailable")
        self.assertNotIn("secret", json.dumps(body))


if __name__ == "__main__":
    unittest.main()
