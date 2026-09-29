import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { SessionResultCache } from '../src/services/sessionResultCache.js';
import { conflict, unavailable } from '../src/errors.js';

const config = {
  allowedOrigins: ['http://127.0.0.1:5175'],
  playerPairingCode: 'pairing-code',
  playerSessionSecret: '12345678901234567890123456789012',
  playerSessionTtlSeconds: 86_400,
  playerPairingMaxAttempts: 5,
  playerPairingWindowMs: 300_000,
  playerCookieSecure: 'false',
  alarmAudioMaxBytes: 1_024,
  playbackInternalToken: '12345678901234567890123456789012',
};
const sessionId = '11111111-1111-4111-8111-111111111111';

function webmBuffer() {
  const buffer = Buffer.alloc(1_200);
  buffer.set([0x1a, 0x45, 0xdf, 0xa3]);
  return buffer;
}

function testApp(overrides = {}) {
  const safetyCareRepository = overrides.safetyCareRepository || {
    async getOrDefault() {
      return { enabled: false, contentSelectionScope: 'YOUTUBE_ONLY' };
    },
    async setEnabled(_homeId, enabled) {
      return { enabled, contentSelectionScope: 'YOUTUBE_ONLY' };
    },
  };
  const analysisService = overrides.analysisService || {
    async analyze() {
      return { status: 'NOT_DETECTED', detected: false, transcript: '좋아요', can_resume: true };
    },
  };
  const playbackClient = overrides.playbackClient || {
    getStatus() { return { ready: false, readyPlayers: 0, connectedPlayers: 0, busy: false }; },
  };
  return createApp({
    config,
    safetyCareRepository,
    analysisService,
    playbackClient,
    sessionCache: new SessionResultCache(),
    logger: { error() {} },
  });
}

test('canonical과 호환 Player 상태 API는 동일한 Gateway 응답을 반환한다', async () => {
  const app = testApp({
    playbackClient: { getStatus() { return { ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false }; } },
  });
  await withRequest(app, async (client) => {
    const canonical = await client.get('/api/playback/status?home_id=home_23');
    const compatibility = await client.get('/api/anger/playback-status?home_id=home_23');
    assert.equal(canonical.status, 200);
    assert.deepEqual(canonical.body, {
      status: 'READY', available: true, ready: true, ready_players: 1,
      connected_players: 1, busy: false,
      player_state: 'READY', microphone_ready: false,
      detection_requested: false, detection_result: null,
      control_url: '/player',
    });
    assert.deepEqual(compatibility.body, canonical.body);
  });
});

test('원격 감지 API는 기존 Gateway에 START와 STOP을 위임한다', async () => {
  const calls = [];
  const app = testApp({
    playbackClient: {
      getStatus() { return { ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false }; },
      async startDetection(homeId) { calls.push(`start:${homeId}`); return { state: 'DETECTING', microphoneReady: true }; },
      async stopDetection(homeId) { calls.push(`stop:${homeId}`); return { state: 'READY', microphoneReady: true }; },
    },
  });
  await withRequest(app, async (client) => {
    const started = await client.post('/api/playback/detection/start').send({ home_id: 'home_23' });
    const stopped = await client.post('/api/playback/detection/stop').send({ home_id: 'home_23' });
    assert.equal(started.status, 200);
    assert.equal(started.body.status, 'DETECTING');
    assert.equal(stopped.status, 200);
  });
  assert.deepEqual(calls, ['start:home_23', 'stop:home_23']);
});

test('내부 알림 음성 API는 공유 토큰과 안전한 필드만 Gateway에 전달한다', async () => {
  const calls = [];
  const app = testApp({
    playbackClient: {
      getStatus() { return { ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false }; },
      async requestAudioPlayback(input) {
        calls.push(input);
        return {
          requestId: input.requestId,
          status: 'COMPLETED',
          startedAt: '2026-09-30T00:00:00.000Z',
          endedAt: '2026-09-30T00:00:01.000Z',
          failureCode: null,
        };
      },
    },
  });
  const body = {
    home_id: 'home_23',
    alarm_id: '11111111-1111-4111-8111-111111111111',
    request_id: '22222222-2222-4222-8222-222222222222',
    audio: Buffer.from('mock mp3').toString('base64'),
    mime_type: 'audio/mpeg',
    text: '클라이언트 문구',
    voice_id: 'client-voice',
    url: 'https://example.com/untrusted.mp3',
  };
  const response = await withRequest(app, (client) => client.post('/internal/playback/audio')
    .set('X-Internal-Token', config.playbackInternalToken).send(body));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'alarmId', 'audio', 'homeId', 'maxBytes', 'mimeType', 'requestId',
  ]);
  assert.equal(calls[0].audio.toString(), 'mock mp3');
});

