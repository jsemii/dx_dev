# ThinQ 늘봄 음성 백엔드

`back/voice/`는 Java 21·Spring Boot로 실행하는 독립 프로젝트입니다. 기존
`service/dxproject_02_voice_test/backend`의 음성 API를 바탕으로 구성했으며,
테스트용 프론트엔드나 그 저장소를 실행할 필요는 없습니다. 기본 주소는
`http://127.0.0.1:8081`입니다. 기존 가전 API(8000)와 포트가 다릅니다.
로컬 실행 프로세스를 늘리지 않기 위해 선호 콘텐츠 저장·조회 API도 같은
서버의 `content/` 패키지에서 제공합니다. 콘텐츠 DB와 요청 형식은
`back/content/README.md`를 참고하세요.

## 실행

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/back/voice
./gradlew bootRun
```

키는 `secrets/application-local.properties`의 `elevenlabs.api-key` 또는 서버의
`ELEVENLABS_API_KEY` 환경변수에서 읽습니다. 기존 로컬 설정 파일을 새 위치에
복사해 두었고 `secrets/`는 Git에서 제외합니다. DB 접속 정보는 기존
`back/.env.local`을 로컬에서 읽습니다. 키와 비밀번호를 프론트 코드, URL,
로그, Git에 넣지 마세요. 설정이 없으면 실제 음성 등록·생성은 실패합니다.

외부 API 호출 없이 상태만 확인하려면:

```bash
curl http://127.0.0.1:8081/api/health
curl http://127.0.0.1:8081/api/config/elevenlabs
```

설정 API는 키 자체가 아니라 `{"configured":true}` 또는 `false`만 반환합니다.

## ThinQ 로컬 연결 경로

`back/local_frontend`의 Vite(5175)가 `/api/voice`와 `/api/tts` 요청을
이 서버(8081)로, 나머지 `/api` 요청은 가전 서버(8000)로 전달합니다.
팀원 프론트 파일은 수정하지 않았고, 음성 화면만 로컬 브리지의
`LocalVoiceTrainingPage.jsx`로 교체합니다. 기존 가전 서버(8000)도 별도 실행해야
제품 사용 현황이 동작합니다.

| 호출 | 요청 | 응답 |
| --- | --- | --- |
| `POST /api/voice/clone` | `multipart/form-data`의 `file`, `home_id`, `name` | DB에 저장된 `voiceId`, `name`, `requiresVerification`, `createdAt` |
| `GET /api/voice/registered?home_id=...` | 가정 ID | DB에 저장된 목소리 목록 |
| `PATCH /api/voice/registered/{voiceId}` | JSON의 `homeId`, `name` | 바뀐 표시 이름 |
| `POST /api/tts` | JSON의 `voiceId`, `text` | `audio/mpeg` 바이너리 |

등록은 ElevenLabs에 실제 녹음을 전송하는 유료 API 호출입니다. 사용자의
음성 제공 동의를 확인한 뒤, 화면의 **녹음 확인 → 녹음 사용하기** 단계에서만
요청합니다. 빈 녹음은 400, 키 누락은 503, 외부 API 실패는 502입니다.
`requiresVerification`이 true인 경우 즉시 사용 가능한 등록으로 취급하면
안 됩니다.

음성 메타데이터 테이블은 `db/create_voice_profiles.sql`로 생성합니다.
`public.voice_data`에는 가정 ID, ElevenLabs가 반환한 voice ID,
표시 이름, 추가 인증 필요 여부와 등록 시각만 저장합니다. **녹음 원본과
ElevenLabs 키는 DB에 저장하지 않습니다.** 새 시연 DB에서 처음 실행한다면
이 SQL을 먼저 적용해야 합니다. 현재 연결된 campus DB에는 이미 적용했습니다.
외부 등록은 성공했지만 직후 DB 저장이 실패하면 외부 서비스에 미등록 목록
없는 목소리가 남을 수 있으므로, 오류 시 무작정 다시 등록하기 전에 상태를
확인해야 합니다.

ThinQ 화면에서는 동의 → 실제 마이크 녹음(최대 60초) → 녹음본 재생 →
ElevenLabs 등록과 DB 저장 → 이름 지정·미리듣기 순으로 동작합니다.
팀원이 음성 화면의 import나 디자인을 바꾸면 로컬 별도 화면과의 동기화가
필요합니다. 마이크 접근은 브라우저에서 직접 허용해야 하며, 타인의 목소리는
당사자의 동의 없이 등록하지 마세요. 이 로컬 데모에는 사용자 인증·권한
관리·클론 정리 기능이 없어 운영 서비스로 그대로 배포하면 안 됩니다.

## 검사

```bash
cd /Users/jangsemi/dx_dev/wifi-care-project/back/voice
./gradlew test
```

테스트는 외부 음성 서비스로 실제 요청을 보내거나 비용을 발생시키지 않습니다.

## Player 알림 음성 실행

스케줄러는 `Asia/Seoul` 기준으로 활성화된 식사·복약 알림을 짧은 유예시간
안에서 조회하고, 생활자가 소유한 목소리 중 인증이 끝난 가장 최근 목소리로
고정 문구(`MEAL`: `엄마~~ 밥 먹어요~~`, `MEDICATION`: `엄마~~ 약 먹어요~~`)를 생성합니다.
브라우저 요청에서는 문구나 공급자 voice ID를 받지 않습니다. 생성된 MP3는
공유 내부 토큰으로 인증한 Anger API를 거쳐 현재 활성 `/player` 소켓으로만
전달됩니다.

1차 음성이 Player에서 `COMPLETED`로 확인되면 같은 돌봄 사건에 2차 전달을
예약합니다. 2차 전달은 1차 재생 시작 시각에서 `ALARM_ESCALATION_SECONDS`
(기본 90초) 뒤에 실행하며, 1차에서 사용한 같은 voice ID와 같은 문구를
사용합니다. 2차도 `COMPLETED`일 때만 `care_event`를 `EMERGENCY`로 전환하고
1·2차 실제 재생 이력을 `reporting_data`에 남깁니다. 3차 전달은 만들지 않습니다.

처음 배포할 때 `db/create_alarm_delivery.sql`을 한 번 적용해야 합니다. 이
migration은 `(alarm_id, scheduled_for)` 중복 실행 방지 이력과 실제 `PLAYING`
확인 후 생성되는 `care_event`의 연결 키를 추가합니다. 1·2차 대응 이력은 기존
`reporting_data.evidence`의 `care_event_id`로 연결하므로 reporting 스키마 변경은
필요하지 않습니다.

필요한 환경변수 이름은 다음과 같습니다. Voice와 Anger에는 동일한
`PLAYBACK_INTERNAL_TOKEN`(32자 이상)을 설정하고, Anger replica는 메모리 기반
활성 Player 상태를 공유하지 않으므로 1개로 유지합니다.

```text
ALARM_DELIVERY_ENABLED=false
ALARM_SCAN_INTERVAL_MS=5000
ALARM_DELIVERY_GRACE_MS=120000
ALARM_ESCALATION_SECONDS=90
ALARM_AUDIO_MAX_BYTES=1048576
ALARM_PLAYBACK_TIMEOUT_MS=150000
ANGER_INTERNAL_BASE_URL=http://nulbom-anger:3001
PLAYBACK_INTERNAL_TOKEN=
PLAYBACK_AUDIO_COMPLETION_TIMEOUT_MS=120000
```

기본값에서는 스케줄러가 비활성화됩니다. migration과 내부 연결, 토큰을 먼저
확인한 뒤 `ALARM_DELIVERY_ENABLED=true`로 전환해야 합니다. 토큰이나 공급자
응답 본문, voice ID는 로그에 기록하지 않습니다.
