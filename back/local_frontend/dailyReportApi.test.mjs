import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUTURE_DATE_MESSAGE,
  TODAY_EMPTY_MESSAGE,
  loadDailyReport,
} from './dailyReportApi.mjs';

const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('GET 200 returns the stored report without POST', async () => {
  const calls = [];
  const stored = { report_date: '2026-09-23', content: { summary: '저장됨', timeline: [], highlights: [] } };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return response(200, stored);
  };

  const result = await loadDailyReport(fetcher, 'home_23', '2026-09-23', '2026-09-26');
  assert.equal(result.source, 'stored');
  assert.equal(result.body, stored);
  assert.deepEqual(calls, [{
    url: '/api/v1/reports/home_23/2026-09-23?profile=one_person',
    options: { method: 'GET' },
  }]);
});

test('past GET 404 calls POST exactly once with home_23', async () => {
  const calls = [];
  const created = { report_date: '2026-09-22', content: { summary: '생성됨', timeline: [], highlights: [] } };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response(404, { detail: '없음' }) : response(200, created);
  };

  const result = await loadDailyReport(fetcher, 'home_23', '2026-09-22', '2026-09-26');
  assert.equal(result.source, 'created');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, '/api/v1/reports/generate');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    profile: 'one_person',
    home_id: 'home_23',
    report_date: '2026-09-22',
    force: false,
  });
});

test('concurrent same-home same-date requests share one GET and one POST', async () => {
  const calls = [];
  let releaseGet;
  const getGate = new Promise((resolve) => { releaseGet = resolve; });
  const created = { report_date: '2026-09-21', content: { summary: '생성됨', timeline: [], highlights: [] } };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') {
      await getGate;
      return response(404);
    }
    return response(200, created);
  };

  const first = loadDailyReport(fetcher, 'home_23', '2026-09-21', '2026-09-26');
  const second = loadDailyReport(fetcher, 'home_23', '2026-09-21', '2026-09-26');
  assert.equal(first, second);
  releaseGet();
  await Promise.all([first, second]);
  assert.equal(calls.filter(({ options }) => options.method === 'GET').length, 1);
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 1);

  await loadDailyReport(async () => response(200, created), 'home_23', '2026-09-21', '2026-09-26');
});

test('completed or failed requests leave the in-flight cache retryable', async () => {
  let attempts = 0;
  const fetcher = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('network');
    return response(200, { report_date: '2026-09-20', content: { summary: '재시도', timeline: [], highlights: [] } });
  };
  await assert.rejects(
    loadDailyReport(fetcher, 'home_23', '2026-09-20', '2026-09-26'),
    /network/,
  );
  const retried = await loadDailyReport(fetcher, 'home_23', '2026-09-20', '2026-09-26');
  assert.equal(retried.kind, 'ready');
  assert.equal(attempts, 2);
});

test('today reads an existing report but never creates a missing one', async () => {
  const existingCalls = [];
  const existing = await loadDailyReport(async (url, options) => {
    existingCalls.push({ url, options });
    return response(200, { report_date: '2026-09-26', content: { summary: '오늘', timeline: [], highlights: [] } });
  }, 'home_23', '2026-09-26', '2026-09-26');
  assert.equal(existing.kind, 'ready');
  assert.equal(existingCalls.length, 1);

  const missingCalls = [];
  const missing = await loadDailyReport(async (url, options) => {
    missingCalls.push({ url, options });
    return response(404);
  }, 'home_24', '2026-09-26', '2026-09-26');
  assert.deepEqual(missing, { kind: 'today-empty', message: TODAY_EMPTY_MESSAGE });
  assert.equal(missingCalls.length, 1);
  assert.equal(missingCalls[0].options.method, 'GET');
});

test('future dates make no HTTP request', async () => {
  let calls = 0;
  const result = await loadDailyReport(async () => {
    calls += 1;
    return response(500);
  }, 'home_23', '2026-09-27', '2026-09-26');
  assert.deepEqual(result, { kind: 'future', message: FUTURE_DATE_MESSAGE });
  assert.equal(calls, 0);
});
