import test from 'node:test';
import assert from 'node:assert/strict';
import { AngerMonitor, ANGER_MONITOR_STATE, ANGER_RECORDING_DURATION_MS } from './angerMonitor.mjs';

class FakeTrack {
  constructor() { this.readyState = 'live'; this.stopped = false; }
  stop() { this.stopped = true; this.readyState = 'ended'; }
}

class FakeRecorder {
  static instances = [];
  static isTypeSupported(type) { return type.startsWith('audio/webm'); }
  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options?.mimeType || 'audio/webm';
    this.state = 'inactive';
    this.listeners = new Map();
    FakeRecorder.instances.push(this);
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    this.listeners.get('dataavailable')?.({ data: new Blob(['valid audio'], { type: this.mimeType }) });
    this.listeners.get('stop')?.();
  }
}

function harness({
  results = [{ status: 'NOT_DETECTED', detected: false, can_resume: true }],
  sessionIds = ['11111111-1111-4111-8111-111111111111'],
  analyze,
} = {}) {
  FakeRecorder.instances = [];
  const states = [];
  const track = new FakeTrack();
  const stream = { getTracks: () => [track] };
  const analyser = {
    fftSize: 4,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData(samples) { samples.fill(0.1); },
    disconnect() {},
  };
  const audioContext = {
    state: 'running',
    async resume() {},
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({ connect() {} }),
    close: async () => { audioContext.state = 'closed'; },
  };
  let frameCallback;
  let timer;
  let currentTime = 0;
  let analyses = 0;
  const analyzedSessions = [];
  const levels = [];
  let resultIndex = 0;
  let sessionIndex = 0;
  const monitor = new AngerMonitor({
    analyze: async (audio, sessionId, signal) => {
      analyses += 1;
      analyzedSessions.push(sessionId);
      if (analyze) return analyze(audio, sessionId, signal);
      const result = results[Math.min(resultIndex, results.length - 1)];
      resultIndex += 1;
      return result;
    },
    onState: (state) => states.push(state),
    onLevel: (level) => levels.push(level),
    mediaDevices: { async getUserMedia() { return stream; } },
    AudioContextClass: class { constructor() { return audioContext; } },
    MediaRecorderClass: FakeRecorder,
    requestFrame: (callback) => { frameCallback = callback; return 1; },
    cancelFrame() {},
    setTimer: (callback, delay) => { timer = { callback, delay }; return 1; },
    clearTimer() {},
    now: () => currentTime,
    randomUuid: () => {
      const id = sessionIds[Math.min(sessionIndex, sessionIds.length - 1)];
      sessionIndex += 1;
      return id;
    },
  });
  return {
    monitor, states, track,
    setTime(value) { currentTime = value; },
    frame() { frameCallback(); },
    fireTimer() { timer.callback(); },
    timer: () => timer,
    analyses: () => analyses,
    analyzedSessions,
    levels,
  };
}

test('임계 음량이 0.3초 유지되면 한 번만 10초 녹음한다', async () => {
  const testHarness = harness();
  await testHarness.monitor.start();
  testHarness.frame();
  testHarness.setTime(301);
  testHarness.frame();
  assert.equal(FakeRecorder.instances.length, 1);
  assert.equal(testHarness.timer().delay, ANGER_RECORDING_DURATION_MS);
  assert.equal(testHarness.states.at(-1).state, ANGER_MONITOR_STATE.RECORDING);
  testHarness.setTime(401);
  testHarness.frame();
  assert.equal(testHarness.levels.some((level) => typeof level === 'number' && level > 0), true);
  testHarness.fireTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(testHarness.analyses(), 1);
  assert.equal(testHarness.states.at(-1).state, ANGER_MONITOR_STATE.NOT_DETECTED);
});

test('미감지 후 자동 재개하지 않고 사용자가 resume해야 재시작한다', async () => {
  const testHarness = harness();
  await testHarness.monitor.start();
  testHarness.frame();
  testHarness.setTime(301);
  testHarness.frame();
  testHarness.fireTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.NOT_DETECTED);
  await testHarness.monitor.resume();
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.LISTENING);
});

