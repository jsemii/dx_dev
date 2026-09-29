import test from 'node:test';
import assert from 'node:assert/strict';
import { AngerMonitor, ANGER_MONITOR_STATE } from './angerMonitor.mjs';
import { PlayerAudioCoordinator } from './playerAudioCoordinator.mjs';

class FakeMonitor {
  state = ANGER_MONITOR_STATE.OFF;
  starts = 0;
  pauses = [];
  async prepare() { this.state = ANGER_MONITOR_STATE.PREPARED; return { label: 'USB Audio Device' }; }
  async start() { this.starts += 1; this.state = ANGER_MONITOR_STATE.LISTENING; }
  suspendMedia(options) { this.pauses.push(options || {}); }
  stop() { this.state = ANGER_MONITOR_STATE.OFF; }
}

function fixture() {
  const timers = [];
  const monitor = new FakeMonitor();
  const states = [];
  const coordinator = new PlayerAudioCoordinator({
    monitor, onState: (state) => states.push(state),
    setTimer: (callback) => { timers.push(callback); return callback; },
    clearTimer: () => {},
  });
  return { coordinator, monitor, states, runTimer: async () => timers.shift()?.() };
}

test('원격 START/STOP은 준비된 Player 마이크만 켜고 끈다', async () => {
  const { coordinator, monitor } = fixture();
  const device = await coordinator.prepare();
  assert.equal(device.label, 'USB Audio Device');
  await coordinator.start();
  assert.equal(coordinator.snapshot().detection_state, 'DETECTING');
  coordinator.stop();
  assert.equal(coordinator.snapshot().detection_requested, false);
  assert.equal(monitor.pauses.length >= 2, true);
});

test('실제 AngerMonitor callback 연결로 START 즉시 DETECTING이 된다', async () => {
  const track = {
    kind: 'audio', readyState: 'live', enabled: true, muted: false,
    label: 'USB Audio Device', stop() { this.readyState = 'ended'; },
    addEventListener() {}, removeEventListener() {},
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const audioContext = {
    state: 'running', async resume() { this.state = 'running'; },
    async suspend() { this.state = 'suspended'; }, async close() { this.state = 'closed'; },
    createAnalyser: () => ({ fftSize: 4, smoothingTimeConstant: 0,
      getFloatTimeDomainData(samples) { samples.fill(0); }, disconnect() {} }),
    createMediaStreamSource: () => ({ connect() {} }),
  };
  class Recorder {
    static isTypeSupported() { return true; }
  }
  let measurementCallback;
  let coordinator;
  const monitor = new AngerMonitor({
    analyze: async () => ({ detected: false }),
    onState: (status) => coordinator?.handleMonitorState(status),
    mediaDevices: { async getUserMedia() { return stream; } },
    AudioContextClass: class { constructor() { return audioContext; } },
    MediaRecorderClass: Recorder,
    setMeasurementTimer: (callback) => { measurementCallback = callback; return 1; },
    clearMeasurementTimer: () => { measurementCallback = undefined; },
    keepStream: true,
  });
  coordinator = new PlayerAudioCoordinator({ monitor, onState() {} });
  await coordinator.prepare();
  const started = await coordinator.start();
  assert.equal(monitor.state, ANGER_MONITOR_STATE.LISTENING);
  assert.equal(started.detection_state, 'DETECTING');
  assert.equal(started.detection_requested, true);
  assert.equal(typeof measurementCallback, 'function');
  assert.equal(track.enabled, true);
  assert.equal(audioContext.state, 'running');
});

test('재준비가 stale playback lock과 LISTENING 상태를 정리해 START를 복구한다', async () => {
  const { coordinator, monitor } = fixture();
  await coordinator.prepare();
  await coordinator.start();
  coordinator.beforePlayback();
  assert.equal(coordinator.playbackLocked, true);
  await coordinator.prepare();
  assert.equal(coordinator.playbackLocked, false);
  assert.equal(coordinator.snapshot().detection_requested, false);
  const started = await coordinator.start();
  assert.equal(started.detection_state, 'DETECTING');
});

test('START → STOP → START를 3회 반복해도 READY+requested invariant를 위반하지 않는다', async () => {
  const { coordinator } = fixture();
  await coordinator.prepare();
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const started = await coordinator.start();
    assert.equal(started.detection_state, 'DETECTING');
    assert.equal(started.detection_requested, true);
    const stopped = coordinator.stop();
    assert.deepEqual([stopped.detection_state, stopped.detection_requested], ['READY', false]);
  }
});

