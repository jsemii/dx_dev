import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { forwardContentSaveError, contentSaveError } from './contentUploadErrors.mjs';
import viteConfig from './vite.config.mjs';

test('content proxy retains the LAN Host for same-origin iPhone POSTs', () => {
  assert.equal(viteConfig.server.proxy['/api/content'].changeOrigin, false);
  assert.equal(viteConfig.server.proxy['/api/content'].target, 'http://127.0.0.1:8081');
});

test('upstream page forwards a save error without editing the team file', () => {
  const source = readFileSync(realpathSync('../../frontend/frontend/src/PreferredContentPage.jsx'), 'utf8');
  assert.match(forwardContentSaveError(source), /catch \(error\) \{\s*setSaveError\(error\?\.message/);
  assert.throws(() => forwardContentSaveError('changed upstream'), /변경됐습니다/);
});

test('only known safe API messages reach the screen', async () => {
  const failure = await contentSaveError(new Response(JSON.stringify({ message: 'JPEG, PNG, WebP, HEIC 이미지만 등록할 수 있습니다.' }), { status: 400 }));
  assert.match(failure.message, /HTTP 400.*JPEG/);
  const unavailable = await contentSaveError(new Response(JSON.stringify({ message: 'internal database password' }), { status: 503 }));
  assert.doesNotMatch(unavailable.message, /password/);
  assert.match(unavailable.message, /HTTP 503/);
});
