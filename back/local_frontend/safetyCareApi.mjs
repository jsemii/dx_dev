export const SAFETY_CARE_HOME_ID = 'home_23';

export class SafetyCareApiError extends Error {
  constructor(message, { code = 'UNKNOWN_ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'SafetyCareApiError';
    this.code = code;
    this.status = status;
  }
}

async function responseError(response, fallback) {
  try {
    const body = await response.json();
    const message = body?.error?.message;
    const code = body?.error?.code;
    if (typeof message === 'string' && message.trim()) {
      return new SafetyCareApiError(message.trim(), {
        code: typeof code === 'string' ? code : 'UNKNOWN_ERROR',
        status: response.status,
      });
    }
  } catch {
    // Non-JSON errors use the safe fallback below.
  }
  return new SafetyCareApiError(`${fallback} (HTTP ${response.status})`, { status: response.status });
}

export async function getSafetyCareSetting(fetcher, homeId, options = {}) {
  const query = new URLSearchParams({ home_id: homeId });
  const response = await fetcher(`/api/safety-care/settings?${query}`, {
    method: 'GET',
    signal: options.signal,
  });
  if (!response.ok) throw await responseError(response, '안정 돌봄 설정을 불러오지 못했습니다.');
  const body = await response.json();
  if (body?.home_id !== homeId || typeof body?.enabled !== 'boolean') {
    throw new Error('안정 돌봄 설정 응답 형식이 올바르지 않습니다.');
  }
  return body;
}

export async function setSafetyCareEnabled(fetcher, homeId, enabled, options = {}) {
  const response = await fetcher('/api/safety-care/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ home_id: homeId, enabled }),
    signal: options.signal,
  });
  if (!response.ok) throw await responseError(response, '안정 돌봄 설정을 변경하지 못했습니다.');
  const body = await response.json();
  if (body?.home_id !== homeId || body?.enabled !== enabled) {
    throw new Error('안정 돌봄 설정 응답 형식이 올바르지 않습니다.');
  }
  return body;
}

export async function analyzeAnger(fetcher, homeId, sessionId, audio, options = {}) {
  const form = new FormData();
  form.append('home_id', homeId);
  form.append('session_id', sessionId);
  const extension = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : 'webm';
  form.append('audio', audio, `recording.${extension}`);
  const response = await fetcher('/api/anger/analyze', {
    method: 'POST',
    body: form,
    signal: options.signal,
  });
  if (!response.ok) throw await responseError(response, '분노 감지 요청에 실패했습니다.');
  const body = await response.json();
  if (!['NOT_DETECTED', 'DETECTED'].includes(body?.status) || typeof body?.detected !== 'boolean') {
    throw new Error('분노 감지 응답 형식이 올바르지 않습니다.');
  }
  return body;
}

export async function getPlaybackStatus(fetcher, homeId, options = {}) {
  const query = new URLSearchParams({ home_id: homeId });
  const response = await fetcher(`/api/anger/playback-status?${query}`, {
    method: 'GET',
    signal: options.signal,
  });
  if (!response.ok) throw await responseError(response, 'YouTube 재생 상태를 확인하지 못했습니다.');
  const body = await response.json();
  const validStatus = ['READY', 'NOT_READY', 'BUSY', 'OFFLINE', 'UNAVAILABLE'].includes(body?.status);
  if (!validStatus
      || typeof body?.available !== 'boolean'
      || typeof body?.ready !== 'boolean'
      || !Number.isInteger(body?.ready_players)
      || body.ready_players < 0
      || typeof body?.control_url !== 'string'
      || !body.control_url.trim()) {
    throw new SafetyCareApiError('YouTube 재생 상태 응답 형식이 올바르지 않습니다.');
  }
  return body;
}