test('LISTENING callback이 없고 실제 monitor 상태도 준비 상태면 START를 실패 처리한다', async () => {
  const monitor = new FakeMonitor();
  monitor.start = async function startWithoutListening() { this.starts += 1; };
  const coordinator = new PlayerAudioCoordinator({ monitor, onState() {} });
  await coordinator.prepare();
  await assert.rejects(coordinator.start(), (error) => error.code === 'DETECTION_NOT_STARTED');
  assert.deepEqual(
    [coordinator.snapshot().detection_state, coordinator.snapshot().detection_requested],
    ['ERROR', false],
  );
});

test('재연결은 활성 감지를 보존하고 stale cooldown은 READY로 정리한다', async () => {
  const { coordinator } = fixture();
  await coordinator.prepare();
  await coordinator.start();
  coordinator.recoverConnection({ playbackActive: false });
  assert.equal(coordinator.snapshot().detection_state, 'DETECTING');
  coordinator.afterPlayback();
  assert.equal(coordinator.snapshot().detection_state, 'COOLDOWN');
  coordinator.recoverConnection({ playbackActive: false });
  assert.deepEqual(
    [coordinator.snapshot().detection_state, coordinator.snapshot().detection_requested],
    ['READY', false],
  );
});

test('감지→재생→cooldown→재개에서 재생 중 입력을 잠그고 3회 복구한다', async () => {
  const { coordinator, monitor, runTimer } = fixture();
  await coordinator.prepare();
  await coordinator.start();
  for (let cycle = 0; cycle < 3; cycle += 1) {
    monitor.state = ANGER_MONITOR_STATE.ANALYZING;
    coordinator.beforePlayback();
    assert.equal(coordinator.snapshot().detection_state, 'PLAYING');
    assert.equal(monitor.pauses.at(-1).preserveAnalysis, true);
    coordinator.afterPlayback();
    assert.equal(coordinator.snapshot().detection_state, 'COOLDOWN');
    await runTimer();
    assert.equal(monitor.state, ANGER_MONITOR_STATE.LISTENING);
  }
  assert.equal(monitor.starts, 4);
});

test('cooldown 중 STOP_DETECTION이면 자동 감지를 재개하지 않는다', async () => {
  const { coordinator, monitor, runTimer } = fixture();
  await coordinator.prepare();
  await coordinator.start();
  coordinator.beforePlayback();
  coordinator.afterPlayback();
  coordinator.stop();
  await runTimer();
  assert.equal(monitor.starts, 1);
  assert.equal(coordinator.snapshot().detection_state, 'READY');
});

test('실제 monitor callback으로 재생 종료 cooldown 뒤 DETECTING과 RECORDING을 복구한다', async () => {
  const track = {
    kind: 'audio', readyState: 'live', enabled: true, muted: false, label: 'USB Audio Device',
    stop() { this.readyState = 'ended'; }, addEventListener() {}, removeEventListener() {},
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const audioContext = {
    state: 'running', async resume() { this.state = 'running'; },
    async close() { this.state = 'closed'; },
    createAnalyser: () => ({
      fftSize: 4, smoothingTimeConstant: 0,
      getFloatTimeDomainData(samples) { samples.fill(0.1); }, disconnect() {},
    }),
    createMediaStreamSource: () => ({ connect() {} }),
  };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.listeners = new Map(); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  let measurementCallback;
  let cooldownCallback;
  let now = 0;
  let coordinator;
  const monitor = new AngerMonitor({
    analyze: async () => ({ detected: false }),
    onState: (status) => coordinator?.handleMonitorState(status),
    mediaDevices: { async getUserMedia() { return stream; } },
    AudioContextClass: class { constructor() { return audioContext; } },
    MediaRecorderClass: Recorder,
    setMeasurementTimer: (callback) => { measurementCallback = callback; return 1; },
    clearMeasurementTimer: () => { measurementCallback = undefined; },
    setTimer: () => 1, clearTimer() {}, now: () => now, keepStream: true,
  });
  coordinator = new PlayerAudioCoordinator({
    monitor, onState() {}, cooldownMs: 1,
    setTimer: (callback) => { cooldownCallback = callback; return 1; }, clearTimer() {},
  });
  await coordinator.prepare();
  await coordinator.start();
  coordinator.beforePlayback();
  assert.equal(track.enabled, false);
  assert.equal(measurementCallback, undefined);
  coordinator.afterPlayback();
  await cooldownCallback();
  assert.equal(coordinator.snapshot().detection_state, 'DETECTING');
  measurementCallback();
  now = 301;
  measurementCallback();
  assert.equal(coordinator.snapshot().detection_state, 'RECORDING');
});
