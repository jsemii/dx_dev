import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_REPORT_DATE,
  defaultReportDate,
  formatKoreanDate,
  isIsoDate,
  reportDateNavigation,
  shiftIsoDate,
} from './reportDate.mjs';

test('moves only the report date and formats it for the screen', () => {
  assert.equal(shiftIsoDate('2026-09-17', -1, '2026-09-26'), '2026-09-16');
  assert.equal(shiftIsoDate('2026-09-17', 1, '2026-09-26'), '2026-09-18');
  assert.equal(formatKoreanDate('2026-09-17'), '2026년 9월 17일');
});

test('does not move outside the generated data period', () => {
  assert.equal(shiftIsoDate('2025-09-23', -1, '2026-09-26'), '2025-09-23');
  assert.equal(shiftIsoDate('2026-09-26', 1, '2026-09-26'), '2026-09-26');
  assert.equal(shiftIsoDate('2026-09-22', 1, '2026-09-26'), '2026-09-23');
});

test('defaults reports to the day before the server-provided date', () => {
  assert.equal(defaultReportDate('2026-09-29'), '2026-09-28');
  assert.equal(defaultReportDate('2025-09-24'), MIN_REPORT_DATE);
});

test('navigation exposes explicit minimum and server-today boundaries', () => {
  assert.deepEqual(reportDateNavigation('2026-09-28', '2026-09-29'), {
    canGoPrevious: true,
    canGoNext: true,
  });
  assert.equal(reportDateNavigation('2026-09-29', '2026-09-29').canGoNext, false);
  assert.equal(reportDateNavigation(MIN_REPORT_DATE, '2026-09-29').canGoPrevious, false);
});

test('validates calendar dates without using the browser clock', () => {
  assert.equal(isIsoDate('2026-09-29'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
});
