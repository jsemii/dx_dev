"""Offline tests for the read-only appliance API."""

import csv
from datetime import date
from pathlib import Path
import unittest
from unittest.mock import patch

from back.api.appliance_api import (
    DatabaseUnavailable, PsqlRepository, build_daily_response, parse_inputs,
)


def event(appliance, action, when, episode, *, volume_ml=None,
          status="synthetic_scenario"):
    return {
        "home_id": "demo_solo_house009", "appliance": appliance,
        "action": action, "event_time": when, "episode_id": episode,
        "phase": "report_day", "data_status": status, "evidence": "test",
        "source_file": None, "source_anchor": None, "scenario_note": None,
        "volume_ml": volume_ml,
    }


class RequestTests(unittest.TestCase):
    def test_valid_inputs(self):
        self.assertEqual(parse_inputs("home_id=demo_solo_house009&date=2023-09-23"),
                         ("demo_solo_house009", date(2023, 9, 23)))

    def test_invalid_inputs(self):
        for query in ("", "home_id=x", "date=2023-09-23", "home_id=x&date=2023-02-30",
                      "home_id=x&date=2023-9-23", "home_id=x%27&date=2023-09-23",
                      "home_id=x&home_id=y&date=2023-09-23",
                      "home_id=x&date=9999-12-31"):
            with self.subTest(query=query), self.assertRaises(ValueError):
                parse_inputs(query)


class SummaryTests(unittest.TestCase):
    def test_aggregates_and_chronological_events(self):
        rows = [
            event("TV", "꺼짐", "2023-09-23 11:30:00", "tv1", status="source_based_inference"),
            event("정수기", "출수 종료", "2023-09-23 09:10:00", "p1", volume_ml=350),
            event("일반 냉장고", "문 열림", "2023-09-23 08:00:00", "f1"),
            event("TV", "켜짐", "2023-09-23 10:00:00", "tv1", status="source_based_inference"),
            event("정수기", "출수 종료", "2023-09-23 12:00:00", "p2", volume_ml=250),
            event("일반 냉장고", "문 닫힘", "2023-09-23 08:02:00", "f1"),
            event("일반 냉장고", "문 열림", "2023-09-23 14:00:00", "f2"),
        ]
        result = build_daily_response("demo_solo_house009", date(2023, 9, 23),
                                      "appliance_data_one_person", rows)
        devices = {device["id"]: device for device in result["appliances"]}
        self.assertEqual(devices["refrigerator"]["value"], 2)
        self.assertEqual(devices["purifier"]["value"], 0.6)
        self.assertEqual(devices["tv"]["value"], 1.5)
        self.assertEqual(devices["tv"]["duration_seconds"], 5400)
        self.assertEqual([row["event_time"] for row in result["events"]],
                         sorted(row["event_time"] for row in result["events"]))
        self.assertTrue(devices["refrigerator"]["is_synthetic"])
        self.assertTrue(devices["tv"]["is_inferred"])
        self.assertEqual(devices["tv"]["operational_status"], "unknown")
        self.assertEqual(result["source_table"], "public.appliance_data_one_person")

    def test_empty_date(self):
        result = build_daily_response("home", date(2023, 9, 24),
                                      "appliance_data_one_person", [])
        self.assertFalse(result["has_data"])
        self.assertEqual(result["events"], [])
        self.assertTrue(all(device["value"] == 0 and not device["has_data"]
                            for device in result["appliances"]))

    def test_tv_duration_clips_to_requested_day(self):
        rows = [
            event("TV", "켜짐", "2023-09-22 23:30:00", "tv1",
                  status="source_based_inference"),
            event("TV", "꺼짐", "2023-09-23 00:30:00", "tv1",
                  status="source_based_inference"),
        ]
        result = build_daily_response("home", date(2023, 9, 23),
                                      "appliance_data_one_person", rows)
        tv = next(device for device in result["appliances"] if device["id"] == "tv")
        self.assertEqual(tv["value"], 0.5)
        self.assertEqual(len(tv["events"]), 1)

    def test_unpaired_tv_does_not_gain_estimated_duration(self):
        rows = [event("TV", "켜짐", "2023-09-23 10:00:00", "tv1")]
        result = build_daily_response("home", date(2023, 9, 23),
                                      "appliance_data_one_person", rows)
        tv = next(device for device in result["appliances"] if device["id"] == "tv")
        self.assertEqual(tv["value"], 0)
        self.assertEqual(tv["incomplete_episode_count"], 1)

    def test_local_csv_matches_daily_metric_sample(self):
        appliance_sample_dir = (
            Path(__file__).resolve().parents[2]
            / "report_data/appliance_data/sample"
        )
        daily_sample_dir = (
            Path(__file__).resolve().parents[1]
            / "data/processed/public/aihub_appliance_sample"
        )
        with (appliance_sample_dir / "sample_fridge_tv_purifier_15days.csv").open(
                encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        with (daily_sample_dir / "sample_daily_metrics_15days.csv").open(
                encoding="utf-8-sig", newline="") as handle:
            metrics = list(csv.DictReader(handle))
        by_day = {}
        for metric in metrics:
            day = date.fromisoformat(metric["date"])
            if day not in by_day:
                response = build_daily_response(metric["home_id"], day,
                                                "appliance_data_one_person", rows)
                by_day[day] = {item["metric_code"]: item["value"]
                               for item in response["appliances"]}
            self.assertLessEqual(
                abs(by_day[day][metric["metric_code"]] - float(metric["value"])),
                0.00101,
            )


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.repository = PsqlRepository({"PGHOST": "example.invalid", "PGDATABASE": "db",
                                          "PGUSER": "user", "PGPASSWORD": "test-secret"})
        self.repository.psql = "/usr/bin/psql"

    def test_prefers_current_table_and_uses_select_only(self):
        columns = [f"appliance_data_one_person\t{column}" for column in sorted(
            {"home_id", "appliance", "action", "event_time", "episode_id", "phase",
             "data_status", "evidence", "source_file", "source_anchor",
             "scenario_note", "volume_ml"})]
        with patch.object(self.repository, "_query", side_effect=[columns, []]) as query:
            table, rows = self.repository.list_events("demo_solo_house009", date(2023, 9, 23))
        self.assertEqual((table, rows), ("appliance_data_one_person", []))
        self.assertIn("public.appliance_data_one_person", query.call_args_list[1].args[0])
        self.assertNotIn("DELETE", query.call_args_list[1].args[0])

    def test_rejects_incompatible_current_schema(self):
        with patch.object(self.repository, "_query", return_value=[
                "appliance_data_one_person\thome_id"]):
            with self.assertRaises(DatabaseUnavailable):
                self.repository._discover_table()

    def test_no_password_in_command(self):
        with patch("back.api.appliance_api.subprocess.run") as run:
            run.return_value.stdout = ""
            self.repository._query("SELECT 1")
        command = run.call_args.args[0]
        self.assertNotIn("test-secret", str(command))
        self.assertEqual(run.call_args.kwargs["env"]["PGPASSWORD"], "test-secret")
        self.assertIn("default_transaction_read_only=on",
                      run.call_args.kwargs["env"]["PGOPTIONS"])


if __name__ == "__main__":
    unittest.main()
