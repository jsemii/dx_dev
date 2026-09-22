import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import viteConfig from './vite.config.mjs';

const source = readFileSync('./LocalVoiceTrainingPage.jsx', 'utf8');

test('registered voice rows open the local detail screen', () => {
  assert.match(source, /className="registered-voice-row" onClick=\{\(\) => onSelectVoice\(voice\)\}/);
  assert.match(source, /title="목소리 수정하기"/);
});

test('detail save and permanent deletion use the voice backend', () => {
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /ElevenLabs와 WiFi Care에서 영구 삭제/);
  assert.match(source, /home_id: DEFAULT_HOME_ID/);
});

test('LAN voice writes preserve the browser Host through Vite', () => {
  assert.equal(viteConfig.server.proxy['/api/voice'].changeOrigin, false);
  assert.equal(viteConfig.server.proxy['/api/tts'].changeOrigin, false);
});

test('review recording shows a stop icon only while the real audio is playing', () => {
  assert.match(source, /function ReviewStep\(\{ seconds, isPlaying, onReplay, onRetry \}\)/);
  assert.match(source, /isPlaying=\{isReviewPlaying\}/);
  assert.match(source, /audio\.onended = finish/);
  assert.match(source, /<span className="voice-stop-large"/);
  assert.match(source, /녹음본 재생 중지/);
});

test('completed voice samples track playback and expose a stop control', () => {
  assert.match(source, /playingPhrase === phrase/);
  assert.match(source, /setPlayingPhrase\(phrase\)/);
  assert.match(source, /<span className="voice-stop-small"/);
  assert.match(source, /aria-pressed=\{isPlaying\}/);
});
