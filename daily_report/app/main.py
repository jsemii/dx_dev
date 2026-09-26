import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.config import ReportProfile, get_settings
from app.models import DailyReport
from app.report_repository import load_report_from_database, parse_report_date
from app.report_service import (
    create_daily_report,
    validate_generation_date_policy,
    validate_lookup_date_policy,
)


logger = logging.getLogger(__name__)
app = FastAPI(title="Daily Report API", version="1.0.0")


class GenerateReportRequest(BaseModel):
    profile: ReportProfile = "one_person"
    home_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    report_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    model: str | None = Field(default=None, min_length=1, max_length=128)
    force: bool = False


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/reports/generate", response_model=DailyReport)
def generate_report(request: GenerateReportRequest) -> DailyReport:
    try:
        settings = get_settings()
        validate_generation_date_policy(parse_report_date(request.report_date))
        if request.model:
            settings = settings.model_copy(update={"openai_model": request.model})
        report, _ = create_daily_report(
            request.profile,
            request.report_date,
            settings=settings,
            force=request.force,
            resident_thinq_id=request.home_id,
        )
        return report
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.exception("Daily report generation failed")
        raise HTTPException(status_code=502, detail="리포트 생성 서비스 호출에 실패했습니다.") from error


@app.get("/api/v1/reports/{home_id}/{report_date}", response_model=DailyReport)
def get_report(
    home_id: str,
    report_date: str,
    model: str | None = None,
    profile: ReportProfile = "one_person",
) -> DailyReport:
    try:
        settings = get_settings()
        validate_lookup_date_policy(parse_report_date(report_date))
        if model:
            settings = settings.model_copy(update={"openai_model": model})
        return load_report_from_database(profile, home_id, report_date, settings)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
