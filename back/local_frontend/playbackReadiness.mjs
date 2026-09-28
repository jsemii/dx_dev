export const PLAYBACK_STATUS_POLL_MS = 1_500;
export const PLAYBACK_STATUS_FAILURE_THRESHOLD = 2;

export class PlaybackReadinessController {
  constructor({
    getStatus,
    onStatus,
    onTransientError,
    onError,
    setIntervalFn = globalThis.setInterval.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval.bind(globalThis),
    pollMs = PLAYBACK_STATUS_POLL_MS,
    failureThreshold = PLAYBACK_STATUS_FAILURE_THRESHOLD,
  }) {
    this.getStatus = getStatus;
    this.onStatus = onStatus;
    this.onTransientError = onTransientError;
    this.onError = onError;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.pollMs = pollMs;
    this.failureThreshold = failureThreshold;
    this.generation = 0;
    this.active = false;
    this.inFlight = null;
    this.consecutiveFailures = 0;
    this.unavailableReported = false;
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
        if (this.active && generation === this.generation) {
          const previousFailures = this.consecutiveFailures;
          const recovered = previousFailures > 0;
          this.consecutiveFailures = 0;
          this.unavailableReported = false;
          this.onStatus?.(status, { recovered, previousFailures });
        }
        return status;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError' && this.active && generation === this.generation) {
          this.consecutiveFailures += 1;
          const details = {
            consecutiveFailures: this.consecutiveFailures,
            failureThreshold: this.failureThreshold,
          };
          if (this.consecutiveFailures < this.failureThreshold) {
            this.onTransientError?.(error, details);
          } else if (!this.unavailableReported) {
            this.unavailableReported = true;
            this.onError?.(error, details);
          }
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
    this.consecutiveFailures = 0;
    this.unavailableReported = false;
    if (this.intervalId !== undefined) this.clearIntervalFn(this.intervalId);
    this.intervalId = undefined;
  }
}
