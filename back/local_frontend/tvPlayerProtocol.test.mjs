import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALARM_AUDIO_MIME_TYPE, decideAudioCommand, decidePlayCommand, MAX_ALARM_AUDIO_BYTES,
  PlaybackRequestGuard, playbackWebSocketUrl, playerHeartbeatSnapshot, TV_PLAYER_STATE,
  validateAudioCommand, validatePlayCommand,
} from './tvPlayerProtocol.mjs';
import { AlarmAudioPlayer } from './alarmAudioPlayer.mjs';
import { SAFETY_CARE_HOME_ID } from './safetyCareApi.mjs';
import { resolvePlayerRoute } from './playerRoute.mjs';

const command = {
  type: 'PLAY',
  request_id: '11111111-1111-4111-8111-111111111111',
  home_id: 'home_23',
  video_id: 'rFjRsWPGZxY',
  issued_at: '2026-09-27T00:00:00.000Z',
  expires_at: '2026-09-27T00:00:15.000Z',
};
const defaultDetection = {
  detection_state: 'READY', microphone_ready: false,
  detection_requested: false, detection_result: null,
};
const audioCommand = {
  type: 'PLAY_AUDIO',
  request_id: '33333333-3333-4333-8333-333333333333',
  alarm_id: '44444444-4444-4444-8444-444444444444',
  home_id: 'home_23',
  audio: Buffer.from('mock mp3').toString('base64'),
  mime_type: ALARM_AUDIO_MIME_TYPE,
  issued_at: '2026-09-27T00:00:00.000Z',
  expires_at: '2026-09-27T00:00:15.000Z',
};

test('/player는 고정 생활자로 Player를 열고 보호자 루트와 분리한다', () => {
  assert.deepEqual(resolvePlayerRoute('/player'), { kind: 'PLAYER', homeId: SAFETY_CARE_HOME_ID });
  assert.deepEqual(resolvePlayerRoute('/player', '?debug=1'), {
    kind: 'PLAYER', homeId: SAFETY_CARE_HOME_ID,
  });
  assert.deepEqual(resolvePlayerRoute('/'), { kind: 'GUARDIAN' });
});

test('기존 home_23 경로는 query와 hash를 보존해 replace 대상 URL을 만든다', () => {
  assert.deepEqual(resolvePlayerRoute('/player/home_23'), { kind: 'REDIRECT', url: '/player' });
  assert.deepEqual(resolvePlayerRoute('/player/home_23', '?debug=1'), {
    kind: 'REDIRECT', url: '/player?debug=1',
  });
  assert.deepEqual(resolvePlayerRoute('/player/', '?debug=1', '#status'), {
    kind: 'REDIRECT', url: '/player?debug=1#status',
  });
});

test('임의 생활자와 중첩 Player 경로는 home_23에 연결하지 않는다', () => {
  assert.deepEqual(resolvePlayerRoute('/player/home_24'), { kind: 'NOT_FOUND' });
  assert.deepEqual(resolvePlayerRoute('/player/home_23/extra'), { kind: 'NOT_FOUND' });
});

test('현재 origin에서 ws와 wss 주소를 만든다', () => {
  assert.equal(playbackWebSocketUrl({ protocol: 'https:', host: 'nulbom.example' }), 'wss://nulbom.example/ws/playback');
  assert.equal(playbackWebSocketUrl({ protocol: 'http:', host: '127.0.0.1:5175' }), 'ws://127.0.0.1:5175/ws/playback');
});

test('heartbeat는 YouTube 실제 상태와 현재 request_id를 함께 보고한다', () => {
  assert.deepEqual(playerHeartbeatSnapshot({
    prepared: true,
    uiState: TV_PLAYER_STATE.PLAYING,
    requestId: command.request_id,
    youtubeState: 1,
  }), { player_state: 'PLAYING', request_id: command.request_id, ...defaultDetection });
  assert.deepEqual(playerHeartbeatSnapshot({
    prepared: true,
    uiState: TV_PLAYER_STATE.PLAYING,
    requestId: command.request_id,
    youtubeState: 2,
  }), { player_state: 'PAUSED', request_id: command.request_id, ...defaultDetection });
  assert.deepEqual(playerHeartbeatSnapshot({
    prepared: true,
    uiState: TV_PLAYER_STATE.PLAYING,
    requestId: command.request_id,
    youtubeState: 0,
  }), { player_state: 'ENDED', request_id: command.request_id, ...defaultDetection });
});

test('재생 요청이 없을 때 준비 상태만 READY로 보고한다', () => {
  assert.deepEqual(playerHeartbeatSnapshot({
    prepared: true, uiState: TV_PLAYER_STATE.READY, requestId: null,
  }), { player_state: 'READY', request_id: null, ...defaultDetection });
  assert.deepEqual(playerHeartbeatSnapshot({
    prepared: false, uiState: TV_PLAYER_STATE.SETUP, requestId: null,
  }), {
    player_state: 'NOT_READY', request_id: null,
    ...defaultDetection, detection_state: 'OFFLINE',
  });
});

