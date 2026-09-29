import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('timeout 기본값을 적용한다', () => {
  const config = loadConfig({});
  assert.equal(config.openAiTimeoutMs, 30_000);
  assert.equal(config.playbackTimeoutMs, 5_000);
  assert.equal(config.playbackCommandTtlMs, 15_000);
  assert.equal(config.playbackAudioCompletionTimeoutMs, 120_000);
  assert.equal(config.alarmAudioMaxBytes, 1_048_576);
  assert.equal(config.playerSessionTtlSeconds, 86_400);
  assert.equal(config.playerPairingMaxAttempts, 5);
  assert.equal(config.playerPairingWindowMs, 300_000);
});

test('잘못된 timeout 환경변수는 거부한다', () => {
  assert.throws(() => loadConfig({ OPENAI_TIMEOUT_MS: '0' }), /OPENAI_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ OPENAI_TIMEOUT_MS: '1.5' }), /OPENAI_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ PLAYBACK_TIMEOUT_MS: '-1' }), /PLAYBACK_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ PLAYBACK_TIMEOUT_MS: '60001' }), /PLAYBACK_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ ALARM_AUDIO_MAX_BYTES: '0' }), /ALARM_AUDIO_MAX_BYTES/);
});
