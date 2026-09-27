export const ANGER_MONITOR_STATE = Object.freeze({
  OFF: 'OFF',
  REQUESTING_PERMISSION: 'REQUESTING_PERMISSION',
  LISTENING: 'LISTENING',
  RECORDING: 'RECORDING',
  ANALYZING: 'ANALYZING',
  NOT_DETECTED: 'NOT_DETECTED',
  DETECTED: 'DETECTED',
  ERROR: 'ERROR',
  PLAYER_NOT_READY: 'PLAYER_NOT_READY',
});

export const ANGER_THRESHOLD_DB = -40;
export const ANGER_TRIGGER_DURATION_MS = 300;
export const ANGER_RECORDING_DURATION_MS = 10_000;

export class AngerMonitor {
  constructor({
    analyze,
    onState,
    onLevel,
    mediaDevices = globalThis.navigator?.mediaDevices,
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
    MediaRecorderClass = globalThis.MediaRecorder,
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    setTimer = globalThis.setTimeout.bind(globalThis),
    clearTimer = globalThis.clearTimeout.bind(globalThis),
    now = () => globalThis.performance.now(),
    randomUuid = () => globalThis.crypto.randomUUID(),
  }) {
    this.analyze = analyze;
    this.onState = onState;
    this.onLevel = onLevel;
    this.mediaDevices = mediaDevices;
    this.AudioContextClass = AudioContextClass;
    this.MediaRecorderClass = MediaRecorderClass;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.randomUuid = randomUuid;
    this.generation = 0;
    this.busy = false;
    this.aboveSince = null;
    this.state = ANGER_MONITOR_STATE.OFF;
    this.lastLevelAt = null;
  }

  emit(state, details = {}) {
    this.state = state;
    this.onState?.({ state, ...details });
  }

  async start() {
    if (this.busy || this.state === ANGER_MONITOR_STATE.LISTENING) return;
    const generation = ++this.generation;
    if (!this.mediaDevices?.getUserMedia || !this.AudioContextClass || !this.MediaRecorderClass) {
      this.emit(ANGER_MONITOR_STATE.ERROR, { message: '이 브라우저에서는 마이크 녹음을 사용할 수 없습니다.' });
      return;
    }
    try {
      if (!this.stream || !this.stream.getTracks().some((track) => track.readyState !== 'ended')) {
        this.emit(ANGER_MONITOR_STATE.REQUESTING_PERMISSION);
        const acquiredStream = await this.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
        if (generation !== this.generation) {
          acquiredStream.getTracks().forEach((track) => track.stop());
          return;
        }
        this.stream = acquiredStream;
      }
      if (generation !== this.generation) return;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new this.AudioContextClass();
        await this.audioContext.resume();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.25;
        this.audioContext.createMediaStreamSource(this.stream).connect(this.analyser);
      }
      if (generation !== this.generation) return;
      this.startListening();
    } catch (error) {
      if (generation !== this.generation) return;
      const message = ['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)
        ? '마이크 사용 권한이 필요합니다.'
        : '마이크를 시작하지 못했습니다.';
      this.emit(ANGER_MONITOR_STATE.ERROR, { message });
    }
  }

  startListening() {
    this.busy = false;
    this.aboveSince = null;
    this.emit(ANGER_MONITOR_STATE.LISTENING);
    this.startAudioLoop();
  }

  startAudioLoop() {
    this.cancelLoop();
    const measure = () => {
      if (![ANGER_MONITOR_STATE.LISTENING, ANGER_MONITOR_STATE.RECORDING].includes(this.state)
          || !this.analyser) return;
      const samples = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      const measuredAt = this.now();
      if (this.lastLevelAt === null || measuredAt - this.lastLevelAt >= 80) {
        const level = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 80) / 80)) : 0;
        this.onLevel?.(level);
        this.lastLevelAt = measuredAt;
      }
      if (this.state === ANGER_MONITOR_STATE.LISTENING && db >= ANGER_THRESHOLD_DB) {
        if (this.aboveSince === null) this.aboveSince = this.now();
        if (!this.busy && this.now() - this.aboveSince >= ANGER_TRIGGER_DURATION_MS) {
          this.startRecording();
          return;
        }
      } else if (this.state === ANGER_MONITOR_STATE.LISTENING) {
        this.aboveSince = null;
      }
      this.frameId = this.requestFrame(measure);
    };
    this.frameId = this.requestFrame(measure);
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
        this.emit(result.detected ? ANGER_MONITOR_STATE.DETECTED : ANGER_MONITOR_STATE.NOT_DETECTED, { result });
      } catch (error) {
        if (generation !== this.generation || error?.name === 'AbortError') return;
        this.busy = false;
        this.analysisController = null;
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
    this.emit(ANGER_MONITOR_STATE.RECORDING);
    this.startAudioLoop();
    this.recorder.start(250);
    this.recordingTimer = this.setTimer(() => {
      if (this.recorder?.state === 'recording') this.recorder.stop();
    }, ANGER_RECORDING_DURATION_MS);
  }

  async resume() {
    if (![ANGER_MONITOR_STATE.NOT_DETECTED, ANGER_MONITOR_STATE.ERROR,
      ANGER_MONITOR_STATE.DETECTED, ANGER_MONITOR_STATE.PLAYER_NOT_READY]
      .includes(this.state)) return;
    await this.start();
  }

  blockForPlayer(message = 'YouTube 재생 화면을 먼저 준비해 주세요.') {
    if (this.state === ANGER_MONITOR_STATE.PLAYER_NOT_READY && !this.stream && !this.recorder) return;
    this.releaseResources();
    this.emit(ANGER_MONITOR_STATE.PLAYER_NOT_READY, { message });
  }

  cancelLoop() {
    if (this.frameId !== undefined) this.cancelFrame(this.frameId);
    this.frameId = undefined;
  }

  releaseResources() {
    this.generation += 1;
    this.cancelLoop();
    this.clearTimer(this.recordingTimer);
    this.analysisController?.abort();
    this.analysisController = null;
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser?.disconnect?.();
    this.analyser = null;
    this.audioContext?.close?.().catch?.(() => {});
    this.audioContext = null;
    this.busy = false;
    this.aboveSince = null;
    this.lastLevelAt = null;
    this.onLevel?.(null);
  }

  stop() {
    this.releaseResources();
    this.emit(ANGER_MONITOR_STATE.OFF);
  }
}
