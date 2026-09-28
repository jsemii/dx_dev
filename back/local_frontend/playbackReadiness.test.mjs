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

test('첫 상태 요청이 지연되는 동안 오류를 확정하지 않고 READY를 반영한다', async () => {
  let resolveStatus;
  const received = [];
  const errors = [];
  const controller = new PlaybackReadinessController({
    getStatus: () => new Promise((resolve) => { resolveStatus = resolve; }),
    onStatus: (status) => received.push(status),
    onError: (error) => errors.push(error),
    setIntervalFn: () => 3,
    clearIntervalFn() {},
  });
  controller.start();
  await Promise.resolve();
  assert.deepEqual(received, []);
  assert.deepEqual(errors, []);
  resolveStatus({
    status: 'READY', ready: true, ready_players: 1,
    connected_players: 1, busy: false,
  });
  await controller.inFlight;
  assert.equal(received.at(-1).status, 'READY');
  assert.deepEqual(errors, []);
});

test('첫 조회 실패 뒤 READY가 되면 연결 불가를 표시하지 않고 자동 복구한다', async () => {
  let calls = 0;
  const received = [];
  const transientErrors = [];
  const confirmedErrors = [];
  const controller = new PlaybackReadinessController({
    getStatus: async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary');
      return {
        status: 'READY', ready: true, ready_players: 1,
        connected_players: 1, busy: false,
      };
    },
    onStatus: (status, details) => received.push({ status, details }),
    onTransientError: (error, details) => transientErrors.push({ error, details }),
    onError: (error) => confirmedErrors.push(error),
    setIntervalFn: () => 4,
    clearIntervalFn() {},
  });
  controller.start();
  await controller.inFlight;
  assert.equal(transientErrors.length, 1);
  assert.equal(transientErrors[0].details.consecutiveFailures, 1);
  assert.equal(confirmedErrors.length, 0);
  await controller.poll();
  assert.equal(received.at(-1).status.status, 'READY');
  assert.equal(received.at(-1).details.recovered, true);
  assert.equal(confirmedErrors.length, 0);
});

test('상태 API가 연속 실패할 때만 연결 불가를 한 번 확정한다', async () => {
  const transientErrors = [];
  const confirmedErrors = [];
  const controller = new PlaybackReadinessController({
    getStatus: async () => { throw new Error('offline'); },
    onStatus() {},
    onTransientError: (error) => transientErrors.push(error),
    onError: (error, details) => confirmedErrors.push({ error, details }),
    setIntervalFn: () => 5,
    clearIntervalFn() {},
  });
  controller.start();
  await controller.inFlight;
  assert.equal(transientErrors.length, 1);
  assert.equal(confirmedErrors.length, 0);
  await controller.poll();
  await controller.poll();
  assert.equal(confirmedErrors.length, 1);
  assert.equal(confirmedErrors[0].details.consecutiveFailures, 2);
});

test('READY-BUSY-READY 반복 후 활성 Player 수와 busy 상태가 정상이다', async () => {
  const ready = {
    status: 'READY', ready: true, ready_players: 1, connected_players: 1, busy: false,
  };
  const busy = {
    status: 'BUSY', ready: false, ready_players: 0, connected_players: 1, busy: true,
  };
  const received = [];
  let calls = 0;
  const statuses = [ready, busy, ready, busy, ready, busy, ready];
  const controller = new PlaybackReadinessController({
    getStatus: async () => statuses[calls++],
    onStatus: (status) => received.push(status),
    setIntervalFn: () => 6,
    clearIntervalFn() {},
  });
  controller.start();
  await controller.inFlight;
  for (let index = 1; index < statuses.length; index += 1) await controller.poll();
  assert.deepEqual(received, statuses);
  assert.deepEqual(received.at(-1), ready);
});
