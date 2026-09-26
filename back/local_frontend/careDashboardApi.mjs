export async function loadCareDashboard(fetchImpl, homeId, reportDate, { signal } = {}) {
  const params = new URLSearchParams({ home_id: homeId, date: reportDate });
  const response = await fetchImpl(`/api/care/dashboard?${params}`, { signal });
  if (!response.ok) {
    let message = `돌봄 조회 실패 (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error?.message === 'string' && body.error.message.trim()) {
        message = body.error.message;
      }
    } catch {
      // Keep the safe status-only message when the server body is not JSON.
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
