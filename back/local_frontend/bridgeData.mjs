// Voice, content and alarm settings use the selected representative household.
export const DEFAULT_HOME_ID = 'home_23';
// Augmented appliance/reporting data uses the selected representative household.
export const REPORT_HOME_ID = 'home_23';
export const DEFAULT_DATE = '2026-09-17';
export const SUPPORTED_APPLIANCE_IDS = Object.freeze(['purifier', 'refrigerator', 'tv']);

export function selectSupportedCards(cards) {
  return cards.filter((card) => SUPPORTED_APPLIANCE_IDS.includes(card.id));
}

export function formatEventTime(isoTime) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(isoTime || '');
  if (!parts) return String(isoTime || '시각 미상');
  return `${Number(parts[2])}월 ${Number(parts[3])}일 ${Number(parts[4])}시 ${Number(parts[5])}분 ${Number(parts[6])}초`;
}

export function mapApplianceData(response, originalCards) {
  if (!Array.isArray(response?.appliances)) throw new Error('API 응답 형식이 올바르지 않습니다.');
  const byId = new Map(response.appliances.map((device) => [device.id, device]));
  return originalCards.map((card) => {
    const device = byId.get(card.id);
    if (!device || !device.has_data) return emptyCard(card, '데이터 없음');
    if (!Array.isArray(device.events)) throw new Error('API 사건 형식이 올바르지 않습니다.');
    const events = card.id === 'purifier'
      ? device.events.filter((event) => event.action === '출수 종료')
      : device.events;
    const history = events.map((event) => {
      const label = event.appliance === 'TV' ? `전원 ${event.action}`
        : card.id === 'refrigerator' ? event.action.replace(/^문 /, '') : event.action;
      const amount = event.action === '출수 종료' && event.volume_ml != null
        ? ` ${(Number(event.volume_ml) / 1000).toFixed(3).replace(/\.?0+$/, '')}L` : '';
      return { at: formatEventTime(event.event_time), value: card.id === 'purifier' && amount ? amount.trim() : `${label}${amount}` };
    });
    return {
      ...card,
      value: String(device.value),
      unit: device.unit,
      status: '사용 기록 있음',
      history: history.length ? history : [{ at: '', value: '상세 기록 없음' }],
    };
  });
}

function emptyCard(card, message) {
  return { ...card, value: '—', status: message, history: [{ at: '', value: message }] };
}

export function pendingCards(originalCards, message) {
  return originalCards.map((card) => emptyCard(card, message));
}
