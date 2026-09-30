# ThinQ 늘봄 시연 온보딩 통합 안내

이 폴더 전체를 대상 React/Vite 프로젝트의 `src/onboarding/`으로 복사합니다. 기존 `frontend`, `frontend-guardian` 앱과 다른 화면 파일은 복사하거나 수정할 필요가 없습니다.

## 복사 파일

- `index.js`: 외부 공개 exports
- `CaregiverOnboarding.jsx`: 보호자 흐름, 입력 검증, 완료 callback
- `CaregiverSteps.jsx`: IntroductionStep, PersonStep, AgreementsStep, RequestStep, ConsentCompleteStep, DevicesStep, PatternsStep, SetupCompleteStep
- `ResidentConsentOnboarding.jsx`: 생활자 흐름 및 완료 callback
- `ResidentSteps.jsx`: ResidentIdentityStep, ResidentAgreementsStep, ResidentCompleteStep, IdentityCard
- `shared.jsx`: Notice, Check, DeviceTile 공통 UI
- `useDemoStep.js`: 선택적 브라우저 단계 뒤로가기 지원
- `OnboardingRoute.jsx`: 라우터 독립 wrapper, 경로 상수, 새 시연 버튼
- `data.js`: 초기 생활패턴, 동의 항목, 생활자·보호자 mock 정보
- `assets.js`: Vite 상대경로 asset import
- `caregiver.css`, `resident.css`, `layout.css`: 기존 디자인과 반응형·터치·safe-area 보완
- `assets/caregiver/`: add.svg, back.svg, calendar.svg, checkbox-all.svg, checkbox.svg, devices.png, edit.svg, hub.png, intro.png, notice.svg, send.svg, sent.png, splash.png, success.png, tv.png
- `assets/resident/`: back.svg, checkbox.svg, complete.png
- `README.md`: 이 안내

폰트 파일과 외부 폰트 요청은 없습니다. 기존 시스템 폰트 스택(-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Noto Sans KR, sans-serif)을 유지합니다. `Noto Sans KR`은 설치되어 있을 때만 사용합니다.

## dependency

런타임은 `react`, `react-dom`만 필요합니다. Vite 프로젝트에서 별도 UI/라우터/날짜 라이브러리 설치는 필요하지 않습니다. 현재 로컬 검증 버전: React/React DOM 19.3.0, Vite 8.3.0. 기존 프로젝트의 정상 동작하는 React/Vite 버전을 무조건 변경할 필요는 없습니다. `import.meta.glob`은 Vite 기능입니다.

## 컴포넌트 props

```jsx
import { CaregiverOnboarding, ResidentConsentOnboarding } from './onboarding';

<CaregiverOnboarding
  onComplete={result => { setDemoSettings(result); navigate('/'); }}
  onCancel={() => navigate('/')}
/>

<ResidentConsentOnboarding
  onComplete={result => { setResidentDemoResult(result); }}
  onCancel={() => navigate('/')}
/>
```

`onComplete`, `onCancel`은 선택적 함수입니다. 생활자는 `설정 마치기`를 누르면 완료 callback을 호출하고 **동의 완료 화면에 머뭅니다**. 생활자 callback에서 navigate하지 마세요. 보호자는 생활패턴 검증 → 설정 완료 화면 → `ThinQ 늘봄 시작하기` 클릭 시 완료 callback을 호출합니다. callback에서 대상 프로젝트의 기존 늘봄 메인으로 이동합니다. 첫 단계 이전 버튼은 onCancel, 이후 이전 버튼은 이전 단계로 이동합니다.

추가 선택 prop `manageHistory`(기본 false)는 브라우저 뒤로가기를 단계 이동에 연결합니다. wrapper는 이를 켭니다. 자체 라우터와 단계 이력을 관리하는 경우 컴포넌트를 직접 사용하고 기본값을 유지하세요. 이력에는 단계 번호만 들어가고 개인정보와 동의는 들어가지 않습니다.

보호자 결과:
```js
{
  demoOnly: true,
  person: { name: '김순자', birth: '1947-04-29', phone: '01012345678' },
  agreements: [true, true, true],
  consentStatus: 'demo-complete',
  patterns: [
    { id: 'wake', label: '기상 시간', time: '07:30', mode: 'time' },
    // sleep, breakfast, lunch, dinner: mode는 'time' 또는 'irregular'
  ]
}
```

생활자 결과:
```js
{
  demoOnly: true,
  person: { name: '김순자', birth: '1949. 04. 12.', phone: '010-1234-5678' },
  agreements: { personal: true, devices: true, activity: true, guardian: true, sharing: false },
  consentStatus: 'demo-complete'
}
```

`sharing`은 선택 항목으로, 선택하지 않았다면 결과 객체에서 생략될 수도 있습니다. `mode: 'irregular'`이면 time 값은 이전 편집값일 뿐 적용 시간으로 사용하지 않습니다. 각 시간 항목은 시간 선택 후 확인하거나 `일정하지 않아요.`를 선택해야 진행됩니다. 완료 callback은 마지막 버튼 중복 클릭으로 반복 실행되지 않습니다. 완료 화면에서 이전 단계로 돌아가 다시 완료하면 갱신된 시연 결과를 전달할 수 있습니다.

