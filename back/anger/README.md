# Anger API

안정 돌봄 설정, 10초 녹음의 OpenAI STT, 서버 측 분노 표현 판정,
생활자별 선호 YouTube 선택과 같은 도메인의 생활자 TV Player WebSocket 제어를 담당합니다.

## 실행

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/back/anger
npm install
cp .env.example .env
npm start
```

사용자가 `.env`에 다음 값을 직접 입력해야 합니다. 값을 출력하는 명령은 사용하지
않고 `.env`를 Git에 추가하지 않습니다.

- `OPENAI_API_KEY`
- `DATABASE_URL` 또는 `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `PGSSLMODE`
- `OPENAI_TIMEOUT_MS` (기본 30000ms)
- `PLAYBACK_TIMEOUT_MS` (`PLAYING` 확인 대기, 기본 5000ms)
- `PLAYBACK_COMMAND_TTL_MS` (재생 명령 유효 시간, 기본 15000ms)
- `PLAYER_PAIRING_CODE` (생활자 화면에서 최초 1회 입력할 8자 이상의 연결 코드)
- `PLAYER_SESSION_SECRET` (HttpOnly 세션 서명용 32자 이상의 임의 비밀값)
- `PLAYER_SESSION_TTL_SECONDS` (기본 86400초)
- `PLAYER_PAIRING_MAX_ATTEMPTS` (IP·생활자별 기본 5회)
- `PLAYER_PAIRING_WINDOW_MS` (시도 제한 기본 300000ms)
- `PLAYER_COOKIE_SECURE` (`auto`, 로컬 HTTP 테스트용 `false`, 배포 HTTPS는 `auto`)
- `PORT` (기본 3001)

상태 확인:

```bash
curl -sS http://127.0.0.1:3001/health
```

그 후 로컬 프론트를 실행하고 안정 돌봄 화면으로 이동합니다. 실제 ON 전환은
`safety_care`를 변경하고, 녹음 분석은 OpenAI를 호출하므로 시연 승인 후 수행합니다.

## API

- `GET /health`
- `GET /api/safety-care/settings?home_id=home_23`
- `PATCH /api/safety-care/settings`
- `POST /api/anger/analyze` (`home_id`, UUID `session_id`, `audio`)
- `GET /api/anger/playback-status` (Player 서버·브라우저 준비 상태와 제어 화면 URL)
- `POST /api/playback/pair` (연결 코드 확인 후 서명된 HttpOnly 세션 발급)
- `GET /api/playback/session?home_id=...`
- `GET /api/playback/status?home_id=...`
- `POST /api/playback/stop` (`home_id`, `STOPPED` 확인 후 `READY` 반환)
- `GET /ws/playback` WebSocket upgrade

분석 API는 OpenAI STT 호출 전과 감지 성공 후 재생 직전에 해당 생활자의 Player 준비 상태를 확인합니다.
준비된 브라우저가 없으면 `409 PLAYBACK_NOT_READY`, Player 서버에 연결할 수 없으면
재생 명령 후 `PLAYING` 확인이 오지 않으면 `503 PLAYBACK_ACK_TIMEOUT`을 반환합니다.
생활자별 활성 WebSocket은 하나만 유지하며 새 Player가 등록되면 이전 연결을 종료합니다.
영상 재생 중 감지 재개 요청은 `STOP → STOPPED → READY` 확인 후에만 마이크를 다시
시작합니다. 중지 확인이 없으면 `503 PLAYBACK_STOP_TIMEOUT`을 반환하고 BUSY를 해제합니다.

Player는 별도 3002 서버가 아니라 동일 프론트의 `/player`입니다. 배포에서는
`https://현재도메인/player`, WebSocket은 같은 origin의 `/ws/playback`을 사용합니다.
도메인을 코드에 하드코딩하지 않습니다. 연결 코드는 URL이나 WebSocket 메시지에 포함하지 않습니다.

오디오는 최대 20MiB이며 WebM, OGG, WAV, MP4 시그니처를 확인합니다. 메모리에서만
처리하므로 임시 파일과 영구 파일을 만들지 않습니다. 오디오와 transcript는 로그에
남기지 않습니다.

`session_id` 결과는 프로세스 메모리에 5분간 보관하여 동일 녹음의 중복 재생을
방지합니다. 프로세스 재시작이나 여러 인스턴스 간에는 공유되지 않는 데모용
멱등성 처리입니다.

## 테스트

```bash
npm test
```

테스트는 PostgreSQL, OpenAI, Player 서버를 mock하며 실제 DB 쓰기나 외부 호출을
수행하지 않습니다.