test('내부 알림 음성 API는 브라우저·잘못된 토큰·잘못된 음성을 거부한다', async () => {
  let calls = 0;
  const app = testApp({
    playbackClient: {
      getStatus() { return { ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false }; },
      async requestAudioPlayback() { calls += 1; },
    },
  });
  const body = {
    home_id: 'home_23',
    alarm_id: '11111111-1111-4111-8111-111111111111',
    request_id: '22222222-2222-4222-8222-222222222222',
    audio: Buffer.from('mock mp3').toString('base64'),
    mime_type: 'audio/mpeg',
  };
  await withRequest(app, async (client) => {
    assert.equal((await client.post('/internal/playback/audio').send(body)).status, 401);
    assert.equal((await client.post('/internal/playback/audio')
      .set('X-Internal-Token', config.playbackInternalToken)
      .set('Origin', config.allowedOrigins[0]).send(body)).status, 401);
    assert.equal((await client.post('/internal/playback/audio')
      .set('X-Internal-Token', config.playbackInternalToken)
      .send({ ...body, mime_type: 'text/html' })).status, 400);
    assert.equal((await client.post('/internal/playback/audio')
      .set('X-Internal-Token', config.playbackInternalToken)
      .send({ ...body, audio: 'not-base64' })).status, 400);
  });
  assert.equal(calls, 0);
});

test('Player STOP API는 STOPPED 확인 뒤 READY 상태를 반환한다', async () => {
  const calls = [];
  const app = testApp({
    playbackClient: {
      getStatus() { return { ready: false, readyPlayers: 0, connectedPlayers: 1, busy: true }; },
      async stopPlayback(homeId) {
        calls.push(homeId);
        return { stopped: true, ready: true };
      },
    },
  });
  const response = await withRequest(app, (client) => client.post('/api/playback/stop')
    .send({ home_id: 'home_23' }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['home_23']);
  assert.deepEqual(response.body, {
    home_id: 'home_23', stopped: true, status: 'READY', ready: true,
  });
});

test('Player 서버 연결 실패를 준비 안 됨과 구분한다', async () => {
  const app = testApp({
    playbackClient: {
      getStatus() { throw unavailable('PLAYBACK_UNAVAILABLE', 'safe'); },
    },
  });
  const response = await withRequest(app, (client) => client.get('/api/anger/playback-status?home_id=home_23'));
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'UNAVAILABLE');
  assert.equal(response.body.available, false);
  assert.equal(response.body.ready, false);
});

test('Player pairing은 HttpOnly 쿠키를 발급하고 URL에 비밀값을 넣지 않는다', async () => {
  const app = testApp();
  await withRequest(app, async (client) => {
    const paired = await client.post('/api/playback/pair')
      .send({ home_id: 'home_23', pairing_code: 'pairing-code' });
    assert.equal(paired.status, 200);
    assert.equal(paired.body.home_id, 'home_23');
    const cookie = paired.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(cookie.includes('pairing-code'), false);
    const session = await client.get('/api/playback/session?home_id=home_23').set('Cookie', cookie);
    assert.deepEqual(session.body, { paired: true });
  });
});