test('heartbeat는 실제 원격 감지와 마이크 상태를 함께 보낸다', () => {
  assert.deepEqual(playerHeartbeatSnapshot({
    prepared: true, uiState: TV_PLAYER_STATE.READY, requestId: null,
    detection: {
      detection_state: 'RECORDING', microphone_ready: true,
      detection_requested: true, detection_result: null,
    },
  }), {
    player_state: 'READY', request_id: null, detection_state: 'RECORDING',
    microphone_ready: true, detection_requested: true, detection_result: null,
  });
});

test('생활자·video ID·만료 시각을 검증한다', () => {
  assert.deepEqual(validatePlayCommand(command, 'home_23', Date.parse('2026-09-27T00:00:05Z')), { valid: true });
  assert.equal(validatePlayCommand(command, 'home_24', Date.parse('2026-09-27T00:00:05Z')).code, 'HOME_MISMATCH');
  assert.equal(validatePlayCommand(command, 'home_23', Date.parse('2026-09-27T00:00:16Z')).code, 'COMMAND_EXPIRED');
  assert.equal(validatePlayCommand({ ...command, video_id: '<script>' }, 'home_23', 0).code, 'INVALID_VIDEO_ID');
});

test('동일 request_id는 한 번만 허용하고 새 요청은 허용한다', () => {
  const guard = new PlaybackRequestGuard();
  assert.equal(guard.accept(command.request_id), true);
  assert.equal(guard.accept(command.request_id), false);
  assert.equal(guard.accept('22222222-2222-4222-8222-222222222222'), true);
});

test('PLAYING 중 새 명령은 PLAYER_BUSY이고 동일 명령은 다시 재생하지 않는다', () => {
  const guard = new PlaybackRequestGuard();
  const now = Date.parse('2026-09-27T00:00:05Z');
  assert.equal(decidePlayCommand({
    message: command, homeId: 'home_23', state: TV_PLAYER_STATE.PLAYING,
    currentRequestId: 'another', guard, now,
  }).code, 'PLAYER_BUSY');
  assert.equal(decidePlayCommand({
    message: command, homeId: 'home_23', state: TV_PLAYER_STATE.READY,
    currentRequestId: null, guard, now,
  }).action, 'IGNORE_DUPLICATE');
});

test('알람 음성 명령은 home·UUID·만료·MIME·크기를 검증한다', () => {
  const now = Date.parse('2026-09-27T00:00:05Z');
  assert.deepEqual(validateAudioCommand(audioCommand, 'home_23', now), { valid: true });
  assert.equal(validateAudioCommand({ ...audioCommand, home_id: 'home_24' }, 'home_23', now).code, 'HOME_MISMATCH');
  assert.equal(validateAudioCommand({ ...audioCommand, alarm_id: 'alarm' }, 'home_23', now).code, 'INVALID_ALARM_ID');
  assert.equal(validateAudioCommand({ ...audioCommand, mime_type: 'text/html' }, 'home_23', now).code, 'INVALID_AUDIO_MIME');
  assert.equal(validateAudioCommand({ ...audioCommand, expires_at: '2026-09-26T23:00:00Z' }, 'home_23', now).code, 'INVALID_EXPIRY');
  const oversized = Buffer.alloc(MAX_ALARM_AUDIO_BYTES + 1).toString('base64');
  assert.equal(validateAudioCommand({ ...audioCommand, audio: oversized }, 'home_23', now).code, 'AUDIO_TOO_LARGE');
});

test('알람 음성과 YouTube는 같은 guard와 busy 상태를 공유한다', () => {
  const guard = new PlaybackRequestGuard();
  const now = Date.parse('2026-09-27T00:00:05Z');
  assert.equal(decideAudioCommand({
    message: audioCommand, homeId: 'home_23', state: TV_PLAYER_STATE.READY,
    currentRequestId: null, guard, now,
  }).action, 'PLAY_AUDIO');
  assert.equal(decideAudioCommand({
    message: { ...audioCommand, request_id: '55555555-5555-4555-8555-555555555555' },
    homeId: 'home_23', state: TV_PLAYER_STATE.PLAYING,
    currentRequestId: command.request_id, guard, now,
  }).code, 'PLAYER_BUSY');
  assert.equal(decideAudioCommand({
    message: audioCommand, homeId: 'home_23', state: TV_PLAYER_STATE.READY,
    currentRequestId: null, guard, now,
  }).action, 'IGNORE_DUPLICATE');
});

test('Player 알람 오디오는 종료와 중지에서 object URL을 해제한다', async () => {
  const revoked = [];
  class FakeAudio {
    async play() { this.onplaying?.(); }
    pause() {}
    load() {}
    removeAttribute() {}
  }
  const player = new AlarmAudioPlayer({
    AudioClass: FakeAudio,
    BlobClass: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
    createObjectURL: () => 'blob:alarm',
    revokeObjectURL: (url) => revoked.push(url),
  });
  await player.prepare();
  let playing = 0;
  let ended = 0;
  await player.play({
    audio: audioCommand.audio, mimeType: audioCommand.mime_type,
    onPlaying: () => { playing += 1; }, onEnded: () => { ended += 1; },
  });
  assert.equal(playing, 1);
  player.audio.onended();
  assert.equal(ended, 1);
  assert.deepEqual(revoked, ['blob:alarm']);

  await player.play({ audio: audioCommand.audio, mimeType: audioCommand.mime_type });
  player.stop();
  assert.deepEqual(revoked, ['blob:alarm', 'blob:alarm']);
});
