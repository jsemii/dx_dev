export const agreementLabels = [
  '(필수) 개인정보 수집·이용 동의',
  '(필수) ThinQ 기기 및 생활 데이터 수집·분석 및 공유 동의',
  '(필수) 개인정보 제3자 제공 동의',
];
export const initialPatterns = [
  { id: 'wake', label: '기상 시간', time: '10:00', mode: null },
  { id: 'sleep', label: '취침 시간', time: '21:00', mode: null },
  { id: 'breakfast', label: '아침 식사 시간', time: '08:00', mode: null },
  { id: 'lunch', label: '점심 식사 시간', time: '12:30', mode: null },
  { id: 'dinner', label: '저녁 식사 시간', time: '18:00', mode: null },
];


// Demo fixtures only; no cross-device or persisted consent.
export const residentAgreements = [
  { id: 'personal', title: '(필수) 개인정보 수집·이용', description: '이름, 생년월일, 휴대전화번호 등으로 서비스 가입과 이용자를 확인해요.', required: true },
  { id: 'devices', title: '(필수) ThinQ 기기 정보 연동', description: '치매 생활자의 ThinQ 계정에 등록된 가전과 센서 정보를 연결해요.', required: true },
  { id: 'activity', title: '(필수) 생활행동 데이터 수집·이용', description: 'Wi-Fi 센싱과 가전 사용 기록으로 평소 생활 패턴과 현재 상태를 파악해요.', required: true },
  { id: 'guardian', title: '(필수) 보호자에게 돌봄 정보 제공', description: '데일리 리포트와 이상 상황, 긴급 알림 등을 보호자에게 제공해요.', required: true },
  { id: 'sharing', title: '(선택) 리포트 추가 공유', description: '보호자가 가족 등 다른 사람에게 리포트를 추가로 공유할 수 있어요.', required: false },
];


export const mockResident = { name: '김순자', birth: '1949. 04. 12.', phone: '010-1234-5678' };
export const mockCaregiver = { name: '박연주', phone: '010-1234-5678' };