## 권장 경로

- `/onboarding/caregiver`: 보호자
- `/onboarding/resident`: 생활자
- `/`: 기존 늘봄 메인

React Router가 이미 있는 팀 프로젝트의 예시(이 패키지 자체는 react-router-dom에 의존하지 않음):

```jsx
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { OnboardingRoute } from './onboarding';

function OnboardingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  return <OnboardingRoute
    pathname={location.pathname}
    navigate={navigate}
    onComplete={(result, flow) => {
      // React state에만 보관. API나 DB 호출을 추가하지 않습니다.
      console.info('demo completion', flow, result.demoOnly);
    }}
    onCancel={flow => { /* 선택적 로컬 시연 정리 */ }}
  />;
}

<Routes>
  <Route path="/onboarding/caregiver" element={<OnboardingPage />} />
  <Route path="/onboarding/resident" element={<OnboardingPage />} />
  <Route path="/" element={<ExistingNeulbomMain />} />
</Routes>
```

wrapper는 보호자 완료·취소 시 navigate('/')를 호출합니다. 생활자 완료 시 경로를 유지합니다. `/`가 메뉴이고 늘봄 메인이 내부 상태 화면인 현재 로컬 앱은 완료 callback에서 화면 상태를 'neulbom'으로 설정합니다. 대상 프로젝트에서는 실제 메인 route에 맞추어 navigate를 연결하세요. 마이페이지와 고객 지원의 기존 디자인 버튼에 각각 위 경로로 이동하는 핸들러만 연결하면 됩니다.

SPA 호스팅에서는 두 직접 경로를 `index.html`로 fallback하도록 대상 서버를 설정해야 합니다. 로컬 Vite는 이를 지원합니다. 이 작업에서는 배포하지 않았습니다.

## 상태·초기화·시연 범위

두 흐름은 각각 React state만 사용합니다. DB, API, localStorage, sessionStorage, BroadcastChannel, polling, 다른 기기 동기화는 없습니다. 보호자가 보는 동의 완료는 **발표자의 다음 단계 클릭으로 전환하는 시연 상태**입니다. 생활자의 실제 동의 상태를 조회하거나 기다리지 않습니다.

- wrapper의 `새 시연 시작`: 현재 흐름 remount로 전체 입력·동의·진행 상태 삭제
- wrapper `resetKey` 변경: 프로그램에서 초기화 (`setRun(v => v + 1)` 후 `resetKey={run}`)
- 직접 컴포넌트: React `key` 변경으로 초기화
- 새로고침/새 URL 문서 로드: 항상 첫 단계부터 시작(진행 복원 없음)
- `?reset=1`로 문서를 새로 열어도 초기화됨. 쿼리 자체를 감시하지 않으므로 SPA 내부에서 쿼리만 바꿀 때는 resetKey를 함께 변경
- 부모가 완료 결과를 state에 별도로 보관했다면 새 시연 시작 시 그 부모 state도 초기화

기존 디자인의 “동의 요청 완료”, “동의 완료”, “설정 완료”, 알림톡·24시간 링크·30일 업데이트 안내는 디자인 문구입니다. 실제 전송/동의 저장/가전 조회/생활패턴 저장/업데이트는 수행하지 않습니다. 재전송 버튼은 로컬 안내 문구만 표시합니다. 가전은 mock입니다. 약관 전문은 기존처럼 미등록 안내이며 실제 법적 동의 화면이 아닙니다. `public.alarm`, `life_pattern` 등 테이블 접근도 없습니다.

## 레이아웃·assets

이미지는 `assets.js`의 상대 glob import로 빌드에 포함됩니다. 별도 public 폴더, 절대 PC 경로, 개발 포트, 외부 이미지 URL이 필요하지 않습니다. CSS는 전용 클래스 이름을 사용하며 html/body/#root 전역 리셋을 포함하지 않습니다. 대상 앱의 강한 전역 CSS가 버튼/입력을 덮어쓰는지 통합 시 확인하세요.

index.html에 다음 viewport를 유지하세요:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

온보딩은 전체 화면 높이(100dvh), 최대 콘텐츠 폭 768px이며 하단 버튼은 별도 flex footer로 유지합니다. 내용만 세로 스크롤되고 safe-area를 반영합니다. 네이티브 date/time 입력을 사용합니다. 기존 앱의 고정 393px 확대·축소 프레임 안에 넣지 말고 route 최상위에 배치하세요.

## 통합 시 수정하는 부분

1. 메뉴의 마이페이지/고객 지원 클릭 핸들러와 route 등록
2. 보호자 완료·취소 시 기존 메인 이동, 선택적인 부모 React state 저장
3. data.js의 시연용 생활자·보호자 fixture (두 기기 값은 자동 공유되지 않음)
4. viewport와 SPA fallback, 호스트 CSS 충돌 점검

원본 `frontend/`, `frontend-guardian/`는 수정하지 않았습니다. 로컬 연결 변경은 `frontend-onboarding`에만 적용했습니다.
