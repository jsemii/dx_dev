# `daily_report` 독립 프로젝트 구축 가이드

> 현재 실행 구조는 PostgreSQL의 대표 가구 테이블을 날짜별로 조회하는 방식으로
> 변경되었습니다. 아래 CSV 내용은 초기 초안과 회귀 테스트 참고용이며, 실제 실행
> 방법은 `README.md`를 기준으로 합니다.

## 1. 목표와 전제

이 프로젝트는 팀원이 VS Code에서 **제로베이스로 만드는 독립 Python 프로젝트**다. 처음 보유한 데이터는 아래 일일지표 CSV 한 파일뿐이라고 가정한다.

```text
daily_metrics_sample.csv
```

구현 범위는 다음과 같다.

1. 일일지표 CSV를 읽고 검증한다.
2. 한 가정의 하루 데이터를 선택해 시간순으로 정렬한다.
3. CSV 행을 LLM 입력용 JSON으로 변환한다.
4. OpenAI API로 데일리 리포트를 생성한다.
5. 응답을 정해진 JSON 구조로 검증하고 파일로 저장한다.
6. CLI와 REST API로 생성·조회한다.
7. 독립 Git 저장소에 올려 다른 팀원이 clone/pull할 수 있게 한다.

가전 원본, 행동 원본, 센서 수집 코드, PostgreSQL, 기존 `back`, 기존 `frontend`는 전제로 사용하지 않는다.

```text
일일지표 CSV → daily_report → 프론트용 데일리 리포트 JSON
```

---

## 2. 프로젝트가 담당하는 일

### 포함

- CSV 필수 열과 값 검증
- `home_id`, `date` 기준 필터링
- `event_time` 기준 시간순 정렬
- 숫자와 빈값 정규화
- OpenAI Responses API 호출
- Structured Outputs 기반 JSON 형식 고정
- LLM 근거 행 번호 검증
- 결과 JSON 저장
- 리포트 생성·조회 API
- 자동 테스트

### 제외

- 가전·행동 원본 전처리
- 일일지표 계산 또는 재생성
- 센서 수집
- 데이터베이스 적재
- 프론트 화면 구현
- 스피커·TV 출력
- 의료 진단

LLM은 자연어 요약과 카드 구성을 담당한다. 파일 선택, 필터링, 정렬, 데이터 타입 변환, 결과 형식 검증은 Python 코드가 담당한다.

---

## 3. 처리 흐름

```text
┌──────────────────────────┐
│ daily_metrics_sample.csv │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ CSV 로딩·열 검증          │
│ home_id/date 필터링       │
│ event_time 시간순 정렬    │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ LLM 입력 JSON             │
│ 메타데이터 + 지표 행 목록 │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ OpenAI Responses API      │
│ Structured Outputs        │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ Pydantic 검증             │
│ evidence_refs 검증        │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ data/output/*.json        │
│ REST API 응답             │
└──────────────────────────┘
```

CSV 텍스트를 그대로 프롬프트에 붙이지 않는다. 서버가 먼저 CSV를 검증하고 타입이 정리된 JSON으로 변환한 뒤 모델에 전달한다.

---

## 4. 기술 구성

| 영역 | 기술 | 용도 |
|---|---|---|
| 언어 | Python 3.11 이상 | CSV 처리와 서비스 구현 |
| API | FastAPI | 메인 백엔드와 REST 연결 |
| 검증 | Pydantic | 입출력 JSON 스키마 강제 |
| 설정 | pydantic-settings | `.env` 환경 변수 관리 |
| LLM | OpenAI Python SDK | Responses API 호출 |
| 테스트 | pytest | 로더·서비스·API 테스트 |

---

## 5. 폴더 구조

