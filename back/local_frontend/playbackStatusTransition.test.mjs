import test from 'node:test';
import assert from 'node:assert/strict';
import { ANGER_MONITOR_STATE } from './angerMonitor.mjs';
import {
  blockMonitorForPlayback,
  syncPlaybackMonitor,
} from './playbackStatusTransition.mjs';

function monitorHarness(initialState = ANGER_MONITOR_STATE.OFF) {
  const calls = [];
  return {
    monitor: {
      state: initialState,
      waitForPlayer(message) {
        this.state = ANGER_MONITOR_STATE.PLAYER_CHECKING;
        calls.push({ action: 'WAIT', message });
      },
      blockForPlayer(message) {
        this.state = ANGER_MONITOR_STATE.PLAYER_NOT_READY;
        calls.push({ action: 'BLOCK', message });
      },
      readyForDetection() {
        this.state = ANGER_MONITOR_STATE.READY_TO_START;
        calls.push({ action: 'RECOVER' });
      },
    },
    calls,
  };
}

const checking = { status: 'CHECKING', available: false, ready: false, busy: false };
const offline = { status: 'OFFLINE', available: true, ready: false, busy: false };
const busy = { status: 'BUSY', available: true, ready: false, busy: true };
const ready = { status: 'READY', available: true, ready: true, busy: false };

test('설정 ON 중 CHECKING은 연결 오류가 아닌 확인 중 상태를 유지한다', () => {
  const harness = monitorHarness();
  const blocked = blockMonitorForPlayback(harness.monitor, checking);
  assert.equal(blocked, true);
  assert.deepEqual(harness.calls, [{
    action: 'WAIT', message: '생활자 재생 화면 상태를 확인하고 있습니다.',
  }]);
});

test('OFFLINE에서 READY가 되면 오류를 자동 해제하고 감지 시작 가능으로 복구한다', () => {
  const harness = monitorHarness();
  let blocked = syncPlaybackMonitor({ enabled: true, monitor: harness.monitor, status: offline, blocked: false });
  blocked = syncPlaybackMonitor({ enabled: true, monitor: harness.monitor, status: ready, blocked });
  assert.equal(blocked, false);
  assert.deepEqual(harness.calls.map(({ action }) => action), ['BLOCK', 'RECOVER']);
  assert.equal(harness.monitor.state, ANGER_MONITOR_STATE.READY_TO_START);
});

test('READY-BUSY-READY 전환은 재생 결과를 보존하고 최종 준비 상태를 유지한다', () => {
  const harness = monitorHarness(ANGER_MONITOR_STATE.DETECTED);
  let blocked = syncPlaybackMonitor({ enabled: true, monitor: harness.monitor, status: busy, blocked: false });
  blocked = syncPlaybackMonitor({ enabled: true, monitor: harness.monitor, status: ready, blocked });
  assert.equal(blocked, false);
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.monitor.state, ANGER_MONITOR_STATE.DETECTED);
});

test('분석 응답 대기 중 Player BUSY가 먼저 와도 ANALYZING을 덮어쓰지 않는다', () => {
  const harness = monitorHarness(ANGER_MONITOR_STATE.ANALYZING);
  const blocked = syncPlaybackMonitor({
    enabled: true,
    monitor: harness.monitor,
    status: busy,
    blocked: false,
  });
  assert.equal(blocked, false);
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.monitor.state, ANGER_MONITOR_STATE.ANALYZING);
});

test('CHECKING-READY 자동 복구를 세 번 반복해도 마지막 상태가 준비됨이다', () => {
  const harness = monitorHarness();
  let blocked = false;
  for (let count = 0; count < 3; count += 1) {
    blocked = syncPlaybackMonitor({ enabled: true, monitor: harness.monitor, status: checking, blocked });
    blocked = syncPlaybackMonitor({ enabled: true, monitor: harness.monitor, status: ready, blocked });
  }
  assert.equal(blocked, false);
  assert.equal(harness.monitor.state, ANGER_MONITOR_STATE.READY_TO_START);
  assert.deepEqual(harness.calls.map(({ action }) => action), [
    'WAIT', 'RECOVER', 'WAIT', 'RECOVER', 'WAIT', 'RECOVER',
  ]);
});
