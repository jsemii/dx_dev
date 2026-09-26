import json
from pathlib import Path
from typing import Any

from openai import OpenAI

from app.config import Settings, get_settings
from app.models import SummaryOutput


PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "daily_report_prompt.md"


def generate_summary(
    payload: dict[str, Any], settings: Settings | None = None
) -> str:
    active_settings = settings or get_settings()
    developer_prompt = PROMPT_PATH.read_text(encoding="utf-8")
    client = OpenAI(api_key=active_settings.require_openai_api_key())
    response = client.responses.parse(
        model=active_settings.openai_model,
        input=[
            {"role": "developer", "content": developer_prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        text_format=SummaryOutput,
        store=active_settings.openai_store,
    )
    if response.output_parsed is None:
        raise RuntimeError("OpenAI 응답을 summary로 변환하지 못했습니다.")
    return response.output_parsed.summary
