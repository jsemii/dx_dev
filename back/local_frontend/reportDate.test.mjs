import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKoreanDate, shiftIsoDate } from './reportDate.mjs';

test('moves the shared report date and formats it for the screen', () => {
  assert.equal(shiftIsoDate('2026-09-17', -1), '2026-09-16');
  assert.equal(shiftIsoDate('2026-09-17', 1), '2026-09-18');
  assert.equal(formatKoreanDate('2026-09-17'), '2026년 9월 17일');
});

test('does not move outside the generated data period', () => {
  assert.equal(shiftIsoDate('2025-09-23', -1), '2025-09-23');
  assert.equal(shiftIsoDate('2026-09-22', 1), '2026-09-22');
});
