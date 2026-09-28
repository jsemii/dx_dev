import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'nulbom_player_session';

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function secureEqual(left, right) {
  const leftDigest = createHmac('sha256', 'nulbom-constant-time').update(String(left)).digest();
  const rightDigest = createHmac('sha256', 'nulbom-constant-time').update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function createPlayerSession(homeId, secret, ttlSeconds, now = Date.now()) {
  const payload = encode(JSON.stringify({ home_id: homeId, exp: now + ttlSeconds * 1_000 }));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyPlayerSession(token, secret, now = Date.now()) {
  if (!token || typeof token !== 'string') return null;
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return null;
  const expected = signature(payload, secret);
  if (!secureEqual(suppliedSignature, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof value.home_id !== 'string' || !Number.isFinite(value.exp) || value.exp <= now) return null;
    return value;
  } catch {
    return null;
  }
}

export function sessionFromCookieHeader(header, secret, now = Date.now()) {
  const cookies = String(header || '').split(';').map((item) => item.trim());
  const entry = cookies.find((item) => item.startsWith(`${COOKIE_NAME}=`));
  return verifyPlayerSession(entry?.slice(COOKIE_NAME.length + 1), secret, now);
}

export function playerSessionCookie(token, maxAgeSeconds, secure) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export class PairingAttemptLimiter {
  constructor({ maxAttempts = 5, windowMs = 300_000, now = Date.now } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.now = now;
    this.attempts = new Map();
  }

  status(key) {
    const current = this.attempts.get(key);
    const now = this.now();
    if (!current || current.resetAt <= now) {
      this.attempts.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: current.count < this.maxAttempts,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  failure(key) {
    const now = this.now();
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    current.count += 1;
  }

  success(key) { this.attempts.delete(key); }
}

export { COOKIE_NAME };
