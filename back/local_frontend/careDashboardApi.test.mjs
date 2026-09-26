import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCareDashboard } from './careDashboardApi.mjs';

test('requests the selected resident and date and forwards the abort signal', async () => {
  const signal = new AbortController().signal;
  let request;
  const body = { resident_thinq_id: 'home_23', data_date: '2026-09-23' };
  const result = await loadCareDashboard(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => body };
  }, 'home_23', '2026-09-23', { signal });
  assert.equal(request.url, '/api/care/dashboard?home_id=home_23&date=2026-09-23');
  assert.equal(request.options.signal, signal);
  assert.equal(result, body);
});

test('returns a safe server message without exposing a non-JSON body', async () => {
  await assert.rejects(
    loadCareDashboard(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: '돌봄 데이터를 불러올 수 없습니다.' } }),
    }), 'home_23', '2026-09-23'),
    /돌봄 데이터를 불러올 수 없습니다/,
  );
  await assert.rejects(
    loadCareDashboard(async () => ({ ok: false, status: 500, json: async () => { throw new Error('bad'); } }), 'home_23', '2026-09-23'),
    /HTTP 500/,
  );
});
