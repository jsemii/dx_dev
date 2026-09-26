import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import {
  dashboardPlaceholder,
  DEFAULT_DATE,
  formatApplianceValue,
  mapApplianceData,
  mapCareDashboard,
  pendingCards,
  selectSupportedCards,
} from './bridgeData.mjs';
import viteConfig from './vite.config.mjs';

const originals = [
  { id: 'purifier', value: '1.2', status: '정상 작동 중', history: [] },
  { id: 'refrigerator', value: '2', status: '정상 작동 중', history: [] },
  { id: 'tv', value: '0.2', status: '정상 작동 중', history: [] },
  { id: 'bedroom-light', value: '2', status: '정상 작동 중', history: [] },
];

test('starts local report testing on an already stored report date', () => {
  assert.equal(DEFAULT_DATE, '2026-09-23');
});

test('maps API totals and history without provenance badges or operation claims', () => {
  const response = { appliances: [
    { id: 'purifier', value: 0.85, unit: 'L', has_data: true, is_synthetic: true,
      events: [{ appliance: '정수기', action: '출수 종료', event_time: '2023-09-23T08:44:07.000',
                 volume_ml: 350, is_synthetic: true }] },
    { id: 'refrigerator', value: 2, unit: '회', has_data: true, is_synthetic: true,
      events: [{ appliance: '냉장고', action: '문 열림', event_time: '2023-09-23T08:39:59.000',
                 is_synthetic: true }] },
    { id: 'tv', value: 2.373, unit: '시간', has_data: true, is_inferred: true,
      events: [{ appliance: 'TV', action: '켜짐', event_time: '2023-09-23T14:09:51.956',
                 is_inferred: true }] },
  ] };
  const cards = mapApplianceData(response, originals);
  assert.equal(cards[0].value, '0.9');
  assert.equal(cards[0].status, '사용 기록 확인');
  assert.equal(cards[0].history[0].value, '350mL');
  assert.equal(cards[1].history[0].at, '9월 23일 8시 39분 59초');
  assert.equal(cards[1].history[0].value, '열림');
  assert.equal(cards[1].value, '2');
  assert.equal(cards[2].value, '2.4');
  assert.equal(cards[2].status, '사용 기록 확인');
  assert.equal(cards[3].value, '0');
  assert.equal(cards[3].status, '사용 기록 없음');
});

test('shows original purifier milliliters so detail sum matches the card total', () => {
  const volumes = [300, 400, 200, 350, 150];
  const cards = mapApplianceData({ products: {
    purifier: {
      id: 'purifier', value: 1.4, unit: 'L', has_data: true,
      events: volumes.map((volume_ml, index) => ({
        appliance: '정수기', action: '출수 종료',
        event_time: `2026-09-22T${String(index + 7).padStart(2, '0')}:00:00`, volume_ml,
      })),
    },
    refrigerator: { id: 'refrigerator', value: 0, unit: '번', has_data: false, events: [] },
    tv: { id: 'tv', value: null, unit: '시간', has_data: false, events: [] },
  } }, originals);
  assert.equal(cards[0].value, '1.4');
  assert.deepEqual(cards[0].history.map((row) => row.value), volumes.map((value) => `${value}mL`));
  assert.equal(volumes.reduce((sum, value) => sum + value, 0), 1400);
});

test('shows an unavailable TV total as unavailable while preserving event details', () => {
  const cards = mapApplianceData({ products: {
    purifier: { id: 'purifier', value: 0, unit: 'L', has_data: false, events: [] },
    refrigerator: { id: 'refrigerator', value: 0, unit: '번', has_data: false, events: [] },
    tv: {
      id: 'tv', value: null, unit: '시간', has_data: true,
      calculation_status: 'UNAVAILABLE',
      events: [{ appliance: 'TV', action: '켜짐', event_time: '2026-09-23T08:50:00' }],
    },
  } }, originals);
  assert.equal(cards[2].value, '시청 시간 계산 불가');
  assert.equal(cards[2].unit, '');
  assert.equal(cards[2].history[0].value, '전원 켜짐');
});

test('formats refrigerator counts as integers and other totals to one decimal place', () => {
  assert.equal(formatApplianceValue(8, 'refrigerator'), '8');
  assert.equal(formatApplianceValue(1.25, 'purifier'), '1.3');
  assert.equal(formatApplianceValue(0.441, 'tv'), '0.4');
  assert.equal(formatApplianceValue(1, 'purifier'), '1');
  assert.equal(formatApplianceValue('not-a-number', 'tv'), '—');
});

