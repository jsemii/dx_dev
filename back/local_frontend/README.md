# 로컬 전용 ThinQ 늘봄 ↔ 가전 API 연결

별도 Git 저장소인 `frontend`의 원본 파일을 수정하지 않고,
팀원 `frontend/src/main.jsx` → `App.jsx` → `NeulbomPage.jsx` 화면을 그대로 실행합니다.
로컬 Vite alias가 `App.jsx`의 `NeulbomPage` import만 이 폴더의 래퍼로 연결하고,
원본 카드에 `applianceUsage` prop을 전달합니다. 화면의 기존 펼치기 버튼이 API
사건을 표시합니다. `/api` 요청은 Vite가 로컬 백엔드 `127.0.0.1:8000`으로
프록시하므로 브라우저에는 DB 접속 정보가 없습니다.
음성 API 경로 `/api/voice`와 `/api/tts`만 별도 음성 서버
`127.0.0.1:8081`로 전달합니다. 팀원 음성 화면 파일은 그대로 두고,
로컬에서 `LocalVoiceTrainingPage.jsx`를 대신 사용해 마이크·재생·업로드와
DB 등록 목록을 연결합니다. 음성 서버 실행과 개인정보 유의점은
`back/voice/README.md`를 참고하세요.

선호 콘텐츠도 팀원 화면을 수정하지 않습니다. `LocalPreferredContentPage.jsx`가
DB 목록을 읽은 뒤 팀원 화면에 전달하고, 저장 버튼에서 이미지/유튜브 API를
호출합니다. `/api/content`는 같은 Java 서버 `127.0.0.1:8081`로 전달합니다.
처음 표시되던 3건은 팀원의 고정 샘플이므로 로컬 연결 화면에서는 쓰지 않습니다.
늘봄 카드의 고정 `3개의 콘텐츠 등록 완료`도 로컬에서는 `콘텐츠 등록 관리`로
바꿉니다. 콘텐츠 API가 실패하면 샘플로 대체하지 않고 오류를 표시합니다.

데일리 리포트의 날짜를 변경하면 같은 날짜로 가전 API를 다시 조회합니다.
가전 화면에는 `home_23`의 정수기·냉장고·TV만 표시합니다.

## 실행 (터미널 네 개)

터미널 1: 기존 백엔드. `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`,
`PGPASSWORD`를 서버 환경변수로 설정하고, `psql`이 PATH에 없으면
`PSQL_BIN`도 설정하세요. 비밀번호 값은 파일이나 명령 인수에 저장하지 마세요.

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project
set -a
source back/.env.local
set +a
.venv/bin/python -m back.api.appliance_api
```

터미널 2: 데일리 리포트 백엔드. PostgreSQL 날짜별 조회와 OpenAI 리포트 생성을
담당합니다. 같은 날짜의 저장된 JSON이 있으면 다시 생성하지 않고 재사용합니다.

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/daily_report
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8002
```

터미널 3: 목소리 백엔드. 기존 `back/.env.local`의 DB 설정과
`back/voice/secrets/application-local.properties`의 ElevenLabs 설정을 사용합니다.
이 서버가 선호 콘텐츠 API도 함께 제공합니다. 새 콘텐츠 서버나 터미널은
필요하지 않습니다. `back/content/db/create_preferred_content.sql`의 두 테이블이
먼저 생성돼 있어야 합니다.

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/back/voice
./gradlew bootRun
```

터미널 4: 로컬 전용 프런트. 최초 한 번만 **이 폴더에서** `npm ci`를 실행합니다.
팀원 `frontend/`에서는 설치하지 않습니다.

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/back/local_frontend
npm ci
npm run dev
```

`http://127.0.0.1:5175/`에서 팀원 화면의 **ThinQ 늘봄** 버튼을 눌러
「제품 사용 현황」을 봅니다. 기본 조회는 `home_23`, `2026-09-17`입니다.
단일 가정의 시연용 기록을 자동 조회하며, 데일리 리포트에서 날짜를 이동하면
돌봄 관리의 가전 기록도 같은 날짜로 변경됩니다.
`npm test`는 브리지 데이터 변환만 검증합니다.

정수기 출수량·냉장고 문 사건은 합성 샘플이고 TV 사용 시간은 원자료 기반
추정입니다. 출수량은 실제 마신 양이 아니고, 문 열림은 실측 도어 센서
기록이 아닙니다. 이 출처 정보는 API 데이터와 문서에 유지하지만 카드의
매 사건 옆에는 표시하지 않습니다. 세 제품의 현재 작동 상태도 확인하지
않으므로 `정상 작동 중`이라고 주장하지 않습니다. 원본의 ThinQ ON은
API 대상이 아니고, 안내등 등 카드에 대응 DB 기록이 없으면 `데이터 없음`으로
표시합니다. 발표·산출물에서는 시연용 기록의 출처를 반드시 밝히세요.

## 팀원 코드 갱신 후

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/frontend
git pull origin main
git status --short
```

로컬 Vite 서버를 재시작하고 메뉴 → 늘봄 → 제품 사용 현황 → 카드 펼치기를
확인하세요. 선호 콘텐츠에서는 이미지/유튜브 등록 후 새로고침해 DB 목록에
남는지도 확인하세요. `App.jsx`의 `NeulbomPage` import가 바뀌었다면 브리지는 오류를
내며, 이 폴더의 alias만 새 구조에 맞게 조정하면 됩니다. 팀원 파일은 수정하지
않습니다. Git 상태 출력은 비어 있어야 합니다.
