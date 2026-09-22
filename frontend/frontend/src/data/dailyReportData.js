// DB 연결 전 데일리 리포트 화면 확인용 데이터입니다.
export const dailyReportMock = {
  date: '2026년 9월 17일',
  summary:
    '오늘은 오전과 정오에 식사 후 설거지까지 생활이 이어졌어요. 오후에는 외출과 귀가가 확인됐고, 5시경에는 잠시 돌아왔다가 다시 외출한 기록이 있었어요. 저녁에는 거실에서 휴식했으며 TV는 오후에 약 2시간 22분 사용됐어요.',
  timeline: [
    { id: 'living-room', time: '07:10', description: '침실에서 거실로 이동했어요.' },
    { id: 'breakfast', time: '07:35', description: '아침 식사를 했어요.' },
    { id: 'tv', time: '09:20', description: '거실에서 TV를 시청했어요.' },
    { id: 'water', time: '10:40', description: '정수기를 사용해 물을 마셨어요.' },
    { id: 'lunch', time: '12:35', description: '점심 식사를 했어요.' },
    { id: 'dishes', time: '13:05', description: '식사 후 설거지를 했어요.' },
    { id: 'nap', time: '13:50', description: '거실에서 낮잠을 잤어요.' },
  ],
  changes: [
    {
      id: 'first-meal',
      title: '첫 식사 행동이 평소보다 1시간 늦게 기록됐어요.',
      average: '최근 한 달 평균 식사 시각: 08:28',
      current: '오늘 식사 시각: 09:28',
    },
    {
      id: 'tv-time',
      title: 'TV 사용시간이 평소보다 3시간 38분 짧았어요.',
      average: '최근 한 달 평균 시청 시간: 6시간',
      current: '오늘 시청 시간: 2시간 22분',
    },
    {
      id: 'outside-time',
      title: '오늘은 외출한 시간이 평소보다 길었어요.',
      average: '최근 한 달 평균 외출 시간: 2시간 50분',
      current: '오늘 외출 시간: 4시간 25분',
    },
    {
      id: 'water-intake',
      title: '정수기 출수량이 평소보다 0.3L 적었어요.',
      average: '최근 한 달 평균 출수량: 1.05L',
      current: '오늘 출수량: 0.75L',
    },
  ],
};
