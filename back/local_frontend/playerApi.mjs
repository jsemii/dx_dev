export async function getPlayerSession(fetcher, homeId) {
  const response = await fetcher(`/api/playback/session?${new URLSearchParams({ home_id: homeId })}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) return false;
  const body = await response.json();
  return body?.paired === true;
}

export async function pairPlayer(fetcher, homeId, pairingCode) {
  const response = await fetcher('/api/playback/pair', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ home_id: homeId, pairing_code: pairingCode }),
  });
  if (!response.ok) throw new Error('재생 화면 연결 코드를 확인해 주세요.');
  const body = await response.json();
  if (body?.paired !== true || body?.home_id !== homeId) throw new Error('재생 화면 인증 응답이 올바르지 않습니다.');
  return body;
}
