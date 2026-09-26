from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


Severity = Literal["normal", "notice", "attention"]
ReportProfile = Literal["one_person", "two_to_three"]


class Highlight(BaseModel):
    category: Literal["appliance", "behavior", "care", "routine", "other"]
    title: str = Field(min_length=1, max_length=80)
    baseline: str = Field(min_length=1, max_length=160)
    today: str = Field(min_length=1, max_length=160)
    severity: Severity
    evidence_refs: list[str] = Field(default_factory=list)


class TimelineItem(BaseModel):
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    title: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=1, max_length=200)
    severity: Severity
    evidence_refs: list[str] = Field(default_factory=list)


class SummaryOutput(BaseModel):
    summary: str = Field(min_length=1, max_length=500)


class ReportContent(BaseModel):
    overall_status: Severity
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=1, max_length=500)
    timeline: list[TimelineItem] = Field(default_factory=list, max_length=30)
    highlights: list[Highlight] = Field(default_factory=list, max_length=8)


class ReportSource(BaseModel):
    profile: ReportProfile
    table_name: str
    row_count: int = Field(ge=1)
    event_count: int = Field(ge=0)
    metric_count: int = Field(ge=0)
    model: str


class DailyReport(BaseModel):
    format_version: int = Field(default=3, ge=1)
    report_id: str
    home_id: str
    household_type: str
    report_date: str
    generated_at: str | None = None
    source: ReportSource
    content: ReportContent


@dataclass(frozen=True)
class LifePatternState:
    resident_thinq_id: str
    observation_start_date: date
    initial_wake_time: Any
    initial_sleep_time: Any
    initial_breakfast_time: Any
    initial_lunch_time: Any
    initial_dinner_time: Any
    valid_day_count: int
    observed_pattern: dict[str, Any]
    standard_pattern: dict[str, Any]
    as_of_date: date | None


@dataclass(frozen=True)
class StoredReport:
    report_id: UUID
    resident_thinq_id: str
    report_date: date
    baseline_pattern: dict[str, Any]
    summary: str
    timeline: list[dict[str, Any]]
    highlights: list[dict[str, Any]]


@dataclass(frozen=True)
class GenerationSnapshot:
    resident_thinq_id: str
    profile: ReportProfile
    start_date: date
    end_date: date
    life_pattern: LifePatternState
    records_by_date: dict[date, list[dict[str, Any]]]
    metric_history: list[dict[str, Any]]
    reports_by_date: dict[date, StoredReport]
    share_counts: dict[UUID, int]
    fingerprint: str


@dataclass(frozen=True)
class PreparedReport:
    report_id: UUID
    resident_thinq_id: str
    report_date: date
    baseline_pattern: dict[str, Any]
    content: ReportContent
    next_life_pattern: LifePatternState
    household_type: str
    row_count: int
    event_count: int
    metric_count: int


@dataclass(frozen=True)
class ReportInputs:
    resident_thinq_id: str
    profile: ReportProfile
    report_date: date
    life_pattern: LifePatternState
    daily_records: list[dict[str, Any]]
    metric_history: list[dict[str, Any]]
    fingerprint: str
