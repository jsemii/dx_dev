import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import viteConfig from './vite.config.mjs';
import {
  SERVER_DATE_ERROR_MESSAGE,
  SERVER_DATE_URL,
  loadServerDate,
} from './serverDateApi.mjs';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('loads the KST date only from the server endpoint', async () => {
  const calls = [];
  const today = await loadServerDate(async (url, options) => {
    calls.push({ url, options });
    return response(200, { today: '2026-09-29', timezone: 'Asia/Seoul' });
  });
  assert.equal(today, '2026-09-29');
  assert.equal(calls[0].url, SERVER_DATE_URL);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('fails visibly instead of falling back to a browser date', async () => {
  await assert.rejects(loadServerDate(async () => response(503, {})), {
    message: SERVER_DATE_ERROR_MESSAGE,
  });
  await assert.rejects(loadServerDate(async () => response(200, {
    today: '2026-02-30', timezone: 'Asia/Seoul',
  })), { message: SERVER_DATE_ERROR_MESSAGE });
  await assert.rejects(loadServerDate(async () => { throw new Error('network'); }), {
    message: SERVER_DATE_ERROR_MESSAGE,
  });
});

test('local Vite and deployed Nginx route the date API to the appliance server', () => {
  assert.equal(viteConfig.server.proxy['/api'].target, 'http://127.0.0.1:8000');
  const nginx = readFileSync('../../deploy/integrated_front/nginx.conf', 'utf8');
  assert.match(nginx, /location \^~ \/api\/\s*\{[\s\S]*proxy_pass http:\/\/\$appliance_backend:8000;/);
});