```text
daily_report/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── models.py
│   ├── csv_loader.py
│   ├── prompt_builder.py
│   ├── openai_report.py
│   ├── report_store.py
│   └── report_service.py
├── data/
│   ├── input/
│   │   └── daily_metrics_sample.csv
│   └── output/
│       └── .gitkeep
├── prompts/
│   └── daily_report_prompt.md
├── scripts/
│   ├── inspect_csv.py
│   └── generate_report.py
├── tests/
│   ├── fixtures/
│   │   └── daily_metrics_test.csv
│   ├── test_csv_loader.py
│   ├── test_report_service.py
│   └── test_api.py
├── .env.example
├── .gitignore
├── requirements.txt
├── pyproject.toml
└── README.md
```

- app/: 리포트 생성·조회 API와 데이터 처리 코드
- data/input/sample/: 프롬프트 테스트용 일일지표 샘플 CSV
- data/output/: 생성된 데일리 리포트 JSON
- prompts/: 데일리 리포트 생성용 LLM 지시문
- scripts/: 데이터 검증과 리포트 생성 실행 도구
- tests/: 샘플·증강 데이터 구조와 API 자동 테스트
- .env.example: OpenAI API 키·모델·데이터 경로 설정 예시
- .gitignore: API 키와 생성 결과의 Git 업로드 방지
- requirements.txt: Python 패키지 목록
- pyproject.toml: 프로젝트 및 테스트 설정
- README.md: 설치·실행·연동 방법 안내

---

## 6. 프로젝트 생성

```bash
mkdir daily_report
cd daily_report

python3 -m venv .venv
source .venv/bin/activate

mkdir -p app data/input data/output prompts scripts tests/fixtures
touch app/__init__.py
touch data/output/.gitkeep
```

`requirements.txt`:

```text
fastapi>=0.115,<1.0
uvicorn[standard]>=0.34,<1.0
openai>=1.0,<3.0
pydantic>=2.10,<3.0
pydantic-settings>=2.7,<3.0
python-dotenv>=1.0,<2.0
pytest>=8.0,<9.0
httpx>=0.28,<1.0
```

설치:

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

---

## 7. 입력 CSV 규격

파일 위치:

```text
data/input/daily_metrics_sample.csv
```

필수 열:

```text
home_id,date,event_time,subject_type,subject,metric_code,value,unit,baseline_value,delta_value,baseline_days,data_status,evidence
```

| 열 | 의미 | 예시 |
|---|---|---|
| `home_id` | 가상가정 ID | `demo_solo_house009` |
| `date` | 리포트 날짜 | `2023-09-23` |
| `event_time` | 사건 시각 | `2023-09-23T08:30:00+09:00` |
| `subject_type` | 대상 유형 | `appliance`, `behavior` |
| `subject` | 대상 이름 | `refrigerator`, `walking` |
| `metric_code` | 지표 코드 | `door_open`, `behavior_detected` |
| `value` | 당일 값 | `1`, `12.5` |
| `unit` | 단위 | `count`, `minute`, `L` |
| `baseline_value` | 평소 값 | `0.8` |
| `delta_value` | 당일 값과 평소 값의 차이 | `0.2` |
| `baseline_days` | 평소 값 기준 일수 | `7` |
| `data_status` | 데이터 성격 | `observed`, `synthetic`, `estimated` |
| `evidence` | 행의 생성·판단 근거 | 원본 사건이나 집계 규칙 |

처리 규칙:

1. 필수 열이 없으면 중단한다.
2. 한 번에 한 `home_id`, 한 `date`만 처리한다.
3. `event_time` 순으로 정렬한다.
4. 숫자 열은 숫자로 변환하고 빈값은 `null`로 둔다.
5. `synthetic`, `estimated` 상태를 실제 관측처럼 표현하지 않는다.
6. CSV에 없는 사실이나 수치를 만들지 않는다.

---

## 8. OpenAI API 키 설정

### 정확한 위치

실제 API 키는 `daily_report/.env`에만 넣는다.

```text
daily_report/
├── .env          ← 실제 키, Git 업로드 금지
├── .env.example  ← 변수명만 공유
└── ...
```

`.env`:

```dotenv
OPENAI_API_KEY=여기에_발급받은_실제_API_키
OPENAI_MODEL=gpt-6-astra
OPENAI_STORE=false
REPORT_INPUT_CSV=data/input/daily_metrics_sample.csv
REPORT_OUTPUT_DIR=data/output
```

