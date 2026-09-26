// Voice, content and alarm settings use the selected representative household.
export const DEFAULT_HOME_ID = 'home_23';
// Augmented appliance/reporting data uses the selected representative household.
export const REPORT_HOME_ID = 'home_23';
export const DEFAULT_DATE = '2026-09-23';
export const SUPPORTED_APPLIANCE_IDS = Object.freeze(['purifier', 'refrigerator', 'tv']);

export function selectSupportedCards(cards) {
  return cards.filter((card) => SUPPORTED_APPLIANCE_IDS.includes(card.id));
}

export function formatEventTime(isoTime) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(isoTime || '');
  if (!parts) return String(isoTime || '시각 미상');
  return `${Number(parts[2])}월 ${Number(parts[3])}일 ${Number(parts[4])}시 ${Number(parts[5])}분 ${Number(parts[6])}초`;
}

export function formatApplianceValue(value, applianceId) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '—';
  if (applianceId === 'refrigerator') return numericValue.toFixed(0);
  const rounded = Math.round((numericValue + Number.EPSILON) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function mapApplianceData(response, originalCards) {
  const rawProducts = response?.products ?? response?.appliances;
  const products = Array.isArray(rawProducts) ? rawProducts
    : rawProducts && typeof rawProducts === 'object' ? Object.values(rawProducts) : null;
  if (!Array.isArray(products)) throw new Error('API 응답 형식이 올바르지 않습니다.');
  const byId = new Map(products.map((device) => [device.id, device]));
  return originalCards.map((card) => {
    const device = byId.get(card.id);
    if (!device) return emptyCard(card, '사용 기록 없음', '0');
    if (!Array.isArray(device.events)) throw new Error('API 사건 형식이 올바르지 않습니다.');
    if (!device.has_data) return emptyCard(card, '사용 기록 없음', '0');
    const events = card.id === 'purifier'
      ? device.events.filter((event) => event.action === '출수 종료')
      : device.events;
    const history = events.map((event) => {
      const label = event.appliance === 'TV' ? `전원 ${event.action}`
        : card.id === 'refrigerator' ? event.action.replace(/^문 /, '') : event.action;
      const volume = Number(event.volume_ml);
      const amount = event.action === '출수 종료' && event.volume_ml != null && Number.isFinite(volume)
        ? ` ${volume}mL` : '';
      return { at: formatEventTime(event.event_time), value: card.id === 'purifier' && amount ? amount.trim() : `${label}${amount}` };
    });
    const unavailableTv = card.id === 'tv' && device.calculation_status === 'UNAVAILABLE';
    return {
      ...card,
      value: unavailableTv ? '시청 시간 계산 불가' : formatApplianceValue(device.value, card.id),
      unit: unavailableTv ? '' : device.unit,
      status: '사용 기록 확인',
      history: history.length ? history : [{ at: '', value: '사용 기록이 없어요.' }],
    };
  });
}

function emptyCard(card, message, value = '—') {
  const historyMessage = message === '사용 기록 없음' ? '사용 기록이 없어요.' : message;
  return { ...card, value, status: message, history: [{ at: '', value: historyMessage }] };
}

export function pendingCards(originalCards, message) {
  return originalCards.map((card) => emptyCard(card, message));
}

const CARE_STATUS = Object.freeze({
  COMPLETED: '돌봄 완료',
  ATTENTION: '확인 필요',
  EMPTY: '돌봄 기록 없음',
});

export function mapCareDashboard(response, originalCards) {
  if (!response || typeof response !== 'object') throw new Error('돌봄 응답 형식이 올바르지 않습니다.');
  if (!response.care_overview || !Array.isArray(response.recent_care)) {
    throw new Error('돌봄 응답 형식이 올바르지 않습니다.');
  }
  const message = response.care_overview.message;
  if (!Array.isArray(message) || message.some((line) => typeof line !== 'string')) {
    throw new Error('돌봄 상태 문구 형식이 올바르지 않습니다.');
  }
  const recentCare = response.recent_care.length ? response.recent_care.map((item) => ({
    id: String(item.id),
    title: String(item.title),
    detail: String(item.detail),
    time: String(item.time),
  })) : [{
    id: 'empty-care',
    title: '완료된 돌봄 기록이 없어요.',
    detail: '',
    time: '',
  }];
  return {
    cards: mapApplianceData(response, originalCards),
    overview: {
      status: CARE_STATUS[response.care_overview.status] || '돌봄 기록 확인',
      message,
      lastAppliance: response.latest_appliance?.name || '사용 기록 없음',
    },
    recentCare,
  };
}

export function dashboardPlaceholder(originalCards, kind) {
  const loading = kind === 'loading';
  const message = loading ? '조회 중' : '조회 실패';
  return {
    cards: pendingCards(originalCards, message),
    overview: {
      status: message,
      message: [loading ? '돌봄 기록을 불러오고 있어요.' : '돌봄 기록을 불러오지 못했어요.'],
      lastAppliance: message,
    },
    recentCare: [{
      id: `${kind}-care`,
      title: loading ? '돌봄 기록을 불러오고 있어요.' : '돌봄 기록 조회에 실패했어요.',
      detail: '',
      time: '',
    }],
  };
}