test('잘못된 pairing code는 세션을 발급하지 않는다', async () => {
  const app = testApp();
  const response = await withRequest(app, (client) => client.post('/api/playback/pair')
    .send({ home_id: 'home_23', pairing_code: 'wrong-code' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_pairing_code');
  assert.equal(response.headers['set-cookie'], undefined);
});

test('pairing code 반복 실패는 IP·생활자 기준으로 제한한다', async () => {
  const app = testApp();
  await withRequest(app, async (client) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await client.post('/api/playback/pair')
        .send({ home_id: 'home_23', pairing_code: 'wrong-code' });
      assert.equal(response.status, 400);
    }
    const blocked = await client.post('/api/playback/pair')
      .send({ home_id: 'home_23', pairing_code: 'pairing-code' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'pairing_rate_limited');
    assert.match(blocked.headers['retry-after'], /^\d+$/);
  });
});

async function withRequest(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await callback(request(server));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('설정 행이 없으면 쓰기 없이 기본값을 반환한다', async () => {
  let writes = 0;
  const app = testApp({
    safetyCareRepository: {
      async getOrDefault() { return { enabled: false, contentSelectionScope: 'YOUTUBE_ONLY' }; },
      async setEnabled() { writes += 1; },
    },
  });
  const response = await withRequest(app, (client) => client.get('/api/safety-care/settings?home_id=home_23'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    home_id: 'home_23', enabled: false, content_selection_scope: 'YOUTUBE_ONLY',
  });
  assert.equal(writes, 0);
});

test('PATCH는 검증된 생활자와 boolean 설정을 저장한다', async () => {
  const calls = [];
  const app = testApp({
    safetyCareRepository: {
      async getOrDefault() {},
      async setEnabled(homeId, enabled) {
        calls.push({ homeId, enabled });
        return { enabled, contentSelectionScope: 'YOUTUBE_ONLY' };
      },
    },
  });
  const response = await withRequest(app, (client) => client.patch('/api/safety-care/settings')
    .send({ home_id: 'home_23', enabled: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ homeId: 'home_23', enabled: true }]);
});

test('허용하지 않은 오디오 시그니처는 STT 전에 거부한다', async () => {
  let analyzed = 0;
  const app = testApp({ analysisService: { async analyze() { analyzed += 1; } } });
  const response = await withRequest(app, (client) => client.post('/api/anger/analyze')
    .field('home_id', 'home_23')
    .field('session_id', sessionId)
    .attach('audio', Buffer.alloc(1_200), { filename: 'fake.webm', contentType: 'audio/webm' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'unsupported_audio');
  assert.equal(analyzed, 0);
});

test('유효 녹음은 분석하고 같은 session_id를 중복 실행하지 않는다', async () => {
  let analyzed = 0;
  const app = testApp({
    analysisService: {
      async analyze() {
        analyzed += 1;
        return { status: 'NOT_DETECTED', detected: false, transcript: '좋아요', can_resume: true };
      },
    },
  });
  await withRequest(app, async (client) => {
    const send = () => client.post('/api/anger/analyze')
      .field('home_id', 'home_23')
      .field('session_id', sessionId)
      .attach('audio', webmBuffer(), { filename: 'recording.webm', contentType: 'audio/webm' });
    assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 200);
  });
  assert.equal(analyzed, 1);
});

test('같은 session_id라도 생활자가 다르면 분석 결과를 공유하지 않는다', async () => {
  const homes = [];
  const app = testApp({
    analysisService: {
      async analyze({ homeId }) {
        homes.push(homeId);
        return { status: 'NOT_DETECTED', detected: false, transcript: '', can_resume: true };
      },
    },
  });
  await withRequest(app, async (client) => {
    const send = (homeId) => client.post('/api/anger/analyze')
      .field('home_id', homeId)
      .field('session_id', sessionId)
      .attach('audio', webmBuffer(), { filename: 'recording.webm', contentType: 'audio/webm' });
    assert.equal((await send('home_23')).status, 200);
    assert.equal((await send('home_24')).status, 200);
  });
  assert.deepEqual(homes, ['home_23', 'home_24']);
});

test('내부 오류와 원문을 클라이언트에 노출하지 않는다', async () => {
  const app = testApp({
    analysisService: { async analyze() { throw new Error('secret transcript and database password'); } },
  });
  const response = await withRequest(app, (client) => client.post('/api/anger/analyze')
    .field('home_id', 'home_23')
    .field('session_id', sessionId)
    .attach('audio', webmBuffer(), { filename: 'recording.webm', contentType: 'audio/webm' }));
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
});

test('Player 미준비 오류는 HTTP 409와 전용 코드로 보존한다', async () => {
  const app = testApp({
    analysisService: {
      async analyze() {
        throw conflict('PLAYBACK_NOT_READY', 'YouTube 재생 화면을 먼저 준비해 주세요.');
      },
    },
  });
  const response = await withRequest(app, (client) => client.post('/api/anger/analyze')
    .field('home_id', 'home_23')
    .field('session_id', sessionId)
    .attach('audio', webmBuffer(), { filename: 'recording.webm', contentType: 'audio/webm' }));
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'PLAYBACK_NOT_READY');
  assert.equal(response.body.error.message, 'YouTube 재생 화면을 먼저 준비해 주세요.');
});

test('서버 로그에는 transcript와 비밀값 대신 오류 코드만 남긴다', async () => {
  const logs = [];
  const app = createApp({
    config,
    safetyCareRepository: {
      async getOrDefault() { return { enabled: true }; },
      async setEnabled() {},
    },
    analysisService: {
      async analyze() {
        throw unavailable('transcription_failed', 'secret transcript token password');
      },
    },
    playbackClient: { getStatus() { return { ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false }; } },
    sessionCache: new SessionResultCache(),
    logger: { error(...args) { logs.push(args); } },
  });
  await withRequest(app, (client) => client.post('/api/anger/analyze')
    .field('home_id', 'home_23')
    .field('session_id', sessionId)
    .attach('audio', webmBuffer(), { filename: 'recording.webm', contentType: 'audio/webm' }));
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('transcript token'), false);
  assert.equal(serialized.includes('transcription_failed'), true);
});
