import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initialReportDateState,
  reportDateControls,
  reportDateReducer,
} from './reportDateState.mjs';

const loaded = (state, today) => reportDateReducer(state, { type: 'server-date-loaded', today });
const shifted = (state, days) => reportDateReducer(state, { type: 'shift-report-date', days });

test('server today and report selection start as independent dates', () => {
  const state = loaded(initialReportDateState, '2026-09-29');
  assert.equal(state.serverToday, '2026-09-29');
  assert.equal(state.reportDate, '2026-09-28');
  const previous = shifted(state, -1);
  assert.equal(previous.serverToday, '2026-09-29');
  assert.equal(previous.reportDate, '2026-09-27');
});

test('report can move backward and forward only through server today', () => {
  let state = loaded(initialReportDateState, '2026-09-29');
  state = shifted(state, -1);
  state = shifted(state, 1);
  state = shifted(state, 1);
  assert.equal(state.reportDate, '2026-09-29');
  assert.deepEqual(reportDateControls(state), { canGoPrevious: true, canGoNext: false });
  assert.equal(shifted(state, 1), state);
});

test('server date refresh updates care today without overwriting a user-selected report date', () => {
  let state = loaded(initialReportDateState, '2026-09-29');
  state = shifted(state, -1);
  state = loaded(state, '2026-09-30');
  assert.equal(state.serverToday, '2026-09-30');
  assert.equal(state.reportDate, '2026-09-27');
});

test('date failure has an explicit error and disables navigation', () => {
  const state = reportDateReducer(initialReportDateState, {
    type: 'server-date-failed',
    message: '서버 날짜를 불러오지 못했습니다.',
  });
  assert.equal(state.dateStatus, 'error');
  assert.match(state.dateError, /날짜를 불러오지 못/);
  assert.deepEqual(reportDateControls(state), { canGoPrevious: false, canGoNext: false });
});

test('care uses only serverToday while report uses reportDate and visibility refreshes the date', () => {
  const care = readFileSync('./LocalNeulbomPage.jsx', 'utf8');
  const report = readFileSync('./LocalDailyReport.jsx', 'utf8');
  const context = readFileSync('./ReportDateContext.jsx', 'utf8');
  assert.match(care, /loadCareDashboard\(fetch, REPORT_HOME_ID, serverToday/);
  assert.doesNotMatch(care, /\breportDate\b/);
  assert.match(report, /loadDailyReport\(fetch, REPORT_HOME_ID, reportDate, serverToday\)/);
  assert.match(context, /visibilitychange/);
  assert.match(context, /document\.visibilityState === 'visible'/);
  assert.doesNotMatch(context, /new Date|Intl\.DateTimeFormat/);
});
