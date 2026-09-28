import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackReadinessController } from './playbackReadiness.mjs';

function controllerHarness(statuses = []) {
  const received = [];
  const errors = [];
  const intervals = [];
  let calls = 0;
  const controller = new PlaybackReadinessController({
    getStatus: async () => statuses[Math.min(calls++, statuses.length - 1)],
    onStatus: (status) => received.push(status),
    onError: (error) => errors.push(error),
    setIntervalFn: (callback, delay) => { intervals.push({ callback, delay }); return 7; },
    clearIntervalFn() {},
  });
  return { controller, received, errors, intervals, calls: () => calls };
}

test('Player 상태를 0에서 1로 새로고침 없이 갱신한다', async () => {
  const notReady = { status: 'NOT_READY', ready: false, ready_players: 0 };
  const ready = { status: 'READY', ready: true, ready_players: 1 };
  const harness = controllerHarness([notReady, ready]);
  harness.controller.start();
  await harness.controller.inFlight;
  assert.equal(harness.received.at(-1).ready, false);
  await harness.controller.poll();
  assert.equal(harness.received.at(-1).ready, true);
  assert.equal(harness.intervals[0].delay, 1_500);
});

test('진행 중인 동일 상태 요청을 공유해 polling 중복을 막는다', async () => {
  let resolveStatus;
  let calls = 0;
  const controller = new PlaybackReadinessController({
    getStatus: () => { calls += 1; return new Promise((resolve) => { resolveStatus = resolve; }); },
    onStatus() {},
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  controller.start();
  await Promise.resolve();
  const first = controller.poll();
  const second = controller.poll();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveStatus({ status: 'NOT_READY', ready: false, ready_players: 0 });
  await first;
});

test('화면 이탈 후 polling 응답과 갱신을 폐기한다', async () => {
  let resolveStatus;
  const received = [];
  const controller = new PlaybackReadinessController({
    getStatus: () => new Promise((resolve) => { resolveStatus = resolve; }),
    onStatus: (status) => received.push(status),
    setIntervalFn: () => 2,
    clearIntervalFn() {},
  });
  controller.start();
  await Promise.resolve();
  controller.stop();
  resolveStatus({ status: 'READY', ready: true, ready_players: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 0);
});
