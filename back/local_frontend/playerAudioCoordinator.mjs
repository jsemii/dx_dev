import { ANGER_MONITOR_STATE } from './angerMonitor.mjs';

export const REMOTE_DETECTION_STATE = Object.freeze({
  OFFLINE: 'OFFLINE', PREPARING: 'PREPARING', READY: 'READY', DETECTING: 'DETECTING',
  RECORDING: 'RECORDING', ANALYZING: 'ANALYZING', PLAYING: 'PLAYING',
  COOLDOWN: 'COOLDOWN', ERROR: 'ERROR',
});

export const ACTIVE_DETECTION_STATES = new Set([
  REMOTE_DETECTION_STATE.DETECTING,
  REMOTE_DETECTION_STATE.RECORDING,
  REMOTE_DETECTION_STATE.ANALYZING,
]);

export function isActiveDetectionState(state) {
  return ACTIVE_DETECTION_STATES.has(state);
}

export class PlayerAudioCoordinator {
  constructor({ monitor, onState, cooldownMs = 1_500,
    setTimer = globalThis.setTimeout.bind(globalThis),
    clearTimer = globalThis.clearTimeout.bind(globalThis) }) {
    this.monitor = monitor;
    this.onState = onState;
    this.cooldownMs = cooldownMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.state = REMOTE_DETECTION_STATE.OFFLINE;
    this.requested = false;
    this.microphoneReady = false;
    this.playbackLocked = false;
    this.lastResult = null;
    this.activationWaiters = [];
  }

  emit(state, details = {}) {
    if (state === REMOTE_DETECTION_STATE.READY || state === REMOTE_DETECTION_STATE.ERROR
        || state === REMOTE_DETECTION_STATE.OFFLINE) this.requested = false;
    if (isActiveDetectionState(state)) this.requested = true;
    this.state = state;
    const snapshot = { state, requested: this.requested,
      microphoneReady: this.microphoneReady, lastResult: this.lastResult, ...details };
    this.onState?.(snapshot);
    if (isActiveDetectionState(state)) this.resolveActivationWaiters();
    else if (state === REMOTE_DETECTION_STATE.ERROR || state === REMOTE_DETECTION_STATE.OFFLINE) {
      this.rejectActivationWaiters(details.message || 'Player 마이크 감지를 시작하지 못했습니다.');
    }
  }

  resolveActivationWaiters() {
    const waiters = this.activationWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve(this.snapshot());
  }

  rejectActivationWaiters(message) {
    const waiters = this.activationWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(new Error(message));
  }

  waitForActivation() {
    return new Promise((resolve, reject) => this.activationWaiters.push({ resolve, reject }));
  }

  syncFromMonitorState() {
    const mapping = {
      [ANGER_MONITOR_STATE.LISTENING]: REMOTE_DETECTION_STATE.DETECTING,
      [ANGER_MONITOR_STATE.RECORDING]: REMOTE_DETECTION_STATE.RECORDING,
      [ANGER_MONITOR_STATE.ANALYZING]: REMOTE_DETECTION_STATE.ANALYZING,
    };
    if (mapping[this.monitor.state] && !isActiveDetectionState(this.state)) {
      this.emit(mapping[this.monitor.state]);
    }
    return isActiveDetectionState(this.state);
  }

  resetTransientState() {
    this.clearTimer(this.cooldownTimer);
    this.cooldownTimer = null;
    this.playbackLocked = false;
    this.requested = false;
    this.lastResult = null;
    this.rejectActivationWaiters('음성 감지 준비 상태가 초기화되었습니다.');
  }

  async prepare() {
    this.resetTransientState();
    this.monitor.suspendMedia?.();
    this.emit(REMOTE_DETECTION_STATE.PREPARING);
    try {
      const device = await this.monitor.prepare();
      if (!device) throw new Error('마이크 준비가 중단되었습니다. 다시 준비해 주세요.');
      this.microphoneReady = Boolean(device);
      this.emit(REMOTE_DETECTION_STATE.READY, { deviceLabel: device?.label || '' });
      return device;
    } catch (error) {
      this.microphoneReady = false;
      this.emit(REMOTE_DETECTION_STATE.ERROR, { message: error.userMessage || error.message });
      throw error;
    }
  }

  async start() {
    this.requested = true;
    this.lastResult = null;
    if (!this.microphoneReady) return this.failStart('Player 마이크가 준비되지 않았습니다.');
    if (this.playbackLocked && this.state !== REMOTE_DETECTION_STATE.PLAYING) {
      this.playbackLocked = false;
    }
    if (this.playbackLocked) return this.failStart('콘텐츠 재생 중에는 음성 감지를 시작할 수 없습니다.');
    if (isActiveDetectionState(this.state)) return this.snapshot();
    if (this.state === REMOTE_DETECTION_STATE.COOLDOWN) return this.waitForActivation();
    this.emit(REMOTE_DETECTION_STATE.PREPARING);
    try {
      await this.monitor.start();
    } catch (error) {
      return this.failStart(error.message || 'Player 마이크 감지를 시작하지 못했습니다.');
    }
    this.syncFromMonitorState();
    if (this.monitor.state === ANGER_MONITOR_STATE.ERROR) {
      return this.failStart('Player 마이크 감지를 시작하지 못했습니다.');
    }
    if (!isActiveDetectionState(this.state) || this.monitor.isDetectionOperational?.() === false) {
      return this.failStart('음성 감지가 실제로 시작되지 않았습니다.');
    }
    return this.snapshot();
  }

