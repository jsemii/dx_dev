export const MIN_REPORT_DATE = '2025-09-23';

export function getSeoulTodayIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftIsoDate(isoDate, days, maxDate = getSeoulTodayIso()) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const shifted = next.toISOString().slice(0, 10);
  if (shifted < MIN_REPORT_DATE || shifted > maxDate) return isoDate;
  return shifted;
}

export function formatKoreanDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
