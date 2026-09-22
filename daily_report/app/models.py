from typing import Literal

from pydantic import BaseModel, Field


Severity = Literal["normal", "notice", "attention"]
ReportProfile = Literal["one_person", "two_to_three"]


class Highlight(BaseModel):
    category: Literal["appliance", "behavior", "routine", "other"]
    title: str = Field(min_length=1, max_length=60)
    baseline: str = Field(min_length=1, max_length=160)
    today: str = Field(min_length=1, max_length=160)
    severity: Severity
    evidence_refs: list[int] = Field(default_factory=list)


class TimelineItem(BaseModel):
    time: str
    title: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=1, max_length=200)
    severity: Severity
    evidence_refs: list[int] = Field(default_factory=list)


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
    format_version: int = Field(default=1, ge=1)
    report_id: str
    home_id: str
    household_type: str
    report_date: str
    generated_at: str
    source: ReportSource
    content: ReportContent
