import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidePlayCommand, homeIdFromPlayerPath, PlaybackRequestGuard, playbackWebSocketUrl,
  TV_PLAYER_STATE, validatePlayCommand,
} from './tvPlayerProtocol.mjs';

const command = {
  type: 'PLAY',
  request_id: '11111111-1111-4111-8111-111111111111',
  home_id: 'home_23',
  video_id: 'rFjRsWPGZxY',
  issued_at: '2026-09-27T00:00:00.000Z',
  expires_at: '2026-09-27T00:00:15.000Z',
};

test('Player 전용 경로에서 생활자 ID를 읽는다', () => {
  assert.equal(homeIdFromPlayerPath('/player/home_23'), 'home_23');
  assert.equal(homeIdFromPlayerPath('/'), null);
});

test('현재 origin에서 ws와 wss 주소를 만든다', () => {
  assert.equal(playbackWebSocketUrl({ protocol: 'https:', host: 'nulbom.example' }), 'wss://nulbom.example/ws/playback');
  assert.equal(playbackWebSocketUrl({ protocol: 'http:', host: '127.0.0.1:5175' }), 'ws://127.0.0.1:5175/ws/playback');
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
