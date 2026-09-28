import test from 'node:test';
import assert from 'node:assert/strict';
import { findAngerExpression, normalizeSpeech } from '../src/services/angerDetectionService.js';
import { parseYouTubeUrl } from '../src/validation.js';

test('공백과 문장부호를 제거해 분노 표현을 찾는다', () => {
  assert.equal(normalizeSpeech(' 왜, 자꾸 이래?! '), '왜자꾸이래');
  assert.equal(findAngerExpression('정말 짜증 나!', ['짜증 나']), '짜증 나');
  assert.equal(findAngerExpression('오늘은 기분이 좋아', ['짜증 나']), null);
});

test('허용된 YouTube URL만 정규화한다', () => {
  assert.equal(
    parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=3')?.normalizedUrl,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.equal(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});