test('local bridge keeps ThinQ ON and starts all appliance history cards collapsed', () => {
  const teamPage = realpathSync('../../frontend/frontend/src/NeulbomPage.jsx');
  const source = readFileSync(teamPage, 'utf8');
  const transformed = viteConfig.plugins[0].transform(source, teamPage);
  assert.match(transformed, /name: 'ThinQ ON'/);
  assert.match(transformed, /useState\(\(\) => new Set\(\)\)/);
  assert.doesNotMatch(transformed, /new Set\(\['purifier', 'refrigerator', 'tv'\]\)/);
  assert.match(transformed, /key=\{applianceUsageResetKey\}/);
  assert.match(transformed, /aria-label=\{ariaLabel\}/);
});

test('missing or unsupported data and loading never show fixed mock sums', () => {
  const empty = mapApplianceData({ appliances: ['purifier', 'refrigerator', 'tv'].map((id) => ({
    id, value: 0, unit: '회', has_data: false, events: [],
  })) }, originals);
  assert.equal(empty[0].value, '0');
  assert.equal(empty[0].history[0].value, '사용 기록이 없어요.');
  assert.equal(pendingCards(originals, '조회 중')[0].value, '—');
  assert.equal(pendingCards(originals, '조회 중')[3].value, '—');
});

test('maps dashboard care and product data without falling back to teammate mocks', () => {
  const view = mapCareDashboard({
    resident_thinq_id: 'home_23',
    data_date: '2026-09-23',
    care_overview: {
      status: 'COMPLETED',
      message: ['선택한 날짜의 돌봄 기록을', '확인했어요'],
    },
    recent_care: [{ id: 'care-1', title: '주방에서 식사를 안내했어요.', detail: '식사 행동이 확인됐어요.', time: '08:30' }],
    latest_appliance: { name: '공기청정기' },
    products: {
      purifier: { id: 'purifier', value: 1.45, unit: 'L', has_data: true, events: [] },
      refrigerator: { id: 'refrigerator', value: 6, unit: '번', has_data: true, events: [] },
      tv: { id: 'tv', value: 0, unit: '시간', has_data: true, events: [] },
    },
  }, originals);
  assert.equal(view.overview.status, '돌봄 완료');
  assert.equal(view.overview.lastAppliance, '공기청정기');
  assert.deepEqual(view.overview.message, ['선택한 날짜의 돌봄 기록을', '확인했어요']);
  assert.equal(view.recentCare[0].title, '주방에서 식사를 안내했어요.');
  assert.equal(view.cards[0].value, '1.5');
  assert.equal(view.cards[1].value, '6');
  assert.equal(view.cards[2].value, '0');
});

test('empty care is explicit and loading or failure never exposes care mocks', () => {
  const empty = mapCareDashboard({
    care_overview: { status: 'EMPTY', message: ['선택한 날짜의 돌봄 기록이 없어요'] },
    recent_care: [],
    latest_appliance: null,
    products: Object.fromEntries(['purifier', 'refrigerator', 'tv'].map((id) => [id, {
      id, value: 0, unit: id === 'refrigerator' ? '번' : id === 'purifier' ? 'L' : '시간',
      has_data: false, events: [],
    }])),
  }, originals);
  assert.equal(empty.recentCare[0].id, 'empty-care');
  assert.equal(empty.overview.status, '돌봄 기록 없음');
  assert.equal(empty.overview.lastAppliance, '사용 기록 없음');
  assert.equal(dashboardPlaceholder(originals, 'error').recentCare[0].id, 'error-care');
});

test('local page shares the report date, cancels stale requests and wires real refresh', () => {
  const source = readFileSync('./LocalNeulbomPage.jsx', 'utf8');
  assert.match(source, /loadCareDashboard\(fetch, REPORT_HOME_ID, reportDate/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /requestId === requestIdRef\.current/);
  assert.match(source, /onRefreshCare=\{refreshDashboard\}/);
  assert.match(source, /applianceUsageResetKey=\{reportDate\}/);
  assert.match(source, /careStatusAriaLabel=\{`\$\{reportDate\} 돌봄 상태`\}/);
});

test('only purifier, refrigerator and TV cards are selected for API-backed usage data', () => {
  assert.deepEqual(
    selectSupportedCards(originals).map((card) => card.id),
    ['purifier', 'refrigerator', 'tv'],
  );
});
