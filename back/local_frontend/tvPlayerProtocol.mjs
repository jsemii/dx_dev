export const TV_PLAYER_STATE = Object.freeze({
  SETUP: 'SETUP',
  CONNECTING: 'CONNECTING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  ENDED: 'ENDED',
  ERROR: 'ERROR',
  DISCONNECTED: 'DISCONNECTED',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function playbackWebSocketUrl(location) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/playback`;
}

export function validatePlayCommand(message, homeId, now = Date.now()) {
  if (message?.type !== 'PLAY') return { valid: false, code: 'INVALID_COMMAND' };
  if (!UUID.test(String(message.request_id || ''))) return { valid: false, code: 'INVALID_REQUEST_ID' };
  if (message.home_id !== homeId) return { valid: false, code: 'HOME_MISMATCH' };
  if (!VIDEO_ID.test(String(message.video_id || ''))) return { valid: false, code: 'INVALID_VIDEO_ID' };
  const issuedAt = Date.parse(message.issued_at);
  const expiresAt = Date.parse(message.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    return { valid: false, code: 'INVALID_EXPIRY' };
  }
  if (expiresAt <= now) return { valid: false, code: 'COMMAND_EXPIRED' };
  return { valid: true };
}

export class PlaybackRequestGuard {
  constructor(limit = 100) {
    this.limit = limit;
    this.seen = new Set();
  }

  accept(requestId) {
    if (this.seen.has(requestId)) return false;
    this.seen.add(requestId);
    if (this.seen.size > this.limit) this.seen.delete(this.seen.values().next().value);
    return true;
  }
}

export function decidePlayCommand({ message, homeId, state, currentRequestId, guard, now = Date.now() }) {
  const validation = validatePlayCommand(message, homeId, now);
  if (!validation.valid) return { action: 'FAILED', code: validation.code };
  if (!guard.accept(message.request_id)) return { action: 'IGNORE_DUPLICATE' };
  if (currentRequestId || state === TV_PLAYER_STATE.PLAYING) {
    return { action: 'FAILED', code: 'PLAYER_BUSY' };
  }
  return { action: 'PLAY' };
}