`.env.example`:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-astra
OPENAI_STORE=false
REPORT_INPUT_CSV=data/input/daily_metrics_sample.csv
REPORT_OUTPUT_DIR=data/output
```

주의:

- 키를 Python 코드나 프론트 코드에 직접 적지 않는다.
- `.env`를 Git, 채팅, 문서, 화면 캡처에 올리지 않는다.
- 노출된 키는 즉시 폐기하고 새 키를 만든다.
- 모델명은 `.env`에서 바꾸고 코드에 고정하지 않는다.

`.gitignore`:

```gitignore
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.env
data/output/*.json
!data/output/.gitkeep
.DS_Store
```

Git 제외 확인:

```bash
git check-ignore -v .env
```

`.env`가 무시된다고 표시되어야 한다.

---

## 9. 설정 코드

`app/config.py`:

```python
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: SecretStr
    openai_model: str = "gpt-6-astra"
    openai_store: bool = False
    report_input_csv: Path = Path("data/input/daily_metrics_sample.csv")
    report_output_dir: Path = Path("data/output")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
```

`OPENAI_API_KEY`는 이 코드가 `.env`에서 읽으며, 로그로 출력하지 않는다.

---

## 10. 프론트용 출력 JSON 계약

예시:

```json
{
  "report_id": "demo_solo_house009_2023-09-23",
  "home_id": "demo_solo_house009",
  "report_date": "2023-09-23",
  "generated_at": "2026-09-21T12:00:00+09:00",
  "source": {
    "file_name": "daily_metrics_sample.csv",
    "row_count": 111,
    "model": "gpt-6-astra"
  },
  "content": {
    "overall_status": "attention",
    "title": "2023년 9월 23일 생활 리포트",
    "summary": "하루 생활을 요약한 문장",
    "highlights": [],
    "timeline": [],
    "recommendations": []
  }
}
```

`app/models.py`:

```python
from typing import Literal

from pydantic import BaseModel, Field


Severity = Literal["normal", "notice", "attention"]


class Highlight(BaseModel):
    category: Literal["appliance", "behavior", "routine", "other"]
    title: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=1, max_length=300)
    severity: Severity
    evidence_refs: list[int] = Field(default_factory=list)


class TimelineItem(BaseModel):
    time: str
    title: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=1, max_length=200)
    severity: Severity
    evidence_refs: list[int] = Field(default_factory=list)


class Recommendation(BaseModel):
    priority: Literal["low", "medium", "high"]
    title: str = Field(min_length=1, max_length=60)
    message: str = Field(min_length=1, max_length=250)
    evidence_refs: list[int] = Field(default_factory=list)


class ReportContent(BaseModel):
    overall_status: Severity
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=1, max_length=500)
    highlights: list[Highlight] = Field(max_length=8)
    timeline: list[TimelineItem] = Field(max_length=30)
    recommendations: list[Recommendation] = Field(max_length=5)


class ReportSource(BaseModel):
    file_name: str
    row_count: int
    model: str


class DailyReport(BaseModel):
    report_id: str
    home_id: str
    report_date: str
    generated_at: str
    source: ReportSource
    content: ReportContent
```

`evidence_refs`는 LLM에 전달된 일일지표 행의 `row_id`다. 결과의 근거 추적과 환각 검사에 사용한다.

---

## 11. CSV 로더

`app/csv_loader.py`:

```python
import csv
from pathlib import Path
from typing import Any


REQUIRED_COLUMNS = {
    "home_id", "date", "event_time", "subject_type", "subject",
    "metric_code", "value", "unit", "baseline_value", "delta_value",
    "baseline_days", "data_status", "evidence",
}

NUMBER_COLUMNS = {
    "value", "baseline_value", "delta_value", "baseline_days",
}


def _number_or_none(value: str) -> int | float | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError as exc:
        raise ValueError(f"숫자 열에 잘못된 값이 있습니다: {value}") from exc
    return int(number) if number.is_integer() else number


def load_daily_metrics(
    path: Path,
    home_id: str,
    report_date: str,
) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"CSV 파일을 찾을 수 없습니다: {path}")

    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        columns = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise ValueError(f"필수 열이 없습니다: {sorted(missing)}")

        selected = []
        for source_row_number, row in enumerate(reader, start=2):
            if row["home_id"].strip() != home_id:
                continue
            if row["date"].strip() != report_date:
                continue

            normalized = {key: (value or "").strip() for key, value in row.items()}
            for column in NUMBER_COLUMNS:
                normalized[column] = _number_or_none(row[column])
            normalized["source_row_number"] = source_row_number
            selected.append(normalized)

    if not selected:
        raise ValueError(
            f"home_id={home_id}, date={report_date}에 해당하는 행이 없습니다."
        )

    selected.sort(key=lambda row: row["event_time"] or "")
    for row_id, row in enumerate(selected, start=1):
        row["row_id"] = row_id
    return selected
```

`row_id`는 LLM 근거 번호이고, `source_row_number`는 실제 CSV 행 번호다.

---

## 12. LLM 입력 JSON 생성

`app/prompt_builder.py`:

```python
from typing import Any


def build_report_input(
    home_id: str,
    report_date: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "task": "daily_homecare_report",
        "home_id": home_id,
        "report_date": report_date,
        "source_notice": (
            "입력은 일일지표 샘플입니다. "
            "observed, estimated, synthetic 상태를 구분하십시오."
        ),
        "rules": [
            "입력 행에 없는 사실을 만들지 않는다.",
            "value와 baseline_value를 임의로 재계산하지 않는다.",
            "의학적 진단이나 질병 단정을 하지 않는다.",
            "주요 판단에 evidence_refs를 포함한다.",
            "timeline은 event_time 순서로 작성한다.",
        ],
        "daily_metrics": rows,
    }
```

한 CSV에 여러 가구·날짜가 있어도 요청한 가구·날짜의 행만 모델에 보낸다.

---

## 13. 프롬프트

`prompts/daily_report_prompt.md`:

```markdown
당신은 생활 데이터를 보호자에게 설명하는 돌봄 리포트 작성 도우미입니다.

입력으로 제공된 일일지표 JSON만 근거로 사용하십시오.

작성 원칙:

1. 한국어로 작성합니다.
2. 과장, 공포 유발, 질병 진단을 하지 않습니다.
3. 입력에 없는 사건이나 수치를 만들지 않습니다.
4. data_status가 synthetic 또는 estimated이면 확정적 사실처럼 쓰지 않습니다.
5. 정상 생활과 주의 내용을 균형 있게 요약합니다.
6. 주요 요약·타임라인·권장사항에 row_id를 evidence_refs로 기록합니다.
7. 같은 사실을 반복하지 않습니다.
8. 보호자가 확인 가능한 행동만 권장합니다.
9. 제공된 JSON 스키마를 정확히 따릅니다.
```

프롬프트에는 역할과 규칙만 둔다. 실제 행 데이터는 실행 시 별도 입력으로 전달한다.

---

## 14. OpenAI 호출

`app/openai_report.py`:

```python
import json
from pathlib import Path
from typing import Any

from openai import OpenAI

from app.config import settings
from app.models import ReportContent


def generate_report_content(payload: dict[str, Any]) -> ReportContent:
    developer_prompt = Path("prompts/daily_report_prompt.md").read_text(
        encoding="utf-8"
    )
    client = OpenAI(api_key=settings.openai_api_key.get_secret_value())

    response = client.responses.parse(
        model=settings.openai_model,
        input=[
            {"role": "developer", "content": developer_prompt},
            {
                "role": "user",
                "content": json.dumps(payload, ensure_ascii=False),
            },
        ],
        text_format=ReportContent,
        store=settings.openai_store,
    )

    if response.output_parsed is None:
        raise RuntimeError("OpenAI 응답을 ReportContent로 변환하지 못했습니다.")
    return response.output_parsed
```

Structured Outputs를 사용해 일반 문자열을 임의로 JSON 파싱하는 문제를 줄인다. 스키마를 통과하지 못한 응답은 정상 결과로 저장하지 않는다.

---

## 15. 결과 저장

`app/report_store.py`:

```python
from pathlib import Path

from app.models import DailyReport


def report_path(output_dir: Path, home_id: str, report_date: str) -> Path:
    safe_home_id = "".join(
        char for char in home_id if char.isalnum() or char in {"-", "_"}
    )
    if not safe_home_id:
        raise ValueError("home_id가 올바르지 않습니다.")
    return output_dir / f"report_{safe_home_id}_{report_date}.json"


def save_report(report: DailyReport, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = report_path(output_dir, report.home_id, report.report_date)
    path.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    return path


def load_report(output_dir: Path, home_id: str, report_date: str) -> DailyReport:
    path = report_path(output_dir, home_id, report_date)
    if not path.exists():
        raise FileNotFoundError("생성된 리포트가 없습니다.")
    return DailyReport.model_validate_json(path.read_text(encoding="utf-8"))
```

---

## 16. 전체 서비스 로직

`app/report_service.py`:

```python
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.config import settings
from app.csv_loader import load_daily_metrics
from app.models import DailyReport, ReportSource
from app.openai_report import generate_report_content
from app.prompt_builder import build_report_input
from app.report_store import save_report


def _validate_evidence_refs(report: DailyReport, row_count: int) -> None:
    refs = []
    for item in report.content.highlights:
        refs.extend(item.evidence_refs)
    for item in report.content.timeline:
        refs.extend(item.evidence_refs)
    for item in report.content.recommendations:
        refs.extend(item.evidence_refs)

    invalid = sorted({ref for ref in refs if ref < 1 or ref > row_count})
    if invalid:
        raise ValueError(f"존재하지 않는 근거 행입니다: {invalid}")


def create_daily_report(home_id: str, report_date: str) -> tuple[DailyReport, Path]:
    rows = load_daily_metrics(
        settings.report_input_csv,
        home_id=home_id,
        report_date=report_date,
    )
    payload = build_report_input(home_id, report_date, rows)
    content = generate_report_content(payload)

    report = DailyReport(
        report_id=f"{home_id}_{report_date}",
        home_id=home_id,
        report_date=report_date,
        generated_at=datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        source=ReportSource(
            file_name=settings.report_input_csv.name,
            row_count=len(rows),
            model=settings.openai_model,
        ),
        content=content,
    )

    _validate_evidence_refs(report, len(rows))
    path = save_report(report, settings.report_output_dir)
    return report, path
```

실행 순서:

1. CSV 및 필수 열 확인
2. 가구·날짜 행 선택
3. 시간순 정렬 및 `row_id` 부여
4. LLM 입력 JSON 생성
5. OpenAI API 호출
6. `ReportContent` 스키마 검증
7. 서버 메타데이터 추가
8. `evidence_refs` 범위 확인
9. 최종 JSON 저장

---

## 17. 터미널 생성 명령

`scripts/generate_report.py`:

```python
import argparse

from app.report_service import create_daily_report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home-id", required=True)
    parser.add_argument("--date", required=True)
    args = parser.parse_args()

    report, path = create_daily_report(args.home_id, args.date)
    print(f"report_id: {report.report_id}")
    print(f"saved: {path.resolve()}")


if __name__ == "__main__":
    main()
```

실행:

```bash
source .venv/bin/activate
python -m scripts.generate_report \
  --home-id demo_solo_house009 \
  --date 2023-09-23
```

출력 파일:

```text
data/output/report_demo_solo_house009_2023-09-23.json
```

---

## 18. API 비용 없이 CSV 먼저 점검

`scripts/inspect_csv.py`:

```python
import argparse
from pathlib import Path

from app.csv_loader import load_daily_metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--home-id", required=True)
    parser.add_argument("--date", required=True)
    args = parser.parse_args()

    rows = load_daily_metrics(args.csv, args.home_id, args.date)
    print(f"선택된 행 수: {len(rows)}")
    print(f"첫 시각: {rows[0]['event_time']}")
    print(f"마지막 시각: {rows[-1]['event_time']}")
    print(f"subject_type: {sorted({row['subject_type'] for row in rows})}")
    print(f"data_status: {sorted({row['data_status'] for row in rows})}")


if __name__ == "__main__":
    main()
```

실행:

```bash
python -m scripts.inspect_csv \
  --csv data/input/daily_metrics_sample.csv \
  --home-id demo_solo_house009 \
  --date 2023-09-23
```

이 단계가 실패하면 OpenAI API를 호출하지 말고 CSV부터 수정한다.

---

## 19. REST API

`app/main.py`:

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.models import DailyReport
from app.report_service import create_daily_report
from app.report_store import load_report


app = FastAPI(title="Daily Report API", version="1.0.0")


class GenerateReportRequest(BaseModel):
    home_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    report_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/reports/generate", response_model=DailyReport)
def generate_report(request: GenerateReportRequest) -> DailyReport:
    try:
        report, _ = create_daily_report(request.home_id, request.report_date)
        return report
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail="리포트 생성 서비스 호출에 실패했습니다.",
        ) from error


@app.get(
    "/api/v1/reports/{home_id}/{report_date}",
    response_model=DailyReport,
)
def get_report(home_id: str, report_date: str) -> DailyReport:
    try:
        return load_report(settings.report_output_dir, home_id, report_date)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
```

서버 실행:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8002
```

상태 확인:

```bash
curl http://127.0.0.1:8002/health
```

리포트 생성:

```bash
curl -X POST http://127.0.0.1:8002/api/v1/reports/generate \
  -H 'Content-Type: application/json' \
  -d '{"home_id":"demo_solo_house009","report_date":"2023-09-23"}'
```

저장 결과 조회:

```bash
curl http://127.0.0.1:8002/api/v1/reports/demo_solo_house009/2023-09-23
```

API 문서:

```text
http://127.0.0.1:8002/docs
```

---

## 20. 테스트

### API 비용이 없는 테스트

- 필수 열 검증
- 가구·날짜 필터링
- 시간순 정렬
- 숫자·빈값 변환
- Pydantic 출력 검증
- 잘못된 `evidence_refs` 거부
- OpenAI 호출을 mock한 파일 저장
- FastAPI 상태·조회 API

실행:

```bash
pytest -q
```

### 실제 OpenAI 통합 테스트

- `.env` 키 로드
- 실제 모델 응답의 스키마 통과
- CSV에 없는 사실이 생성되지 않았는지 수동 검토
- 합성·추정 데이터가 확정적으로 표현되지 않는지 검토
- 같은 입력을 반복했을 때 핵심 사실이 유지되는지 검토

비용이 발생하는 테스트에는 표시를 붙인다.

```python
import pytest


@pytest.mark.integration
def test_real_openai_generation():
    ...
```

```bash
pytest -q -m integration
```

---

## 21. 프론트와 합치는 단계

### 1단계: JSON fixture로 화면 개발

팀원이 아래 생성 파일 한 개를 전달한다.

```text
data/output/report_demo_solo_house009_2023-09-23.json
```

프론트는 이 JSON으로 다음을 먼저 구현한다.

- 오늘의 상태
- 요약 문장
- 주요 생활 카드
- 시간순 생활 기록
- 보호자 확인 권장사항

### 2단계: API 연결

최종 구조에서는 Git pull로 매일 JSON을 전달하지 않고 API로 조회한다.

```text
프론트엔드
   ↓ GET /api/v1/reports/{home_id}/{date}
기존 백엔드
   ↓ 내부 요청
daily_report 서비스 :8002
   ↓
저장된 리포트 JSON
```

프론트가 `daily_report`를 직접 호출하지 않고 기존 백엔드가 중간에서 전달하면 CORS, 인증, 주소 관리가 단순해진다.

프론트가 의존할 필드:

```text
report_id
home_id
report_date
generated_at
source
content.overall_status
content.title
content.summary
content.highlights
content.timeline
content.recommendations
```

필드명 변경은 프론트 담당자와 합의하고 API 버전을 올린다.

---

## 22. Git 공유

`daily_report` 폴더에서:

```bash
git init
git branch -M main
git add .
git status
```

`git status`에 `.env`와 `data/output/*.json`이 없어야 한다.

```bash
git commit -m "feat: initialize daily report service"
git remote add origin 팀_daily_report_저장소_URL
git push -u origin main
```

처음 받는 사람:

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project
git clone 팀_daily_report_저장소_URL daily_report
```

결과:

```text
wifi-care-project/
├── back/
├── frontend/
├── data/
└── daily_report/
```

업데이트:

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/daily_report
git pull origin main
```

`daily_report`는 독립 저장소이므로 그 저장소에서 기존 `back`이나 `frontend`를 수정하지 않는다.

---

## 23. 팀원 작업 순서

1. 폴더·가상환경·의존성 생성
2. `.gitignore`, `.env.example` 작성
3. 일일지표 CSV를 `data/input/`에 배치
4. CSV 검증·필터링·정렬 구현
5. `inspect_csv.py` 성공 확인
6. Pydantic 출력 모델과 예시 JSON 확정
7. 프롬프트 작성
8. 개인 `.env`에 API 키 입력
9. Responses API + Structured Outputs 구현
10. CLI로 JSON 생성
11. FastAPI 생성·조회 API 구현
12. 단위 테스트와 실제 API 테스트
13. README 작성
14. 비밀키 제외 확인 후 Git push
15. 다른 컴퓨터에서 README만 보고 재실행

---

## 24. 완료 기준

- [ ] 새 컴퓨터에서 저장소를 clone할 수 있다.
- [ ] `.env.example`을 보고 환경 설정을 만들 수 있다.
- [ ] 실제 `.env`는 Git에 없다.
- [ ] 일일지표 CSV 한 파일만으로 실행된다.
- [ ] 필수 열 누락 시 명확한 오류가 나온다.
- [ ] `home_id`와 날짜를 지정할 수 있다.
- [ ] CSV가 검증된 JSON으로 변환된 뒤 모델에 전달된다.
- [ ] OpenAI 결과가 고정 JSON 스키마를 따른다.
- [ ] 주요 결과에 유효한 `evidence_refs`가 있다.
- [ ] 결과가 `data/output/`에 저장된다.
- [ ] CLI와 REST API 양쪽에서 생성할 수 있다.
- [ ] 저장 결과를 조회 API로 받을 수 있다.
- [ ] 프론트 담당자가 예시 JSON으로 화면을 만들 수 있다.
- [ ] 기본 테스트는 OpenAI 비용 없이 통과한다.

---

## 25. 핵심 주의사항

1. LLM을 계산 엔진으로 쓰지 않는다. 필터링·정렬·타입 변환은 Python이 한다.
2. CSV에 없는 사실을 추론하지 않는다. 예를 들어 전력 지표만으로 문 열림 횟수를 만들면 안 된다.
3. `synthetic`, `estimated`를 실제 관측처럼 표현하지 않는다.
4. 프론트 작업 전에 출력 필드명을 먼저 확정한다.
5. API 키는 서버 `.env`에만 두고 브라우저에 전달하지 않는다.
6. 모델명은 환경 변수로 관리한다.
7. 외부 API 오류 원문과 비밀 정보를 사용자 응답에 그대로 노출하지 않는다.
8. 먼저 한 가정·하루 생성을 완성한 뒤 여러 날짜 일괄 생성을 추가한다.

---

## 26. 팀원이 최종 전달할 항목

```text
1. daily_report Git 저장소 URL
2. 전체 소스 코드
3. README 실행 방법
4. .env.example
5. 입력 CSV 규격
6. 프론트용 예시 JSON 1개
7. API 명세
8. 테스트 결과
9. 사용 모델명과 프롬프트 버전
10. 남은 문제와 개선 항목
```

이 구조는 일일지표 샘플 CSV 한 파일만으로 독립 개발과 테스트가 가능하며, 이후 메인 프로젝트의 기존 백엔드가 `daily_report` API를 호출하는 방식으로 통합할 수 있다.
