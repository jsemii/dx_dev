# Daily Report

`public.reporting_data`의 사건·지표로 timeline과 highlights를 규칙 기반으로
계산하고, OpenAI는 서버가 확정한 사실의 summary 표현에만 사용합니다.
저장·조회 대상은 `public.daily_report`이며 로컬 JSON 캐시를 런타임
원본으로 사용하지 않습니다.

## 설치

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/daily_report
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

`.env.example`을 참고하여 DB 접속 정보와 `OPENAI_API_KEY`를 로컬/배포
환경에만 설정합니다. `.env`는 Git에 포함하지 않습니다.

## DB 읽기 전용 확인

```bash
python -m scripts.inspect_db \
  --profile one_person \
  --home-id home_23 \
  --date 2026-09-23
```

## 일반 조회·최초 생성

일반 GET은 DB 조회만 수행합니다. 생성 API는 기존 리포트가 없을 때만
생활자·날짜 advisory lock을 획득하고 summary를 한 번 생성한 뒤 INSERT합니다.
오늘과 미래 날짜는 서울 시간 기준으로 거부합니다.

## 기존 리포트 일회성 정정

다음 명령은 일반 생성 경로가 아니며, 기존 UUID와 `report_share`를
유지하면서 명시된 범위를 UPDATE하는 일회성 마이그레이션입니다.

```bash
python -m scripts.generate_report \
  --profile one_person \
  --home-id home_23 \
  --start-date 2026-09-23 \
  --end-date 2026-09-30 \
  --apply-migration
```

정정된 baseline에는
`valid_day_policy=ALL_30_METRIC_ROWS_PRESENT`가 저장됩니다. 이 표식이
이미 있는 범위는 재실행을 중단합니다. 전역 유효일은 승인된 생활 metric
30종이 각각 정확히 한 행씩 있는 날이며, 값이 NULL이어도 유효일입니다.
각 metric 내부의 `valid_day_count`와 평균은 비NULL 값만 사용합니다.

## REST API

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8002
```

- `GET /health`
- `GET /api/v1/reports/{home_id}/{report_date}`
- `POST /api/v1/reports/generate`

생성/조회 요청은 DB의 `daily_report`를 사용합니다. 기존 리포트가 있으면
`force` 값과 관계없이 기존 DB 결과를 반환하며 OpenAI를 호출하지 않습니다.

```json
{
  "profile": "one_person",
  "home_id": "home_23",
  "report_date": "2026-09-23",
  "model": "gpt-5-mini",
  "force": false
}
```

## 테스트

```bash
pytest -q
```

테스트는 OpenAI를 mock하며 실제 DB를 쓰지 않습니다.
