import { getSeoulTodayIso } from './reportDate.mjs';

const inFlightRequests = new Map();

export const TODAY_EMPTY_MESSAGE = '하루가 끝난 뒤 확인할 수 있어요.';
export const FUTURE_DATE_MESSAGE = '미래 날짜의 리포트는 아직 확인할 수 없어요.';

async function errorMessage(response, fallback) {
  try {
    const body = await response.json();
    if (typeof body?.detail === 'string' && body.detail.trim()) return body.detail.trim();
  } catch {
    // JSON이 아닌 오류 응답은 안전한 기본 문구를 사용한다.
  }
  return `${fallback} (HTTP ${response.status})`;
}

async function requestReport(fetcher, homeId, reportDate, today) {
  if (reportDate > today) {
    return { kind: 'future', message: FUTURE_DATE_MESSAGE };
  }

  const encodedHomeId = encodeURIComponent(homeId);
  const encodedDate = encodeURIComponent(reportDate);
  const getResponse = await fetcher(
    `/api/v1/reports/${encodedHomeId}/${encodedDate}?profile=one_person`,
    { method: 'GET' },
  );

  if (getResponse.ok) {
    return { kind: 'ready', body: await getResponse.json(), source: 'stored' };
  }
  if (getResponse.status !== 404) {
    throw new Error(await errorMessage(getResponse, '리포트 조회에 실패했습니다.'));
  }
  if (reportDate === today) {
    return { kind: 'today-empty', message: TODAY_EMPTY_MESSAGE };
  }

  const createResponse = await fetcher('/api/v1/reports/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: 'one_person',
      home_id: homeId,
      report_date: reportDate,
      force: false,
    }),
  });
  if (!createResponse.ok) {
    throw new Error(await errorMessage(createResponse, '리포트 생성에 실패했습니다.'));
  }
  return { kind: 'ready', body: await createResponse.json(), source: 'created' };
}

export function loadDailyReport(
  fetcher,
  homeId,
  reportDate,
  today = getSeoulTodayIso(),
) {
  const key = `${homeId}:${reportDate}`;
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const request = requestReport(fetcher, homeId, reportDate, today)
    .finally(() => {
      if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
    });
  inFlightRequests.set(key, request);
  return request;
}
