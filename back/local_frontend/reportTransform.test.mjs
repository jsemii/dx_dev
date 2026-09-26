import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapDailyReport, sanitizeReportText } from './reportTransform.mjs';

test('local report bridge forwards the share action to the team screen', () => {
  const source = readFileSync('./LocalDailyReport.jsx', 'utf8');
  assert.match(source, /function LocalDailyReport\(\{ onShare \}\)/);
  assert.match(source, /onShare=\{onShare\}/);
});

test('maps the LLM JSON to the existing daily report component', () => {
  const report = mapDailyReport({
    report_date: '2026-09-17',
    content: {
      summary: '하루 요약입니다(row_id 78).',
      timeline: [{ time: '09:20', title: 'TV를 시청했어요.', description: '설명' }],
      highlights: [{
        title: '평소보다 짧았어요.',
        baseline: '최근 한 달 평균 시청 시간: 6시간',
        today: '오늘 시청 시간: 2시간 22분',
      }],
    },
  });
  assert.equal(report.date, '2026년 9월 17일');
  assert.equal(report.summary, '하루 요약입니다.');
  assert.equal(report.timeline[0].description, '설명');
  assert.equal(report.changes[0].average, '최근 한 달 평균 시청 시간: 6시간');
  assert.equal(report.changes[0].current, '오늘 시청 시간: 2시간 22분');
});

test('uses a timeline title only when the server description is empty', () => {
  const report = mapDailyReport({
    report_date: '2026-09-17',
    content: {
      summary: '하루 요약입니다.',
      timeline: [{ time: '09:20', title: 'TV 시청', description: '' }],
      highlights: [],
    },
  });
  assert.equal(report.timeline[0].description, 'TV 시청');
});

test('removes internal row references from visible report text', () => {
  assert.equal(
    sanitizeReportText('정수기를 5회 사용했어요(row 102, row 103).'),
    '정수기를 5회 사용했어요.',
  );
  assert.equal(
    sanitizeReportText('식사는 3회였어요 (행동 이벤트 수, row_id 78).'),
    '식사는 3회였어요.',
  );
  assert.equal(
    sanitizeReportText('전체 행동 이벤트 수는 평소보다 많았어요(row 78). 식사는 3회였어요.'),
    '식사는 3회였어요.',
  );
});
