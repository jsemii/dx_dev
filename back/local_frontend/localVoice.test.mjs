import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import viteConfig from './vite.config.mjs';
import {
  deleteSharedPhrase,
  generateOwnedTts,
  loadSharedPhrases,
  saveVoiceEdits,
  stageSharedPhrase,
  updateSharedPhrase,
  validateSharedPhraseEdit,
} from './voicePhraseApi.mjs';

const source = readFileSync('./LocalVoiceTrainingPage.jsx', 'utf8');
const styles = readFileSync('../../frontend/frontend/src/voice-training.css', 'utf8');

test('registered voice rows open the local detail screen', () => {
  assert.match(source, /className="registered-voice-row" onClick=\{\(\) => onSelectVoice\(voice\)\}/);
  assert.match(source, /title="목소리 수정하기"/);
});

test('detail save and permanent deletion use the voice backend', () => {
  assert.match(source, /saveVoiceEdits\(/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /window\.confirm\('이 목소리를 영구 삭제할까요\?'\)/);
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
  assert.match(source, /aria-pressed=\{directInput \? undefined : isPlaying\}/);
});

test('the local screen keeps exactly two fixed phrases before stored phrases and direct input', () => {
  assert.match(source, /DEFAULT_VOICE_PHRASES = Object\.freeze\(\['밥 먹어요', '약 먹어요'\]\)/);
  assert.doesNotMatch(source, /일어날 시간이에요/);
  const defaults = source.indexOf('...DEFAULT_VOICE_PHRASES.map');
  const stored = source.indexOf('...sharedPhrases.map');
  const directInput = source.indexOf("{ key: 'direct-input', text: '직접 입력하기', kind: 'direct' }");
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

test('every phrase row has one internal menu slot and only persisted custom phrases enable it', () => {
  assert.match(source, /manageable = phrase\.kind === 'shared' && Boolean\(phrase\.phraseId\)/);
  assert.match(source, /typeof onEditPhrase === 'function' && typeof onDeletePhrase === 'function'/);
  assert.match(source, /\{ key: 'direct-input', text: '직접 입력하기', kind: 'direct' \}/);
  assert.match(source, /disabled=\{!manageable \|\| processing\}/);
  assert.match(source, /aria-disabled=\{!manageable \|\| processing\}/);
  assert.match(source, /aria-label=\{manageable \? `\$\{phrase\.text\} 문구 메뉴`/);
  assert.match(source, /aria-label="문구 수정"/);
  assert.match(source, /aria-label="문구 삭제"/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /const \[openMenuId, setOpenMenuId\] = useState\(null\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /document\.addEventListener\('pointerdown', closeOutside\)/);
  assert.match(styles, /\.voice-phrase-menu[\s\S]*right: 0;/);
  assert.match(styles, /\.voice-sample-row[\s\S]*width: 100%;[\s\S]*height: 48px;[\s\S]*border-radius: 24px;[\s\S]*background: #eff1f4;/);
  assert.match(styles, /\.voice-sample-list \.voice-phrase-menu-button[\s\S]*background: transparent;/);
});

test('main action and menu are sibling buttons with isolated actions', () => {
  assert.match(source, /<div className="voice-sample-row"[\s\S]*<button type="button" className="voice-sample-main"[\s\S]*<div className="voice-phrase-menu-wrap">[\s\S]*<button type="button" className="voice-phrase-menu-button"/);
  assert.match(source, /onClick=\{\(\) => \(directInput \? onAdd\(\) : onPlay\(phrase\.text\)\)\}/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(source, /<button[^>]*>[\s\S]{0,300}<button type="button" className="voice-phrase-menu-button"/);
});

test('long phrases reserve the menu column and clamp text to two lines', () => {
  assert.match(styles, /grid-template-columns: 24px minmax\(0, 1fr\)/);
  assert.match(styles, /\.voice-phrase-menu-wrap[\s\S]*flex: 0 0 40px;/);
  assert.match(styles, /-webkit-line-clamp: 2;/);
  assert.match(styles, /overflow-wrap: anywhere;/);
});

test('disabled and active phrase menu dots use the same existing color without disabled fading', () => {
  assert.match(styles, /\.voice-sample-list \.voice-phrase-menu-button \{[^}]*color: #405574;[^}]*\}/);
  assert.match(styles, /\.voice-sample-list \.voice-phrase-menu-button:disabled \{[^}]*color: #405574;[^}]*opacity: 1;[^}]*-webkit-text-fill-color: currentColor;[^}]*\}/);
  assert.doesNotMatch(styles, /\.voice-sample-list \.voice-phrase-menu-button:disabled \{[^}]*opacity: 0\./);
});

test('custom phrase edit validation trims input and rejects invalid or duplicate text', () => {
  const phrases = [
    { phrase_id: '11111111-1111-4111-8111-111111111111', text: '기존 문구' },
    { phrase_id: '22222222-2222-4222-8222-222222222222', text: '다른 문구' },
  ];
  assert.equal(validateSharedPhraseEdit(phrases, phrases[0].phrase_id, '기존 문구', null), null);
  assert.equal(validateSharedPhraseEdit(phrases, phrases[0].phrase_id, '기존 문구', ' 기존 문구 '), null);
  assert.equal(validateSharedPhraseEdit(phrases, phrases[0].phrase_id, '기존 문구', ' 수정 문구 '), '수정 문구');
  assert.throws(() => validateSharedPhraseEdit(phrases, phrases[0].phrase_id, '기존 문구', '  '), /입력/);
  assert.throws(() => validateSharedPhraseEdit(phrases, phrases[0].phrase_id, '기존 문구', '가'.repeat(501)), /500자/);
  assert.throws(() => validateSharedPhraseEdit(phrases, phrases[0].phrase_id, '기존 문구', '밥 먹어요'), /기본 문구/);
  assert.throws(() => validateSharedPhraseEdit(phrases, phrases[0].phrase_id, '기존 문구', '다른 문구'), /이미 등록/);
});

test('custom phrase PATCH uses resident ownership and returns the saved DB object', async () => {
  const requests = [];
  const updated = {
    phrase_id: '11111111-1111-4111-8111-111111111111',
    text: '수정 문구',
    created_at: '2026-09-26T05:00:00Z',
    updated_at: '2026-09-30T05:00:00Z',
  };
  const result = await updateSharedPhrase(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => updated };
  }, 'home_23', updated.phrase_id, ' 수정 문구 ');
  assert.deepEqual(result, updated);
  assert.equal(requests[0].url, `/api/voice/shared-phrases/${updated.phrase_id}`);
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].options.body), { home_id: 'home_23', text: '수정 문구' });
});

test('custom phrase DELETE requires a 204 and keeps failures visible to the caller', async () => {
  const phraseId = '11111111-1111-4111-8111-111111111111';
  const requests = [];
  await deleteSharedPhrase(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 204 };
  }, 'home_23', phraseId);
  assert.equal(requests[0].url, `/api/voice/shared-phrases/${phraseId}?home_id=home_23`);
  assert.equal(requests[0].options.method, 'DELETE');

  await assert.rejects(deleteSharedPhrase(async () => ({
    ok: false, status: 404, json: async () => ({ message: '등록된 문구를 찾지 못했습니다.' }),
  }), 'home_23', phraseId), /찾지 못했습니다/);
  await assert.rejects(deleteSharedPhrase(async () => ({ ok: true, status: 200 }), 'home_23', phraseId), /응답 형식/);
});

test('phrase changes update local state only after API success and use required dialogs', () => {
  assert.match(source, /window\.prompt\('수정할 문구를 입력해주세요 \(500자 이내\)', phrase\.text\)/);
  assert.match(source, /window\.confirm\('이 문구를 삭제할까요\?'\)/);
  assert.match(source, /const updated = await updateSharedPhrase[\s\S]*onPhraseUpdated\(updated\)/);
  assert.match(source, /await deleteSharedPhrase[\s\S]*onPhraseDeleted\(phrase\.phrase_id\)/);
  assert.match(source, /setSharedPhrases\(\(current\) => current\.map/);
  assert.match(source, /setSharedPhrases\(\(current\) => current\.filter/);
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