test('감지 성공 후 자동 재개하지 않고 DETECTED 상태에서 사용자 재개를 기다린다', async () => {
  const testHarness = harness({
    results: [{ status: 'DETECTED', detected: true, can_resume: true }],
  });
  await testHarness.monitor.start();
  testHarness.frame();
  testHarness.setTime(301);
  testHarness.frame();
  testHarness.fireTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.DETECTED);
  assert.equal(testHarness.analyses(), 1);
  await testHarness.monitor.resume();
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.LISTENING);
});

test('재개한 다음 감지는 새 session_id를 사용하고 이전 결과를 재사용하지 않는다', async () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const testHarness = harness({
    results: [
      { status: 'DETECTED', detected: true, can_resume: true },
      { status: 'NOT_DETECTED', detected: false, can_resume: true },
    ],
    sessionIds: ids,
  });
  await testHarness.monitor.start();
  testHarness.frame();
  testHarness.setTime(301);
  testHarness.frame();
  testHarness.fireTimer();
  await new Promise((resolve) => setImmediate(resolve));
  await testHarness.monitor.resume();
  testHarness.frame();
  testHarness.setTime(602);
  testHarness.frame();
  testHarness.fireTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.NOT_DETECTED);
  assert.deepEqual(testHarness.analyzedSessions, ids);
});

test('OFF 전환은 마이크 track과 분석 후속 처리를 정리한다', async () => {
  const testHarness = harness();
  await testHarness.monitor.start();
  testHarness.monitor.stop();
  assert.equal(testHarness.track.stopped, true);
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.OFF);
});

test('권한 요청 중 OFF 전환 뒤 늦게 받은 마이크 track도 즉시 정리한다', async () => {
  let resolveStream;
  const track = new FakeTrack();
  const monitor = new AngerMonitor({
    analyze: async () => ({ detected: false }),
    onState() {},
    mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolveStream = resolve; }) },
    AudioContextClass: class {},
    MediaRecorderClass: FakeRecorder,
    requestFrame: () => 1,
    cancelFrame() {},
  });
  const starting = monitor.start();
  monitor.stop();
  resolveStream({ getTracks: () => [track] });
  await starting;
  assert.equal(track.stopped, true);
  assert.equal(monitor.state, ANGER_MONITOR_STATE.OFF);
});

test('화면 이탈로 stop한 뒤 늦게 도착한 분석 결과를 무시한다', async () => {
  let resolveAnalysis;
  const testHarness = harness({
    analyze: () => new Promise((resolve) => { resolveAnalysis = resolve; }),
  });
  await testHarness.monitor.start();
  testHarness.frame();
  testHarness.setTime(301);
  testHarness.frame();
  testHarness.fireTimer();
  await new Promise((resolve) => setImmediate(resolve));
  testHarness.monitor.stop();
  resolveAnalysis({ status: 'DETECTED', detected: true, can_resume: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.OFF);
  assert.equal(testHarness.track.stopped, true);
});

test('Player 연결 중단은 마이크·녹음 타이머를 정리하고 전용 상태로 전환한다', async () => {
  const testHarness = harness();
  await testHarness.monitor.start();
  testHarness.frame();
  testHarness.setTime(301);
  testHarness.frame();
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.RECORDING);
  testHarness.monitor.blockForPlayer();
  assert.equal(testHarness.monitor.state, ANGER_MONITOR_STATE.PLAYER_NOT_READY);
  assert.equal(testHarness.track.stopped, true);
  testHarness.fireTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(testHarness.analyses(), 0);
});

test('Player 준비 오류는 전용 사용자 문구로 표시한다', async () => {
  const error = Object.assign(new Error('generic'), { code: 'PLAYBACK_NOT_READY' });
  const testHarness = harness({ analyze: async () => { throw error; } });
  await testHarness.monitor.start();
  testHarness.frame();
  testHarness.setTime(301);
  testHarness.frame();
  testHarness.fireTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(testHarness.states.at(-1).message, 'YouTube 재생 화면을 먼저 준비해 주세요.');
});
