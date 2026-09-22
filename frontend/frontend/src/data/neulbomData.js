export const careFeatures = [
  {
    id: 'daily-life',
    title: '일상 생활 돌봄',
    description: ['집 안에서 이동 방향을 잃거나,', '행동이 멈추면 조명과 음성을 통해 도와줘요.'],
    icon: 'care-daily.png',
    iconClass: 'daily',
  },
  {
    id: 'meal-medication',
    title: '식사 및 복약 돌봄',
    description: ['필요한 시간에 식사와 복약을 도와줘요.'],
    icon: 'care-meal.png',
    iconClass: 'meal',
  },
  {
    id: 'calm',
    title: '안정 돌봄',
    description: ['불안하거나 흥분한 상태가 감지되면,', '익숙한 음성과 콘텐츠로 안정을 도와줘요.'],
    icon: 'care-calm.png',
    iconClass: 'calm',
  },
];

// DB 연동 전 대시보드 상태와 최근 돌봄 기록 예시입니다.
export const careOverviewMock = {
  status: '돌봄 중',
  message: ['오늘도 평소처럼', '일상을 보내고 있어요'],
  lastAppliance: '냉장고',
};

export const recentCareMock = [
  { id: 'meal', title: '주방에서 식사를 안내했어요.', detail: '사용자가 냉장고 문을 열었어요.', time: '12:00' },
  { id: 'rest', title: '거실에서 휴식을 안내했어요.', detail: '사용자가 냉장고 문을 열었어요.', time: '11:00' },
  { id: 'water', title: '주방에서 물 마시기를 안내했어요.', detail: '사용자가 정수기를 사용했어요.', time: '09:20' },
];

// DB 연결 전 화면 확인용 데이터입니다. 이후 API 응답을 같은 형태로 전달하면 됩니다.
export const applianceUsageMock = [
  {
    id: 'purifier',
    name: '정수기',
    icon: 'purifier',
    status: '정상 작동 중',
    metricLabel: '이만큼 마셨어요.',
    value: '1.2',
    unit: 'L',
    history: [
      { at: '9월 17일 9시 32분 31초', value: '0.4L' },
      { at: '9월 17일 11시 9분 10초', value: '0.3L' },
      { at: '9월 17일 14시 49분 48초', value: '0.5L' },
    ],
  },
  {
    id: 'refrigerator',
    name: '냉장고',
    icon: 'refrigerator',
    status: '정상 작동 중',
    metricLabel: '이만큼 썼어요.',
    value: '2',
    unit: '번',
    history: [
      { at: '9월 17일 9시 32분 31초', value: '열림' },
      { at: '9월 17일 9시 34분 2초', value: '닫힘' },
      { at: '9월 17일 13시 41분 2초', value: '열림' },
      { at: '9월 17일 13시 45분 13초', value: '닫힘' },
    ],
  },
  {
    id: 'tv',
    name: 'TV',
    icon: 'tv',
    status: '정상 작동 중',
    metricLabel: '이만큼 봤어요.',
    value: '0.5',
    unit: '시간',
    history: [
      { at: '9월 17일 9시 23분 31초', value: '전원 켜짐' },
      { at: '9월 17일 9시 54분 48초', value: '전원 꺼짐' },
    ],
  },
  {
    id: 'bedroom-light',
    name: '침실 안내등',
    icon: 'light',
    status: '정상 작동 중',
    metricLabel: '이만큼 켜졌어요.',
    value: '2',
    unit: '회',
    history: [
      { at: '9월 17일 20시 12분 8초', value: '켜짐' },
      { at: '9월 17일 20시 20분 41초', value: '꺼짐' },
    ],
  },
  {
    id: 'bathroom-light',
    name: '화장실 안내등',
    icon: 'light',
    status: '정상 작동 중',
    metricLabel: '이만큼 켜졌어요.',
    value: '2',
    unit: '회',
    history: [
      { at: '9월 17일 22시 1분 4초', value: '켜짐' },
      { at: '9월 17일 22시 6분 27초', value: '꺼짐' },
    ],
  },
];

export const customCareSettings = [
  {
    id: 'voice',
    title: '맞춤 목소리',
    description: '2명의 목소리 등록 완료',
    icon: 'custom-voice.png',
  },
  {
    id: 'content',
    title: '선호 콘텐츠',
    description: '3개의 콘텐츠 등록 완료',
    icon: 'preferred-content.png',
  },
];
