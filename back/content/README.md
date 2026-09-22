# ThinQ 선호 콘텐츠 로컬 DB 연결

기존 PostgreSQL `campus_lgdx_1`의 `public` 스키마에
`db/create_preferred_content.sql`의 `public.image_data`와
`public.youtube_data` 테이블을 만듭니다.
이미지 원본은 최대 5MB의 JPEG/PNG/WebP로 DB에 저장합니다. 유튜브 영상은
다운로드하지 않고 정규화된 링크와 영상 ID만 저장합니다. 가족 사진과 같은
개인 이미지는 공유 시연 DB에 등록하지 마세요.

API 구현은 기존 Java 서버의
`back/voice/src/main/java/com/wificare/voice/content/`에 있습니다. 목소리
서버를 실행하면 콘텐츠 API도 같은 `127.0.0.1:8081`에서 열립니다. 이 API는
개발용으로 로컬 주소에만 바인딩되며 로그인/권한 제어가 없어 운영 환경에
그대로 공개하면 안 됩니다. DB 암호는 서버의 `back/.env.local`에서만 읽습니다.

| API | 기능 |
| --- | --- |
| `GET /api/content?home_id=demo_solo_house009` | 두 테이블의 통합 목록·개수 |
| `POST /api/content/images` | `multipart/form-data`: `home_id`, `name`, `file` |
| `POST /api/content/youtube` | JSON: `homeId`, `name`, `sourceUrl` |
| `GET /api/content/images/{id}?home_id=...` | DB에 저장한 이미지 표시 |

로컬 ThinQ(5175)는 `back/local_frontend`의 프록시를 통해 이 API를 호출합니다.
팀원 `frontend/`의 화면 코드는 수정하지 않습니다. 이미지/유튜브를 등록한 뒤
새로고침해도 목록에 남으면 DB 저장·조회가 모두 연결된 것입니다.
