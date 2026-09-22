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
