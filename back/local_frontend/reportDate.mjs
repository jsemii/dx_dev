export const MIN_REPORT_DATE = '2025-09-23';

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value;
}

function addIsoDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function defaultReportDate(serverToday) {
  if (!isIsoDate(serverToday)) throw new Error('서버 날짜 형식이 올바르지 않습니다.');
  if (serverToday < MIN_REPORT_DATE) throw new Error('서버 날짜가 리포트 조회 가능 범위보다 이릅니다.');
  const previous = addIsoDays(serverToday, -1);
  return previous < MIN_REPORT_DATE ? MIN_REPORT_DATE : previous;
}

export function shiftIsoDate(isoDate, days, maxDate) {
  if (!isIsoDate(isoDate) || !isIsoDate(maxDate) || !Number.isInteger(days)) {
    throw new Error('리포트 날짜 이동 조건이 올바르지 않습니다.');
  }
  const shifted = addIsoDays(isoDate, days);
  if (shifted < MIN_REPORT_DATE || shifted > maxDate) return isoDate;
  return shifted;
}

export function reportDateNavigation(isoDate, serverToday) {
  if (!isIsoDate(isoDate) || !isIsoDate(serverToday)) {
    return { canGoPrevious: false, canGoNext: false };
  }
  return {
    canGoPrevious: isoDate > MIN_REPORT_DATE,
    canGoNext: isoDate < serverToday,
  };
}

export function formatKoreanDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
