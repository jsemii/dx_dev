export class SessionResultCache {
  constructor(ttlMs = 5 * 60_000) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  run(sessionId, operation) {
    const existing = this.entries.get(sessionId);
    if (existing && existing.expiresAt > Date.now()) return existing.promise;
    const promise = Promise.resolve().then(operation);
    const entry = { promise, expiresAt: Date.now() + this.ttlMs };
    this.entries.set(sessionId, entry);
    const timer = setTimeout(() => {
      if (this.entries.get(sessionId) === entry) this.entries.delete(sessionId);
    }, this.ttlMs);
    timer.unref?.();
    return promise;
  }

  clear() {
    this.entries.clear();
  }
}
