export const ANGER_MONITOR_STATE = Object.freeze({
  OFF: 'OFF',
  PREPARED: 'PREPARED',
  REQUESTING_PERMISSION: 'REQUESTING_PERMISSION',
  LISTENING: 'LISTENING',
  RECORDING: 'RECORDING',
  ANALYZING: 'ANALYZING',
  NOT_DETECTED: 'NOT_DETECTED',
  DETECTED: 'DETECTED',
  STOPPING_PLAYBACK: 'STOPPING_PLAYBACK',
  ERROR: 'ERROR',
  PLAYER_CHECKING: 'PLAYER_CHECKING',
  PLAYER_NOT_READY: 'PLAYER_NOT_READY',
  READY_TO_START: 'READY_TO_START',
});

export const ANGER_THRESHOLD_DB = -40;
export const ANGER_TRIGGER_DURATION_MS = 300;
export const ANGER_RECORDING_DURATION_MS = 10_000;
export const ANGER_MEASUREMENT_INTERVAL_MS = 50;

export class AngerMonitor {
  constructor({
    analyze,
    onState,
    onLevel,
    mediaDevices = globalThis.navigator?.mediaDevices,
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
    MediaRecorderClass = globalThis.MediaRecorder,
    setMeasurementTimer = globalThis.setInterval.bind(globalThis),
    clearMeasurementTimer = globalThis.clearInterval.bind(globalThis),
    setTimer = globalThis.setTimeout.bind(globalThis),
    clearTimer = globalThis.clearTimeout.bind(globalThis),
    now = () => globalThis.performance.now(),
    randomUuid = () => globalThis.crypto.randomUUID(),
    keepStream = false,
    onDevice,
    onDiagnostics,
    thresholdDb = ANGER_THRESHOLD_DB,
    triggerDurationMs = ANGER_TRIGGER_DURATION_MS,
    measurementIntervalMs = ANGER_MEASUREMENT_INTERVAL_MS,
  }) {
    this.analyze = analyze;
    this.onState = onState;
    this.onLevel = onLevel;
    this.mediaDevices = mediaDevices;
    this.AudioContextClass = AudioContextClass;
    this.MediaRecorderClass = MediaRecorderClass;
    this.setMeasurementTimer = setMeasurementTimer;
    this.clearMeasurementTimer = clearMeasurementTimer;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.randomUuid = randomUuid;
    this.keepStream = keepStream;
    this.onDevice = onDevice;
    this.onDiagnostics = onDiagnostics;
    this.thresholdDb = thresholdDb;
    this.triggerDurationMs = triggerDurationMs;
    this.measurementIntervalMs = measurementIntervalMs;
    this.generation = 0;
    this.busy = false;
    this.aboveSince = null;
    this.state = ANGER_MONITOR_STATE.OFF;
    this.lastLevelAt = null;
    this.lastRms = 0;
    this.lastDb = -Infinity;
  }

  hasLiveStream() {
    return Boolean(this.getAudioTrack()?.readyState === 'live');
  }

  getAudioTrack() {
    return this.audioTrack || this.stream?.getAudioTracks?.()[0]
      || this.stream?.getTracks?.().find((track) => track.kind === 'audio' || !track.kind);
  }

  diagnostics() {
    const track = this.getAudioTrack();
    const now = this.now();
    return {
      audioContextState: this.audioContext?.state || 'unavailable',
      trackEnabled: Boolean(track?.enabled),
      trackMuted: Boolean(track?.muted),
      trackReadyState: track?.readyState || 'unavailable',
      rms: this.lastRms,
      db: this.lastDb,
      thresholdDb: this.thresholdDb,
      aboveThresholdMs: this.aboveSince === null ? 0 : Math.max(0, now - this.aboveSince),
      measurementRunning: this.measurementTimer !== undefined,
    };
  }

  publishDiagnostics() {
    this.onDiagnostics?.(this.diagnostics());
  }

  isDetectionOperational() {
    const track = this.getAudioTrack();
    return Boolean(
      track
      && track.enabled === true
      && track.readyState === 'live'
      && this.audioContext?.state === 'running'
      && this.measurementTimer !== undefined,
    );
  }

