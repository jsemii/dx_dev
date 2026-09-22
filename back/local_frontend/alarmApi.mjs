import { DEFAULT_HOME_ID } from './bridgeData.mjs';

function normalizeAlarm(row) {
  if (!Number.isSafeInteger(row?.alarm_id) || row.alarm_id < 1
      || row.home_id !== DEFAULT_HOME_ID || !['meal', 'medication'].includes(row.type)
      || typeof row.name !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time)
      || typeof row.enabled !== 'boolean') {
    throw new Error('알림 응답 형식이 올바르지 않습니다.');
  }
  return { id: `alarm-${row.alarm_id}`, type: row.type, name: row.name,
    time: row.time, enabled: row.enabled };
}

function normalizeSettings(row) {
  if (row?.home_id !== DEFAULT_HOME_ID || typeof row.enabled !== 'boolean'
      || typeof row.meal_enabled !== 'boolean' || typeof row.medication_enabled !== 'boolean') {
    throw new Error('알림 설정 응답 형식이 올바르지 않습니다.');
  }
  return {
    enabled: row.enabled,
    mealEnabled: row.meal_enabled,
    medicationEnabled: row.medication_enabled,
  };
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('알림 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.message === 'string' && body.message.length <= 120
      && /^(알림|가정 ID|올바른 JSON)/.test(body.message)
      ? body.message : '서버 응답을 확인해주세요.';
    throw new Error(`알림 요청 실패 (HTTP ${response.status}): ${message}`);
  }
  return body;
}

export async function listAlarms(signal) {
  const params = new URLSearchParams({ home_id: DEFAULT_HOME_ID });
  const rows = await request(`/api/alarms?${params}`, { signal });
  if (!Array.isArray(rows)) throw new Error('알림 목록 응답 형식이 올바르지 않습니다.');
  return rows.map(normalizeAlarm);
}

export async function getAlarmSettings(signal) {
  const params = new URLSearchParams({ home_id: DEFAULT_HOME_ID });
  return normalizeSettings(await request(`/api/alarms/settings?${params}`, { signal }));
}

export async function setAlarmSettings({ enabled, mealEnabled, medicationEnabled }) {
  return normalizeSettings(await request('/api/alarms/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ home_id: DEFAULT_HOME_ID, enabled,
      meal_enabled: mealEnabled, medication_enabled: medicationEnabled }),
  }));
}

export async function addAlarm(type, { name, time }) {
  const row = await request('/api/alarms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ home_id: DEFAULT_HOME_ID, type, name, time }),
  });
  return normalizeAlarm(row);
}

export async function setAlarmEnabled(id, enabled) {
  const alarmId = Number(/^alarm-(\d+)$/.exec(id)?.[1]);
  if (!Number.isSafeInteger(alarmId) || alarmId < 1) throw new Error('알림 ID가 올바르지 않습니다.');
  const row = await request(`/api/alarms/${alarmId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ home_id: DEFAULT_HOME_ID, enabled }),
  });
  const alarm = normalizeAlarm(row);
  if (alarm.id !== id || alarm.enabled !== enabled) throw new Error('알림 저장 결과가 올바르지 않습니다.');
  return alarm;
}

export function settingsFromAlarms(alarms, preferences) {
  return {
    enabled: preferences.enabled,
    sections: {
      meal: { title: '식사 시간', enabled: preferences.mealEnabled,
        reminders: alarms.filter((item) => item.type === 'meal') },
      medication: { title: '약 복용 시간', enabled: preferences.medicationEnabled,
        reminders: alarms.filter((item) => item.type === 'medication') },
    },
  };
}
