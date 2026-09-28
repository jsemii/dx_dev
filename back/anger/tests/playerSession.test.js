import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlayerSession, playerSessionCookie, sessionFromCookieHeader, verifyPlayerSession,
  PairingAttemptLimiter,
} from '../src/services/playerSession.js';

const secret = '12345678901234567890123456789012';

test('서명된 생활자 세션을 발급하고 만료와 위조를 거부한다', () => {
  const token = createPlayerSession('home_23', secret, 60, 1_000);
  assert.equal(verifyPlayerSession(token, secret, 30_000).home_id, 'home_23');
  assert.equal(verifyPlayerSession(`${token}x`, secret, 30_000), null);
  assert.equal(verifyPlayerSession(token, secret, 62_000), null);
});

test('pairing 시도 제한은 창이 지나면 복구되고 성공 시 초기화된다', () => {
  let now = 1_000;
  const limiter = new PairingAttemptLimiter({ maxAttempts: 2, windowMs: 10_000, now: () => now });
  limiter.failure('ip:home');
  assert.equal(limiter.status('ip:home').allowed, true);
  limiter.failure('ip:home');
  assert.equal(limiter.status('ip:home').allowed, false);
  now = 11_001;
  assert.equal(limiter.status('ip:home').allowed, true);
  limiter.failure('ip:home');
  limiter.success('ip:home');
  assert.equal(limiter.status('ip:home').allowed, true);
});

test('HttpOnly SameSite 쿠키에서 세션을 읽고 비밀값은 URL에 넣지 않는다', () => {
  const token = createPlayerSession('home_23', secret, 60, 1_000);
  const cookie = playerSessionCookie(token, 60, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(sessionFromCookieHeader(cookie, secret, 30_000).home_id, 'home_23');
});