  detectionUnavailableError() {
    const diagnostics = this.diagnostics();
    let code = 'MEASUREMENT_NOT_RUNNING';
    let message = '마이크 음량 측정을 시작하지 못했습니다.';
    if (diagnostics.trackReadyState !== 'live') {
      code = 'MICROPHONE_DISCONNECTED';
      message = '사용할 수 있는 마이크 연결을 확인해 주세요.';
    } else if (diagnostics.audioContextState !== 'running') {
      code = 'AUDIO_CONTEXT_SUSPENDED';
      message = '브라우저가 마이크 오디오 처리를 중지했습니다. 시연 화면을 다시 준비해 주세요.';
    } else if (!diagnostics.trackEnabled) {
      code = 'MICROPHONE_DISABLED';
      message = '마이크 입력을 활성화하지 못했습니다.';
    }
    return Object.assign(new Error(message), { code, userMessage: message });
  }

  async ensureMedia(generation, { enableTrack = true } = {}) {
    if (!this.mediaDevices?.getUserMedia || !this.AudioContextClass || !this.MediaRecorderClass) {
      throw Object.assign(new Error('이 브라우저에서는 마이크 녹음을 사용할 수 없습니다.'), {
        code: 'MICROPHONE_UNAVAILABLE',
      });
    }
    if (!this.hasLiveStream()) {
      this.emit(ANGER_MONITOR_STATE.REQUESTING_PERMISSION);
      const acquiredStream = await this.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      if (generation !== this.generation) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.stream = acquiredStream;
      const audioTrack = acquiredStream.getAudioTracks?.()[0]
        || acquiredStream.getTracks?.().find((track) => track.kind === 'audio' || !track.kind);
      if (!audioTrack) {
        acquiredStream.getTracks?.().forEach((track) => track.stop());
        this.stream = null;
        throw Object.assign(new Error('사용할 수 있는 마이크를 찾지 못했습니다.'), {
          code: 'MICROPHONE_UNAVAILABLE',
        });
      }
      this.onDevice?.({ label: audioTrack?.label || '연결된 마이크', track: audioTrack });
      if (audioTrack?.addEventListener) {
        this.trackEndedHandler = () => {
          if (this.stream !== acquiredStream) return;
          this.releaseMedia();
          this.emit(ANGER_MONITOR_STATE.ERROR, {
            code: 'MICROPHONE_DISCONNECTED',
            message: '마이크 연결이 해제되었습니다.',
          });
        };
        audioTrack.addEventListener('ended', this.trackEndedHandler, { once: true });
        this.audioTrack = audioTrack;
      }
    }
    this.audioTrack = this.getAudioTrack();
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new this.AudioContextClass();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.25;
      this.audioContext.createMediaStreamSource(this.stream).connect(this.analyser);
    }
    this.audioTrack.enabled = enableTrack;
    await this.audioContext.resume?.();
    if (generation !== this.generation) return false;
    if (this.audioContext.state !== 'running') throw this.detectionUnavailableError();
    this.publishDiagnostics();
    return generation === this.generation;
  }

  async prepare() {
    const generation = ++this.generation;
    try {
      // This runs inside the "시연 화면 준비" click. Keep the unlocked AudioContext
      // running; only disable the input track while detection is idle.
      if (!await this.ensureMedia(generation, { enableTrack: true })) return null;
      this.cancelLoop();
      this.audioTrack.enabled = false;
      this.publishDiagnostics();
      this.emit(ANGER_MONITOR_STATE.PREPARED);
      return { label: this.audioTrack?.label || '연결된 마이크' };
    } catch (error) {
      if (generation !== this.generation) return null;
      const message = ['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)
        ? '마이크 사용 권한이 필요합니다.'
        : error?.name === 'NotFoundError'
          ? '사용할 수 있는 마이크를 찾지 못했습니다.'
          : error?.message || '마이크를 시작하지 못했습니다.';
      this.emit(ANGER_MONITOR_STATE.ERROR, { code: error?.code, message });
      throw Object.assign(error instanceof Error ? error : new Error(message), { userMessage: message });
    }
  }

  emit(state, details = {}) {
    this.state = state;
    if (![ANGER_MONITOR_STATE.PLAYER_CHECKING, ANGER_MONITOR_STATE.PLAYER_NOT_READY].includes(state)) {
      this.blockedMessage = null;
    }
    this.onState?.({ state, ...details });
  }

  async start() {
    if (this.busy) return this.diagnostics();
    if (this.state === ANGER_MONITOR_STATE.LISTENING && this.isDetectionOperational()) {
      return this.diagnostics();
    }
    const generation = ++this.generation;
    try {
      this.cancelLoop();
      if (!await this.ensureMedia(generation, { enableTrack: true })) return null;
      this.startListening();
      if (!this.isDetectionOperational()) throw this.detectionUnavailableError();
      return this.diagnostics();
    } catch (error) {
      if (generation !== this.generation) return;
      const message = ['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)
        ? '마이크 사용 권한이 필요합니다.'
        : error?.userMessage || error?.message || '마이크를 시작하지 못했습니다.';
      this.suspendMedia();
      this.emit(ANGER_MONITOR_STATE.ERROR, { code: error?.code, message });
      throw Object.assign(error instanceof Error ? error : new Error(message), {
        code: error?.code || 'MICROPHONE_UNAVAILABLE', userMessage: message,
      });
    }
  }

  startListening() {
    this.busy = false;
    this.aboveSince = null;
    this.state = ANGER_MONITOR_STATE.LISTENING;
    this.startAudioLoop();
    this.emit(ANGER_MONITOR_STATE.LISTENING);
  }

  startAudioLoop() {
    this.cancelLoop();
    const measure = () => {
      if (![ANGER_MONITOR_STATE.LISTENING, ANGER_MONITOR_STATE.RECORDING].includes(this.state)
          || !this.analyser) {
        this.cancelLoop();
        return;
      }
      if (this.audioContext?.state !== 'running' || !this.getAudioTrack()?.enabled
          || this.getAudioTrack()?.readyState !== 'live') {
        const error = this.detectionUnavailableError();
        this.suspendMedia();
        this.emit(ANGER_MONITOR_STATE.ERROR, { code: error.code, message: error.message });
        return;
      }
      const samples = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      this.lastRms = rms;
      this.lastDb = db;
      const measuredAt = this.now();
      if (this.lastLevelAt === null || measuredAt - this.lastLevelAt >= 80) {
        const level = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 80) / 80)) : 0;
        this.onLevel?.(level);
        this.lastLevelAt = measuredAt;
      }
      if (this.state === ANGER_MONITOR_STATE.LISTENING && db >= this.thresholdDb) {
        if (this.aboveSince === null) this.aboveSince = this.now();
        if (!this.busy && this.now() - this.aboveSince >= this.triggerDurationMs) {
          this.publishDiagnostics();
          this.startRecording();
          return;
        }
      } else if (this.state === ANGER_MONITOR_STATE.LISTENING) {
        this.aboveSince = null;
      }
      this.publishDiagnostics();
    };
    this.measurementTimer = this.setMeasurementTimer(measure, this.measurementIntervalMs);
    this.publishDiagnostics();
  }

  startRecording() {
    if (this.busy || !this.stream) return;
    this.busy = true;
    this.cancelLoop();
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    const mimeType = types.find((type) => this.MediaRecorderClass.isTypeSupported(type)) || '';
    const chunks = [];
    try {
      this.recorder = new this.MediaRecorderClass(this.stream, mimeType ? { mimeType } : undefined);
    } catch {
      this.busy = false;
      this.emit(ANGER_MONITOR_STATE.ERROR, { message: '녹음을 시작할 수 없습니다.' });
      return;
    }
    const generation = this.generation;
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size > 0) chunks.push(event.data);
    });
    this.recorder.addEventListener('stop', async () => {
      this.clearTimer(this.recordingTimer);
      this.cancelLoop();
      this.recorder = null;
      if (generation !== this.generation) return;
      const audio = new Blob(chunks, { type: mimeType || 'audio/webm' });
      this.emit(ANGER_MONITOR_STATE.ANALYZING);
      this.analysisController = new AbortController();
      try {
        const result = await this.analyze(audio, this.randomUuid(), this.analysisController.signal);
        if (generation !== this.generation) return;
        this.busy = false;
        this.analysisController = null;
        if (this.keepStream) this.suspendMedia();
        else this.releaseMedia();
        this.emit(result.detected ? ANGER_MONITOR_STATE.DETECTED : ANGER_MONITOR_STATE.NOT_DETECTED, { result });
      } catch (error) {
        if (generation !== this.generation || error?.name === 'AbortError') return;
        this.busy = false;
        this.analysisController = null;
        if (this.keepStream) this.suspendMedia();
        else this.releaseMedia();
        const messages = {
          PLAYBACK_NOT_READY: 'YouTube 재생 화면을 먼저 준비해 주세요.',
          PLAYER_OFFLINE: '생활자 재생 화면이 연결되지 않았습니다.',
          PLAYER_BUSY: '생활자 화면에서 콘텐츠를 재생 중입니다.',
          PLAYBACK_UNAVAILABLE: 'YouTube 재생 서버에 연결할 수 없습니다.',
          transcription_failed: '음성을 분석하지 못했습니다. 다시 시도해 주세요.',
          transcription_unavailable: '음성을 분석하지 못했습니다. 다시 시도해 주세요.',
        };
        this.emit(ANGER_MONITOR_STATE.ERROR, {
          code: error?.code,
          message: messages[error?.code] || error.message || '분노 감지 요청에 실패했습니다.',
        });
      }
    });
    this.state = ANGER_MONITOR_STATE.RECORDING;
    this.startAudioLoop();
    this.emit(ANGER_MONITOR_STATE.RECORDING);
    this.recorder.start(250);
    this.recordingTimer = this.setTimer(() => {
      if (this.recorder?.state === 'recording') this.recorder.stop();
    }, ANGER_RECORDING_DURATION_MS);
  }

  async resume() {
    if (![ANGER_MONITOR_STATE.NOT_DETECTED, ANGER_MONITOR_STATE.ERROR,
      ANGER_MONITOR_STATE.DETECTED, ANGER_MONITOR_STATE.STOPPING_PLAYBACK,
      ANGER_MONITOR_STATE.PLAYER_CHECKING, ANGER_MONITOR_STATE.PLAYER_NOT_READY,
      ANGER_MONITOR_STATE.READY_TO_START]
      .includes(this.state)) return;
    await this.start();
  }

  beginPlaybackStop() {
    this.releaseMedia();
    this.emit(ANGER_MONITOR_STATE.STOPPING_PLAYBACK);
  }

  reportError(message, code) {
    this.releaseMedia();
    this.emit(ANGER_MONITOR_STATE.ERROR, { message, code });
  }

  blockForPlayer(message = 'YouTube 재생 화면을 먼저 준비해 주세요.') {
    if (this.state === ANGER_MONITOR_STATE.PLAYER_NOT_READY
        && this.blockedMessage === message && !this.stream && !this.recorder) return;
    this.releaseResources();
    this.blockedMessage = message;
    this.emit(ANGER_MONITOR_STATE.PLAYER_NOT_READY, { message });
  }

  waitForPlayer(message = '생활자 재생 화면 상태를 확인하고 있습니다.') {
    if (this.state === ANGER_MONITOR_STATE.PLAYER_CHECKING
        && this.blockedMessage === message && !this.stream && !this.recorder) return;
    this.releaseResources();
    this.blockedMessage = message;
    this.emit(ANGER_MONITOR_STATE.PLAYER_CHECKING, { message });
  }

  readyForDetection() {
    this.releaseResources();
    this.emit(ANGER_MONITOR_STATE.READY_TO_START);
  }

  cancelLoop() {
    if (this.measurementTimer !== undefined) {
      this.clearMeasurementTimer(this.measurementTimer);
    }
    this.measurementTimer = undefined;
    this.publishDiagnostics();
  }

  suspendMedia({ preserveAnalysis = false } = {}) {
    this.cancelLoop();
    this.clearTimer(this.recordingTimer);
    if (!preserveAnalysis) {
      this.generation += 1;
      this.analysisController?.abort();
      this.analysisController = null;
    }
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = null;
    this.busy = false;
    this.aboveSince = null;
    this.lastLevelAt = null;
    this.onLevel?.(null);
    if (this.audioTrack?.readyState === 'live') this.audioTrack.enabled = false;
    this.publishDiagnostics();
  }

  releaseMedia() {
    this.cancelLoop();
    this.clearTimer(this.recordingTimer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = null;
    if (this.audioTrack?.removeEventListener && this.trackEndedHandler) {
      this.audioTrack.removeEventListener('ended', this.trackEndedHandler);
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.audioTrack = null;
    this.trackEndedHandler = null;
    this.analyser?.disconnect?.();
    this.analyser = null;
    this.audioContext?.close?.().catch?.(() => {});
    this.audioContext = null;
    this.busy = false;
    this.aboveSince = null;
    this.lastLevelAt = null;
    this.lastRms = 0;
    this.lastDb = -Infinity;
    this.onLevel?.(null);
    this.publishDiagnostics();
  }

  releaseResources() {
    this.generation += 1;
    this.analysisController?.abort();
    this.analysisController = null;
    this.releaseMedia();
  }

  stop() {
    this.releaseResources();
    this.emit(ANGER_MONITOR_STATE.OFF);
  }
}
