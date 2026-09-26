"""Regression tests for the shared TV interval policy."""

from copy import deepcopy
from datetime import datetime
import unittest

from back.api.appliance_intervals import (
    CALCULATED,
    EPISODE,
    SEQUENCE_FALLBACK,
    UNAVAILABLE,
    IntervalCalculationError,
    calculate_tv_intervals,
)
from report_data.reporting_data.scripts.generate_reporting_data import compute_metrics


def event(event_id, action, when, episode):
    return {
        "event_id": event_id,
        "action": action,
        "event_time": datetime.fromisoformat(when),
        "episode_id": episode,
        "appliance": "TV",
        "volume_ml": None,
    }


class TvIntervalTests(unittest.TestCase):
    def test_normal_episode_and_input_is_not_mutated(self):
        events = [
            event("on", "켜짐", "2026-09-22T09:18:00", "episode-1"),
            event("off", "꺼짐", "2026-09-22T11:13:16", "episode-1"),
        ]
        original = deepcopy(events)
        result = calculate_tv_intervals(events)
        self.assertEqual(result["status"], CALCULATED)
        self.assertEqual(result["source"], EPISODE)
        self.assertEqual(result["total_seconds"], 6916)
        self.assertEqual(events, original)

    def test_strict_sequence_fallback_for_two_intervals(self):
        events = [
            event("on-1", "켜짐", "2026-09-23T08:50:00", "a"),
            event("off-1", "꺼짐", "2026-09-23T10:00:00", "b"),
            event("on-2", "켜짐", "2026-09-23T19:20:00", "c"),
            event("off-2", "꺼짐", "2026-09-23T21:40:00", "d"),
        ]
        result = calculate_tv_intervals(events)
        self.assertEqual(result["status"], CALCULATED)
        self.assertEqual(result["source"], SEQUENCE_FALLBACK)
        self.assertEqual(result["total_seconds"], 12600)
        self.assertEqual(len(result["intervals"]), 2)

    def test_episode_and_fallback_can_be_combined_without_double_counting(self):
        result = calculate_tv_intervals([
            event("on-1", "켜짐", "2026-09-23T08:00:00", "episode-1"),
            event("off-1", "꺼짐", "2026-09-23T09:00:00", "episode-1"),
            event("on-2", "켜짐", "2026-09-23T10:00:00", "different-on"),
            event("off-2", "꺼짐", "2026-09-23T10:30:00", "different-off"),
        ])
        self.assertEqual(result["source"], SEQUENCE_FALLBACK)
        self.assertEqual(result["total_seconds"], 5400)
        self.assertEqual([item["source"] for item in result["intervals"]], [EPISODE, SEQUENCE_FALLBACK])

    def test_ambiguous_sequences_are_unavailable(self):
        cases = {
            "leading-off": [event("off", "꺼짐", "2026-09-23T08:00:00", "a")],
            "consecutive-on": [
                event("on-1", "켜짐", "2026-09-23T08:00:00", "a"),
                event("on-2", "켜짐", "2026-09-23T09:00:00", "b"),
            ],
            "consecutive-off": [
                event("on", "켜짐", "2026-09-23T08:00:00", "a"),
                event("off-1", "꺼짐", "2026-09-23T09:00:00", "b"),
                event("off-2", "꺼짐", "2026-09-23T10:00:00", "c"),
                event("on-2", "켜짐", "2026-09-23T11:00:00", "d"),
            ],
            "unclosed-on": [event("on", "켜짐", "2026-09-23T08:00:00", "a")],
        }
        for name, events in cases.items():
            with self.subTest(name=name):
                result = calculate_tv_intervals(events)
                self.assertEqual(result["status"], UNAVAILABLE)
                self.assertIsNone(result["total_seconds"])

    def test_identical_duplicate_is_removed_and_conflict_raises(self):
        on = event("same", "켜짐", "2026-09-23T08:00:00", "episode")
        off = event("off", "꺼짐", "2026-09-23T09:00:00", "episode")
        result = calculate_tv_intervals([on, deepcopy(on), off])
        self.assertEqual(result["total_seconds"], 3600)
        conflict = {**on, "action": "꺼짐"}
        with self.assertRaises(IntervalCalculationError):
            calculate_tv_intervals([on, conflict])

    def test_zero_negative_midnight_and_over_24_hours_are_unavailable(self):
        cases = (
            [event("on", "켜짐", "2026-09-23T08:00:00", "a"), event("off", "꺼짐", "2026-09-23T08:00:00", "a")],
            [event("off", "꺼짐", "2026-09-23T08:00:00", "a"), event("on", "켜짐", "2026-09-23T09:00:00", "a")],
            [event("on", "켜짐", "2026-09-23T23:50:00", "a"), event("off", "꺼짐", "2026-09-24T00:10:00", "a")],
            [event("on", "켜짐", "2026-09-23T00:00:00", "a"), event("off", "꺼짐", "2026-09-24T00:00:01", "a")],
        )
        for events in cases:
            with self.subTest(events=events):
                self.assertEqual(calculate_tv_intervals(events)["status"], UNAVAILABLE)

    def test_overlapping_explicit_intervals_are_unavailable(self):
        result = calculate_tv_intervals([
            event("on-1", "켜짐", "2026-09-23T08:00:00", "one"),
            event("on-2", "켜짐", "2026-09-23T08:30:00", "two"),
            event("off-1", "꺼짐", "2026-09-23T09:00:00", "one"),
            event("off-2", "꺼짐", "2026-09-23T09:30:00", "two"),
        ])
        self.assertEqual(result["status"], UNAVAILABLE)

    def test_dashboard_policy_and_reporting_generator_return_same_total(self):
        events = [
            event("on-1", "켜짐", "2026-09-23T08:50:00", "a"),
            event("off-1", "꺼짐", "2026-09-23T10:00:00", "b"),
            event("on-2", "켜짐", "2026-09-23T19:20:00", "c"),
            event("off-2", "꺼짐", "2026-09-23T21:40:00", "d"),
        ]
        shared = calculate_tv_intervals(events)
        generated = compute_metrics(datetime(2026, 9, 23).date(), events, [])
        self.assertEqual(generated["tv_usage_minutes"], shared["total_seconds"] / 60)
        self.assertEqual(generated["tv_usage_minutes"], 210)

    def test_reporting_generator_does_not_turn_ambiguous_tv_data_into_zero(self):
        events = [event("on", "켜짐", "2026-09-23T08:50:00", "unclosed")]
        generated = compute_metrics(datetime(2026, 9, 23).date(), events, [])
        self.assertIsNone(generated["tv_usage_minutes"])

    def test_reporting_generator_keeps_zero_for_a_day_with_no_tv_events(self):
        generated = compute_metrics(datetime(2026, 9, 23).date(), [], [])
        self.assertEqual(generated["tv_usage_minutes"], 0.0)


if __name__ == "__main__":
    unittest.main()
