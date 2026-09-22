import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.config import ReportProfile, get_settings
from app.models import DailyReport
from app.report_service import create_daily_report
from app.report_store import load_report


logger = logging.getLogger(__name__)
app = FastAPI(title="Daily Report API", version="1.0.0")


class GenerateReportRequest(BaseModel):
    profile: ReportProfile = "one_person"
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
        if request.model:
            settings = settings.model_copy(update={"openai_model": request.model})
        report, _ = create_daily_report(
            request.profile,
            request.report_date,
            settings=settings,
            force=request.force,
        )
        return report
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.exception("Daily report generation failed")
        raise HTTPException(status_code=502, detail="리포트 생성 서비스 호출에 실패했습니다.") from error


@app.get("/api/v1/reports/{home_id}/{report_date}", response_model=DailyReport)
def get_report(home_id: str, report_date: str, model: str | None = None) -> DailyReport:
    try:
        settings = get_settings()
        return load_report(
            settings.report_output_dir,
            home_id,
            report_date,
            model or settings.openai_model,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
