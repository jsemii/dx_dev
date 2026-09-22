# Daily Report

PostgreSQL의 대표 가구 테이블에서 선택 날짜의 상세 사건과 일일 지표를 읽고,
OpenAI Responses API의 Structured Outputs로 한국어 데일리 리포트 JSON을 생성합니다.

사용자 화면은 JSON을 `오늘 하루 요약(summary)` →
`오늘의 생활 흐름(timeline)` → `평소와 다른 점(highlights)` 순으로
표시합니다. 소제목은 프론트에서 고정 문구로 사용합니다.

## 입력 테이블

| profile | PostgreSQL 테이블 |
|---|---|
| `one_person` | `public.reporting_data_one_person` |
| `two_to_three` | `public.reporting_data_two_to_three` |

현재 기본 profile은 `.env`의 `ACTIVE_REPORT_PROFILE=one_person`입니다.

## 설치

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/daily_report
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

`.env.example`을 참고해 `daily_report/.env`에 PostgreSQL 접속 정보와
`OPENAI_API_KEY`를 설정합니다. `.env`는 Git에 올리지 않습니다.

## DB 데이터 확인

OpenAI를 호출하지 않습니다.

```bash
python -m scripts.inspect_db --profile one_person --date 2026-09-17
```

## 리포트 생성

```bash
python -m scripts.generate_report --profile one_person --date 2026-09-17
```

모델을 이번 실행에서만 바꾸려면 `--model`을 사용합니다.

```bash
python -m scripts.generate_report \
  --profile one_person \
  --date 2026-09-17 \
  --model gpt-5.4 \
  --force \
  --no-save
```

모델 비교 중에는 `--no-save`로 JSON을 터미널에만 출력합니다.
`--no-save`를 빼면 생성 결과가 다음과 같이 모델별 JSON로 저장됩니다.

```text
data/output/report_home_23_2026-09-17_gpt-5-mini.json
data/output/report_home_23_2026-09-17_gpt-5.4.json
```

`--force`가 없고 같은 가구·날짜·모델의 JSON이 있으면 OpenAI를 다시 호출하지
않고 기존 결과를 반환합니다.

## REST API

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8002
```

- `GET /health`
- `POST /api/v1/reports/generate`
- `GET /api/v1/reports/{home_id}/{report_date}?model=gpt-5-mini`
- Swagger UI: `http://127.0.0.1:8002/docs`

생성 요청 예시:

```json
{
  "profile": "one_person",
  "report_date": "2026-09-17",
  "model": "gpt-5-mini",
  "force": false
}
```

## 테스트

```bash
pytest -q
```

CSV 로더와 `data/input/`은 기존 샘플 회귀 테스트용으로만 유지합니다. 실제
리포트 생성 입력은 PostgreSQL입니다.
