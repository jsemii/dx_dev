"""Deterministic TV interval calculation shared by reporting and dashboard code."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta
from typing import Any


CALCULATED = "CALCULATED"
UNAVAILABLE = "UNAVAILABLE"
EPISODE = "EPISODE"
SEQUENCE_FALLBACK = "SEQUENCE_FALLBACK"
MAX_INTERVAL = timedelta(hours=24)


class IntervalCalculationError(ValueError):
    """The input cannot be evaluated safely because its identity is inconsistent."""


def _parse_time(value: object) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise IntervalCalculationError("invalid event_time") from error
    raise IntervalCalculationError("event_time must be a datetime or ISO-8601 string")


def _freeze(value: object) -> object:
    if isinstance(value, Mapping):
        return tuple(sorted((str(key), _freeze(item)) for key, item in value.items()))
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, set):
        return tuple(sorted(_freeze(item) for item in value))
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _unavailable(reason: str, *, event_count: int, valid_episodes: int, incomplete_episodes: int) -> dict[str, Any]:
    return {
        "status": UNAVAILABLE,
        "source": UNAVAILABLE,
        "total_seconds": None,
        "intervals": [],
        "event_count": event_count,
        "valid_episode_count": valid_episodes,
        "incomplete_episode_count": incomplete_episodes,
        "reason": reason,
    }


def _public_interval(start: dict[str, Any], end: dict[str, Any], source: str) -> dict[str, Any]:
    return {
        "start_event_id": start["event_id"],
        "end_event_id": end["event_id"],
        "start_time": start["event_time"].isoformat(),
        "end_time": end["event_time"].isoformat(),
        "start_episode_id": start["episode_id"],
        "end_episode_id": end["episode_id"],
        "source": source,
        "duration_seconds": int((end["event_time"] - start["event_time"]).total_seconds()),
    }


def calculate_tv_intervals(events: Iterable[Mapping[str, object]]) -> dict[str, Any]:
    """Calculate complete daily TV intervals without mutating ``events``.

    Exact episode pairs are consumed first. Remaining events may be paired only
    when their complete chronological sequence strictly alternates ON then OFF.
    Any ambiguity makes the whole result unavailable rather than returning a
    misleading partial total.
    """

    unique: dict[str, tuple[object, dict[str, Any]]] = {}
    for raw in events:
        if not isinstance(raw, Mapping):
            raise IntervalCalculationError("event must be a mapping")
        event_id = raw.get("event_id")
        episode_id = raw.get("episode_id")
        action = raw.get("action", raw.get("event_type"))
        if not isinstance(event_id, str) or not event_id:
            raise IntervalCalculationError("event_id is required")
        if not isinstance(episode_id, str) or not episode_id:
            raise IntervalCalculationError("episode_id is required")
        if action not in {"켜짐", "꺼짐"}:
            raise IntervalCalculationError("unsupported TV action")
        normalized = {
            "event_id": event_id,
            "episode_id": episode_id,
            "action": action,
            "event_time": _parse_time(raw.get("event_time")),
        }
        fingerprint = _freeze(raw)
        previous = unique.get(event_id)
        if previous is not None:
            if previous[0] != fingerprint:
                raise IntervalCalculationError("conflicting duplicate event_id")
            continue
        unique[event_id] = (fingerprint, normalized)

    ordered = sorted(
        (item[1] for item in unique.values()),
        key=lambda event: (event["event_time"], event["event_id"]),
    )
    event_count = len(ordered)
    if not ordered:
        return _unavailable(
            "no_events", event_count=0, valid_episodes=0, incomplete_episodes=0
        )

    by_episode: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in ordered:
        by_episode[event["episode_id"]].append(event)

    explicit: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    used_ids: set[str] = set()
    valid_episode_count = 0
    for episode_events in by_episode.values():
        starts = [event for event in episode_events if event["action"] == "켜짐"]
        ends = [event for event in episode_events if event["action"] == "꺼짐"]
        if len(starts) != 1 or len(ends) != 1:
            continue
        start, end = starts[0], ends[0]
        duration = end["event_time"] - start["event_time"]
        if (
            duration <= timedelta(0)
            or duration > MAX_INTERVAL
            or start["event_time"].date() != end["event_time"].date()
        ):
            continue
        explicit.append((start, end, EPISODE))
        used_ids.update((start["event_id"], end["event_id"]))
        valid_episode_count += 1

    incomplete_episode_count = len(by_episode) - valid_episode_count
    remaining = [event for event in ordered if event["event_id"] not in used_ids]
    fallback: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    if remaining:
        if len(remaining) % 2:
            return _unavailable(
                "unclosed_sequence",
                event_count=event_count,
                valid_episodes=valid_episode_count,
                incomplete_episodes=incomplete_episode_count,
            )
        for index in range(0, len(remaining), 2):
            start, end = remaining[index], remaining[index + 1]
            if start["action"] != "켜짐" or end["action"] != "꺼짐":
                return _unavailable(
                    "ambiguous_sequence",
                    event_count=event_count,
                    valid_episodes=valid_episode_count,
                    incomplete_episodes=incomplete_episode_count,
                )
            duration = end["event_time"] - start["event_time"]
            if (
                duration <= timedelta(0)
                or duration > MAX_INTERVAL
                or start["event_time"].date() != end["event_time"].date()
            ):
                return _unavailable(
                    "invalid_sequence_duration",
                    event_count=event_count,
                    valid_episodes=valid_episode_count,
                    incomplete_episodes=incomplete_episode_count,
                )
            fallback.append((start, end, SEQUENCE_FALLBACK))

    intervals = sorted(explicit + fallback, key=lambda item: (item[0]["event_time"], item[0]["event_id"]))
    for previous, current in zip(intervals, intervals[1:]):
        if current[0]["event_time"] < previous[1]["event_time"]:
            return _unavailable(
                "overlapping_intervals",
                event_count=event_count,
                valid_episodes=valid_episode_count,
                incomplete_episodes=incomplete_episode_count,
            )

    total_seconds = sum(
        int((end["event_time"] - start["event_time"]).total_seconds())
        for start, end, _ in intervals
    )
    if total_seconds <= 0 or total_seconds > int(MAX_INTERVAL.total_seconds()):
        return _unavailable(
            "invalid_total_duration",
            event_count=event_count,
            valid_episodes=valid_episode_count,
            incomplete_episodes=incomplete_episode_count,
        )
    source = SEQUENCE_FALLBACK if fallback else EPISODE
    return {
        "status": CALCULATED,
        "source": source,
        "total_seconds": total_seconds,
        "intervals": [_public_interval(start, end, interval_source) for start, end, interval_source in intervals],
        "event_count": event_count,
        "valid_episode_count": valid_episode_count,
        "incomplete_episode_count": incomplete_episode_count,
        "reason": None,
    }