  failStart(message) {
    this.reportStartFailure(message);
    throw Object.assign(new Error(message), { code: 'DETECTION_NOT_STARTED' });
  }

  reportStartFailure(message) {
    this.requested = false;
    this.emit(REMOTE_DETECTION_STATE.ERROR, { message });
    return this.snapshot();
  }

  stop() {
    this.requested = false;
    this.clearTimer(this.cooldownTimer);
    this.cooldownTimer = null;
    this.rejectActivationWaiters('음성 감지가 중지되었습니다.');
    this.monitor.suspendMedia();
    if (!this.playbackLocked) this.emit(REMOTE_DETECTION_STATE.READY);
    return this.snapshot();
  }

  recoverConnection({ playbackActive = false } = {}) {
    if (playbackActive) return this.snapshot();
    if (this.playbackLocked || this.state === REMOTE_DETECTION_STATE.PLAYING
        || this.state === REMOTE_DETECTION_STATE.COOLDOWN
        || this.state === REMOTE_DETECTION_STATE.PREPARING) {
      this.clearTimer(this.cooldownTimer);
      this.cooldownTimer = null;
      this.playbackLocked = false;
      this.monitor.suspendMedia();
      this.emit(REMOTE_DETECTION_STATE.READY);
    } else if (this.state === REMOTE_DETECTION_STATE.READY && this.requested) {
      this.requested = false;
      this.emit(REMOTE_DETECTION_STATE.READY);
    }
    return this.snapshot();
  }

  handleMonitorState(status) {
    if (status.state === ANGER_MONITOR_STATE.ERROR) {
      this.microphoneReady = false;
      this.requested = false;
      this.emit(REMOTE_DETECTION_STATE.ERROR, { message: status.message });
      return;
    }
    if (status.state === ANGER_MONITOR_STATE.DETECTED) this.lastResult = 'DETECTED';
    if (status.state === ANGER_MONITOR_STATE.NOT_DETECTED) {
      this.lastResult = 'NOT_DETECTED';
      this.requested = false;
    }
    if (this.playbackLocked) {
      if (status.state === ANGER_MONITOR_STATE.DETECTED) {
        this.emit(REMOTE_DETECTION_STATE.PLAYING, { result: status.result });
      }
      return;
    }
    const mapping = {
      [ANGER_MONITOR_STATE.REQUESTING_PERMISSION]: REMOTE_DETECTION_STATE.PREPARING,
      [ANGER_MONITOR_STATE.PREPARED]: REMOTE_DETECTION_STATE.READY,
      [ANGER_MONITOR_STATE.LISTENING]: REMOTE_DETECTION_STATE.DETECTING,
      [ANGER_MONITOR_STATE.RECORDING]: REMOTE_DETECTION_STATE.RECORDING,
      [ANGER_MONITOR_STATE.ANALYZING]: REMOTE_DETECTION_STATE.ANALYZING,
      [ANGER_MONITOR_STATE.NOT_DETECTED]: REMOTE_DETECTION_STATE.READY,
    };
    if (mapping[status.state]) this.emit(mapping[status.state], { result: status.result });
  }

  beforePlayback() {
    this.playbackLocked = true;
    this.clearTimer(this.cooldownTimer);
    this.cooldownTimer = null;
    this.monitor.suspendMedia({ preserveAnalysis: this.monitor.state === ANGER_MONITOR_STATE.ANALYZING });
    this.emit(REMOTE_DETECTION_STATE.PLAYING);
  }

  afterPlayback() {
    this.playbackLocked = false;
    this.clearTimer(this.cooldownTimer);
    if (!this.requested) {
      this.emit(REMOTE_DETECTION_STATE.READY);
      return;
    }
    this.emit(REMOTE_DETECTION_STATE.COOLDOWN);
    this.cooldownTimer = this.setTimer(async () => {
      this.cooldownTimer = null;
      if (!this.requested || this.playbackLocked) return;
      try {
        await this.monitor.start();
        if (!this.syncFromMonitorState() || this.monitor.isDetectionOperational?.() === false) {
          throw new Error('음성 감지가 실제로 시작되지 않았습니다.');
        }
      } catch (error) {
        this.requested = false;
        this.emit(REMOTE_DETECTION_STATE.ERROR, { message: error.message });
      }
    }, this.cooldownMs);
  }

  snapshot() {
    return { detection_state: this.state, microphone_ready: this.microphoneReady,
      detection_requested: this.requested, detection_result: this.lastResult };
  }

  dispose() {
    this.resetTransientState();
    this.monitor.stop();
    this.microphoneReady = false;
    this.emit(REMOTE_DETECTION_STATE.OFFLINE);
  }
}
