export const MIN_REPORT_DATE = '2025-09-23';
export const MAX_REPORT_DATE = '2026-09-22';

export function shiftIsoDate(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const shifted = next.toISOString().slice(0, 10);
  if (shifted < MIN_REPORT_DATE || shifted > MAX_REPORT_DATE) return isoDate;
  return shifted;
}

export function formatKoreanDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
