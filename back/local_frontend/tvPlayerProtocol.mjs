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
export const ALARM_AUDIO_MIME_TYPE = 'audio/mpeg';
export const MAX_ALARM_AUDIO_BYTES = 1_048_576;
const YOUTUBE_STATE_NAMES = new Map([
  [-1, 'UNSTARTED'],
  [0, 'ENDED'],
  [1, 'PLAYING'],
  [2, 'PAUSED'],
  [3, 'BUFFERING'],
  [5, 'CUED'],
]);

export function playbackWebSocketUrl(location) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/playback`;
}

export function playerHeartbeatSnapshot({ prepared, uiState, requestId, youtubeState,
  detection = {} }) {
  const detectionSnapshot = {
    detection_state: detection.detection_state || (prepared ? 'READY' : 'OFFLINE'),
    microphone_ready: Boolean(detection.microphone_ready),
    detection_requested: Boolean(detection.detection_requested),
    detection_result: detection.detection_result || null,
  };
  if (requestId && UUID.test(String(requestId))) {
    return {
      player_state: YOUTUBE_STATE_NAMES.get(youtubeState) || 'CONNECTING',
      request_id: requestId,
      ...detectionSnapshot,
    };
  }
  if (prepared && ![TV_PLAYER_STATE.ERROR, TV_PLAYER_STATE.SETUP].includes(uiState)) {
    return { player_state: 'READY', request_id: null, ...detectionSnapshot };
  }
  return { player_state: 'NOT_READY', request_id: null, ...detectionSnapshot };
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

function validCommandWindow(message, now) {
  const issuedAt = Date.parse(message?.issued_at);
  const expiresAt = Date.parse(message?.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    return { valid: false, code: 'INVALID_EXPIRY' };
  }
  if (expiresAt <= now) return { valid: false, code: 'COMMAND_EXPIRED' };
  return { valid: true };
}

function base64DecodedSize(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return -1;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function validateAudioCommand(message, homeId, now = Date.now(), maxBytes = MAX_ALARM_AUDIO_BYTES) {
  if (message?.type !== 'PLAY_AUDIO') return { valid: false, code: 'INVALID_COMMAND' };
  if (!UUID.test(String(message.request_id || ''))) return { valid: false, code: 'INVALID_REQUEST_ID' };
  if (!UUID.test(String(message.alarm_id || ''))) return { valid: false, code: 'INVALID_ALARM_ID' };
  if (message.home_id !== homeId) return { valid: false, code: 'HOME_MISMATCH' };
  if (message.mime_type !== ALARM_AUDIO_MIME_TYPE) return { valid: false, code: 'INVALID_AUDIO_MIME' };
  const size = base64DecodedSize(message.audio);
  if (size < 1) return { valid: false, code: 'INVALID_AUDIO_DATA' };
  if (size > maxBytes) return { valid: false, code: 'AUDIO_TOO_LARGE' };
  return validCommandWindow(message, now);
}

export function decodeBase64Audio(value) {
  const decoded = globalThis.atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
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

export function decideAudioCommand({ message, homeId, state, currentRequestId, guard,
  now = Date.now(), maxBytes = MAX_ALARM_AUDIO_BYTES }) {
  const validation = validateAudioCommand(message, homeId, now, maxBytes);
  if (!validation.valid) return { action: 'FAILED', code: validation.code };
  if (!guard.accept(message.request_id)) return { action: 'IGNORE_DUPLICATE' };
  if (currentRequestId || state === TV_PLAYER_STATE.PLAYING) {
    return { action: 'FAILED', code: 'PLAYER_BUSY' };
  }
  return { action: 'PLAY_AUDIO' };
}
