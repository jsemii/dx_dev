const PHRASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function checked(response, fallback) {
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.message || `${fallback} (HTTP ${response.status})`);
}

function sharedPhrase(value) {
  if (!value || !PHRASE_ID_PATTERN.test(value.phrase_id || '')
      || typeof value.text !== 'string' || !value.text.trim()
      || typeof value.created_at !== 'string') {
    throw new Error('공유 문구 응답 형식이 올바르지 않습니다.');
  }
  return value;
}

export async function loadSharedPhrases(fetcher, homeId, signal) {
  const params = new URLSearchParams({ home_id: homeId });
  const response = await checked(await fetcher(`/api/voice/shared-phrases?${params}`, { signal }),
    '공유 문구를 조회하지 못했습니다.');
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error('공유 문구 응답 형식이 올바르지 않습니다.');
  return body.map(sharedPhrase);
}

export async function saveSharedPhrase(fetcher, homeId, rawText) {
  const text = rawText?.trim() || '';
  if (!text) return null;
  const response = await checked(await fetcher('/api/voice/shared-phrases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ home_id: homeId, text }),
  }), '공유 문구를 저장하지 못했습니다.');
  return sharedPhrase(await response.json());
}

export function stageSharedPhrase(existingTexts, pendingTexts, rawText) {
  const text = rawText?.trim() || '';
  if (!text) return pendingTexts;
  if (text.length > 500) throw new Error('문구는 500자 이하로 입력해주세요.');
  if ([...existingTexts, ...pendingTexts].includes(text)) {
    throw new Error('이미 등록된 문구입니다.');
  }
  return [...pendingTexts, text];
}

export async function saveVoiceEdits(fetcher, homeId, voiceId, name, newPhrases) {
  const response = await checked(await fetcher(
    `/api/voice/registered/${encodeURIComponent(voiceId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ home_id: homeId, name: name.trim(), new_phrases: newPhrases }),
    },
  ), '목소리 정보를 저장하지 못했습니다.');
  return response.json();
}

export async function generateOwnedTts(fetcher, homeId, voiceId, text) {
  const response = await checked(await fetcher('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ home_id: homeId, voiceId, text }),
  }), '목소리 미리듣기에 실패했습니다.');
  return response.blob();
}
