import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import viteConfig from './vite.config.mjs';
import {
  generateOwnedTts,
  loadSharedPhrases,
  saveVoiceEdits,
  stageSharedPhrase,
} from './voicePhraseApi.mjs';

const source = readFileSync('./LocalVoiceTrainingPage.jsx', 'utf8');

test('registered voice rows open the local detail screen', () => {
  assert.match(source, /className="registered-voice-row" onClick=\{\(\) => onSelectVoice\(voice\)\}/);
  assert.match(source, /title="목소리 수정하기"/);
});

test('detail save and permanent deletion use the voice backend', () => {
  assert.match(source, /saveVoiceEdits\(/);
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

test('the local screen keeps exactly two fixed phrases before stored phrases and direct input', () => {
  assert.match(source, /DEFAULT_VOICE_PHRASES = Object\.freeze\(\['밥 먹어요', '약 먹어요'\]\)/);
  assert.doesNotMatch(source, /일어날 시간이에요/);
  const defaults = source.indexOf('...DEFAULT_VOICE_PHRASES.map');
  const stored = source.indexOf('...sharedPhrases.map');
  const directInput = source.indexOf('<span>직접 입력하기</span>');
  assert.ok(defaults >= 0 && defaults < stored && stored < directInput);
});

test('cancelled or blank direct input changes no draft state and calls no API', () => {
  const pending = [];
  assert.equal(stageSharedPhrase(['밥 먹어요', '약 먹어요'], pending, null), pending);
  assert.equal(stageSharedPhrase(['밥 먹어요', '약 먹어요'], pending, '   '), pending);
  assert.doesNotMatch(source, /saveSharedPhrase/);
});

test('confirmed direct input is trimmed into the unsaved list without persistence', () => {
  const pending = stageSharedPhrase(
    ['밥 먹어요', '약 먹어요', '기존 문구'],
    [],
    '  산책할 시간이에요  ',
  );
  assert.deepEqual(pending, ['산책할 시간이에요']);
  assert.match(source, /setPendingPhrases\(stageSharedPhrase\(/);
  assert.match(source, /\.\.\.pendingPhrases\.map/);
});

test('stored and pending duplicates and oversized phrases are rejected before save', () => {
  assert.throws(() => stageSharedPhrase(['기존 문구'], [], ' 기존 문구 '), /이미 등록/);
  assert.throws(() => stageSharedPhrase([], ['임시 문구'], '임시 문구'), /이미 등록/);
  assert.throws(() => stageSharedPhrase([], [], '가'.repeat(501)), /500자/);
});

test('stored phrases are reloaded by resident and invalid numeric phrase ids are rejected', async () => {
  const requests = [];
  const phrase = {
    phrase_id: '11111111-1111-4111-8111-111111111111',
    text: '약 드실 시간이에요',
    created_at: '2026-09-26T05:00:00Z',
  };
  const fetcher = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => [phrase] };
  };

  assert.deepEqual(await loadSharedPhrases(fetcher, 'home_23'), [phrase]);
  assert.equal(requests[0], '/api/voice/shared-phrases?home_id=home_23');

  await assert.rejects(
    loadSharedPhrases(async () => ({
      ok: true,
      json: async () => [{ ...phrase, phrase_id: 123 }],
    }), 'home_23'),
    /응답 형식/,
  );
});

test('stored phrase playback sends both resident and selected voice ownership fields', async () => {
  const requests = [];
  const audio = new Blob(['mp3'], { type: 'audio/mpeg' });
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, blob: async () => audio };
  };

  assert.equal(await generateOwnedTts(fetcher, 'home_23', 'voice-abc', '약 드실 시간이에요'), audio);
  assert.equal(requests[0].url, '/api/tts');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    home_id: 'home_23', voiceId: 'voice-abc', text: '약 드실 시간이에요',
  });
  assert.match(source, /generateOwnedTts\(fetch, DEFAULT_HOME_ID, voice\.voiceId, text\)/);
  assert.match(source, /sharedPhrases=\{sharedPhrases\}/);
});

test('bottom save sends the edited name and all drafts in one PATCH request', async () => {
  const requests = [];
  const updated = { voiceId: 'voice-abc', name: '미미마누 목소리' };
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => updated };
  };

  assert.equal(await saveVoiceEdits(
    fetcher,
    'home_23',
    'voice-abc',
    ' 미미마누 목소리 ',
    ['일어날 시간이에요', '산책할 시간이에요'],
  ), updated);
  assert.equal(requests[0].url, '/api/voice/registered/voice-abc');
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    home_id: 'home_23',
    name: '미미마누 목소리',
    new_phrases: ['일어날 시간이에요', '산책할 시간이에요'],
  });
});

test('name-only and phrase-only edits use the same atomic PATCH helper', async () => {
  const bodies = [];
  const fetcher = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ voiceId: 'voice-abc' }) };
  };

  await saveVoiceEdits(fetcher, 'home_23', 'voice-abc', '새 이름', []);
  await saveVoiceEdits(fetcher, 'home_23', 'voice-abc', '기존 이름', ['새 문구']);
  assert.deepEqual(bodies[0].new_phrases, []);
  assert.equal(bodies[0].name, '새 이름');
  assert.deepEqual(bodies[1].new_phrases, ['새 문구']);
  assert.equal(bodies[1].name, '기존 이름');
});

test('save failure leaves local name and draft state intact for retry', async () => {
  const pending = ['재시도할 문구'];
  await assert.rejects(
    saveVoiceEdits(
      async () => ({ ok: false, status: 503, json: async () => ({ message: '저장소 오류' }) }),
      'home_23', 'voice-abc', '재시도할 이름', pending,
    ),
    /저장소 오류/,
  );
  assert.deepEqual(pending, ['재시도할 문구']);
  assert.match(source, /catch \(cause\) \{\s*setError\(cause\.message \|\| '목소리 정보를 저장하지 못했습니다\.'/);
});

test('cancel exits without PATCH and discards component-local edits', () => {
  assert.match(source, /const \[name, setName\] = useState\(voice\.name\)/);
  assert.match(source, /const \[pendingPhrases, setPendingPhrases\] = useState\(\[\]\)/);
  assert.match(source, /<button type="button" onClick=\{onBack\} disabled=\{busy\}>취소<\/button>/);
  assert.doesNotMatch(source, /onClick=\{onBack\}[^>]*saveVoiceEdits/);
});
