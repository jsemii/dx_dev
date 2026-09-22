import test from 'node:test';
import assert from 'node:assert/strict';
import { mapApplianceData, pendingCards, selectSupportedCards } from './bridgeData.mjs';

const originals = [
  { id: 'purifier', value: '1.2', status: '정상 작동 중', history: [] },
  { id: 'refrigerator', value: '2', status: '정상 작동 중', history: [] },
  { id: 'tv', value: '0.2', status: '정상 작동 중', history: [] },
  { id: 'bedroom-light', value: '2', status: '정상 작동 중', history: [] },
];

test('maps API totals and expanded history without provenance badges or operation claims', () => {
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
  assert.equal(cards[0].value, '0.85');
  assert.equal(cards[0].status, '사용 기록 있음');
  assert.equal(cards[0].history[0].value, '0.35L');
  assert.equal(cards[1].history[0].at, '9월 23일 8시 39분 59초');
  assert.equal(cards[1].history[0].value, '열림');
  assert.equal(cards[2].value, '2.373');
  assert.equal(cards[2].status, '사용 기록 있음');
  assert.equal(cards[3].value, '—');
  assert.equal(cards[3].status, '데이터 없음');
});

test('missing or unsupported data and loading never show fixed mock sums', () => {
  const empty = mapApplianceData({ appliances: ['purifier', 'refrigerator', 'tv'].map((id) => ({
    id, value: 0, unit: '회', has_data: false, events: [],
  })) }, originals);
  assert.equal(empty[0].value, '—');
  assert.equal(empty[0].history[0].value, '데이터 없음');
  assert.equal(pendingCards(originals, '조회 중')[0].value, '—');
  assert.equal(pendingCards(originals, '조회 중')[3].value, '—');
});

test('only purifier, refrigerator and TV cards are selected', () => {
  assert.deepEqual(
    selectSupportedCards(originals).map((card) => card.id),
    ['purifier', 'refrigerator', 'tv'],
  );
});
