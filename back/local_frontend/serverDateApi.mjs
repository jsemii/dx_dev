import { isIsoDate } from './reportDate.mjs';

export const SERVER_DATE_URL = '/api/server-date';
export const SERVER_DATE_ERROR_MESSAGE = '서버 날짜를 불러오지 못했습니다.';

export async function loadServerDate(fetcher, { signal } = {}) {
  let response;
  try {
    response = await fetcher(SERVER_DATE_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(SERVER_DATE_ERROR_MESSAGE);
  }
  if (!response.ok) throw new Error(SERVER_DATE_ERROR_MESSAGE);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(SERVER_DATE_ERROR_MESSAGE);
  }
  if (body?.timezone !== 'Asia/Seoul' || !isIsoDate(body?.today)) {
    throw new Error(SERVER_DATE_ERROR_MESSAGE);
  }
  return body.today;
}
