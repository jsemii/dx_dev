export const PLAYBACK_STATUS_POLL_MS = 1_500;

export class PlaybackReadinessController {
  constructor({
    getStatus,
    onStatus,
    onError,
    setIntervalFn = globalThis.setInterval.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval.bind(globalThis),
    pollMs = PLAYBACK_STATUS_POLL_MS,
  }) {
    this.getStatus = getStatus;
    this.onStatus = onStatus;
    this.onError = onError;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.pollMs = pollMs;
    this.generation = 0;
    this.active = false;
    this.inFlight = null;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.generation += 1;
    void this.poll();
    this.intervalId = this.setIntervalFn(() => void this.poll(), this.pollMs);
  }

  poll() {
    if (!this.active) return Promise.resolve(null);
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    const controller = new AbortController();
    this.requestController = controller;
    this.inFlight = Promise.resolve()
      .then(() => this.getStatus(controller.signal))
      .then((status) => {
        if (this.active && generation === this.generation) this.onStatus?.(status);
        return status;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError' && this.active && generation === this.generation) {
          this.onError?.(error);
        }
        return null;
      })
      .finally(() => {
        if (generation === this.generation) {
          this.inFlight = null;
          this.requestController = null;
        }
      });
    return this.inFlight;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.generation += 1;
    this.requestController?.abort();
    this.requestController = null;
    this.inFlight = null;
    if (this.intervalId !== undefined) this.clearIntervalFn(this.intervalId);
    this.intervalId = undefined;
  }
}
