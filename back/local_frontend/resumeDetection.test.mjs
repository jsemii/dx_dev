import test from 'node:test';
import assert from 'node:assert/strict';
import { ANGER_MONITOR_STATE } from './angerMonitor.mjs';
import { resumeDetectionWorkflow } from './resumeDetection.mjs';

function monitorHarness(initialState, events) {
  return {
    state: initialState,
    beginPlaybackStop() {
      events.push('STOPPING_PLAYBACK');
      this.state = ANGER_MONITOR_STATE.STOPPING_PLAYBACK;
    },
    async resume() {
      events.push('MICROPHONE_RESUMED');
      this.state = ANGER_MONITOR_STATE.LISTENING;
    },
    async start() {
      events.push('MICROPHONE_STARTED');
      this.state = ANGER_MONITOR_STATE.LISTENING;
    },
    stop() {
      events.push('MONITOR_STOPPED');
      this.state = ANGER_MONITOR_STATE.OFF;
    },
  };
}

test('DETECTED + BUSY는 STOPPED/READY 확인 후에만 마이크를 재시작한다', async () => {
  const events = [];
  const monitor = monitorHarness(ANGER_MONITOR_STATE.DETECTED, events);
  const result = await resumeDetectionWorkflow({
    homeId: 'home_23',
    monitor,
    playbackStatus: { status: 'BUSY', ready: false },
    stopPlayback: async () => { events.push('STOPPED_READY'); return { stopped: true, ready: true }; },
    getSetting: async () => { events.push('SETTING_CONFIRMED'); return { enabled: true }; },
  });
  assert.deepEqual(events, [
    'STOPPING_PLAYBACK', 'STOPPED_READY', 'SETTING_CONFIRMED', 'MICROPHONE_RESUMED',
  ]);
  assert.deepEqual(result, { enabled: true, resumed: true });
});

test('polling 값이 오래됐어도 재개 직전 GET의 BUSY 상태를 기준으로 STOP한다', async () => {
  const events = [];
  const monitor = monitorHarness(ANGER_MONITOR_STATE.DETECTED, events);
  await resumeDetectionWorkflow({
    homeId: 'home_23',
    monitor,
    playbackStatus: { status: 'READY', ready: true },
    getPlaybackStatus: async () => {
      events.push('STATUS_REFRESHED');
      return { status: 'BUSY', ready: false };
    },
    stopPlayback: async () => { events.push('STOPPED_READY'); return { stopped: true, ready: true }; },
    getSetting: async () => { events.push('SETTING_CONFIRMED'); return { enabled: true }; },
  });
  assert.deepEqual(events, [
    'STATUS_REFRESHED', 'STOPPING_PLAYBACK', 'STOPPED_READY',
    'SETTING_CONFIRMED', 'MICROPHONE_RESUMED',
  ]);
});

test('STOP 실패 시 마이크를 시작하지 않고 오류를 전달한다', async () => {
  const events = [];
  const monitor = monitorHarness(ANGER_MONITOR_STATE.DETECTED, events);
  await assert.rejects(resumeDetectionWorkflow({
    homeId: 'home_23',
    monitor,
    playbackStatus: { status: 'BUSY', ready: false },
    stopPlayback: async () => { events.push('STOP_FAILED'); throw new Error('stop failed'); },
    getSetting: async () => { events.push('SETTING_CONFIRMED'); return { enabled: true }; },
  }), /stop failed/);
  assert.deepEqual(events, ['STOPPING_PLAYBACK', 'STOP_FAILED']);
});

test('NOT_DETECTED + READY는 STOP 없이 설정 확인 후 즉시 재개한다', async () => {
  const events = [];
  const monitor = monitorHarness(ANGER_MONITOR_STATE.NOT_DETECTED, events);
  await resumeDetectionWorkflow({
    homeId: 'home_23',
    monitor,
    playbackStatus: { status: 'READY', ready: true },
    stopPlayback: async () => { events.push('UNEXPECTED_STOP'); return { ready: true }; },
    getSetting: async () => { events.push('SETTING_CONFIRMED'); return { enabled: true }; },
  });
  assert.deepEqual(events, ['SETTING_CONFIRMED', 'MICROPHONE_RESUMED']);
});

test('Player 미준비에서는 STOP·설정 조회·마이크 시작을 하지 않는다', async () => {
  const events = [];
  const monitor = monitorHarness(ANGER_MONITOR_STATE.DETECTED, events);
  await assert.rejects(resumeDetectionWorkflow({
    homeId: 'home_23',
    monitor,
    playbackStatus: { status: 'NOT_READY', ready: false },
    stopPlayback: async () => { events.push('UNEXPECTED_STOP'); },
    getSetting: async () => { events.push('UNEXPECTED_GET'); return { enabled: true }; },
  }), (error) => error.code === 'PLAYBACK_NOT_READY');
  assert.deepEqual(events, []);
});

test('설정이 OFF라면 마이크를 재시작하지 않고 모니터를 종료한다', async () => {
  const events = [];
  const monitor = monitorHarness(ANGER_MONITOR_STATE.NOT_DETECTED, events);
  const result = await resumeDetectionWorkflow({
    homeId: 'home_23',
    monitor,
    playbackStatus: { status: 'READY', ready: true },
    stopPlayback: async () => ({ ready: true }),
    getSetting: async () => ({ enabled: false }),
  });
  assert.deepEqual(events, ['MONITOR_STOPPED']);
  assert.deepEqual(result, { enabled: false, resumed: false });
});

test('DETECTED → STOP → READY → 새 감지 흐름을 mock으로 3회 반복한다', async () => {
  const events = [];
  let stopCalls = 0;
  let resumeCalls = 0;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const monitor = monitorHarness(ANGER_MONITOR_STATE.DETECTED, events);
    const originalResume = monitor.resume.bind(monitor);
    monitor.resume = async () => { resumeCalls += 1; await originalResume(); };
    await resumeDetectionWorkflow({
      homeId: 'home_23',
      monitor,
      playbackStatus: { status: 'BUSY', ready: false },
      stopPlayback: async () => { stopCalls += 1; return { stopped: true, ready: true }; },
      getSetting: async () => ({ enabled: true }),
    });
  }
  assert.equal(stopCalls, 3);
  assert.equal(resumeCalls, 3);
  assert.equal(events.filter((event) => event === 'MICROPHONE_RESUMED').length, 3);
});
