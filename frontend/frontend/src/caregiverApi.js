const HOME_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function validateHomeId(homeId) {
  if (!HOME_ID_PATTERN.test(homeId || '')) throw new Error('올바른 생활자 ID가 필요합니다.');
  return homeId;
}

function guardian(value) {
  if (!value || typeof value.id !== 'string' || !value.id
      || typeof value.name !== 'string' || !value.name.trim()
      || typeof value.relationship !== 'string' || !value.relationship.trim()
      || typeof value.phone !== 'string' || !value.phone.trim()
      || value.role !== 'ADDITIONAL') {
    throw new Error('보호자 응답 형식이 올바르지 않습니다.');
  }
  return value;
}

async function checked(response, fallback) {
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  const message = typeof payload?.error?.message === 'string'
    ? payload.error.message : `${fallback} (HTTP ${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  error.code = payload?.error?.code;
  throw error;
}

export async function loadCaregivers(fetcher, homeId, { signal } = {}) {
  const params = new URLSearchParams({ home_id: validateHomeId(homeId) });
  const response = await checked(
    await fetcher(`/api/caregivers?${params}`, { signal }),
    '보호자 목록을 불러오지 못했습니다.',
  );
  const body = await response.json();
  if (!Array.isArray(body?.guardians)) throw new Error('보호자 응답 형식이 올바르지 않습니다.');
  return body.guardians.map(guardian);
}

export async function registerCaregiver(fetcher, homeId, values) {
  const response = await checked(await fetcher('/api/caregivers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      home_id: validateHomeId(homeId),
      name: values?.name?.trim() || '',
      relationship: values?.relationship?.trim() || '',
      phone: values?.phone?.trim() || '',
    }),
  }), '보호자를 등록하지 못했습니다.');
  const body = await response.json();
  return guardian(body?.guardian);
}
