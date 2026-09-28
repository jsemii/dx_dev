const CONNECTING = 0;
const OPEN = 1;

export class SinglePlayerSocket {
  constructor({
    createSocket,
    onOpen,
    onMessage,
    onClose,
    onError,
    setTimer = globalThis.setTimeout.bind(globalThis),
    clearTimer = globalThis.clearTimeout.bind(globalThis),
    connectTimeoutMs = 8_000,
  }) {
    this.createSocket = createSocket;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.onError = onError;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.connectTimeoutMs = connectTimeoutMs;
    this.generation = 0;
    this.socket = null;
    this.connectPromise = null;
    this.connectReject = null;
    this.connectTimeout = null;
    this.listeners = null;
    this.reconnectTimer = null;
    this.disposed = false;
  }

  isActive(socket, generation) {
    return !this.disposed && this.socket === socket && this.generation === generation;
  }

  connect() {
    if (this.disposed) return Promise.reject(new Error('재생 연결이 종료되었습니다.'));
    if (this.socket && [CONNECTING, OPEN].includes(this.socket.readyState)) {
      return this.connectPromise || Promise.resolve(this.socket);
    }
    this.cancelReconnect();
    this.closeCurrent();
    const generation = ++this.generation;
    const socket = this.createSocket();
    this.socket = socket;
    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timeout = this.setTimer(() => {
        if (!this.isActive(socket, generation)) return;
        settled = true;
        this.removeListeners(socket);
        this.socket = null;
        this.connectPromise = null;
        this.connectReject = null;
        this.connectTimeout = null;
        socket.close();
        reject(new Error('재생 서버 연결 시간이 초과되었습니다.'));
      }, this.connectTimeoutMs);
      this.connectReject = reject;
      this.connectTimeout = timeout;
      const listeners = {
        open: () => {
          if (!this.isActive(socket, generation)) return;
          this.clearTimer(timeout);
          settled = true;
          this.connectReject = null;
          this.connectTimeout = null;
          this.onOpen?.(socket, generation);
          resolve(socket);
        },
        message: (event) => {
          if (this.isActive(socket, generation)) this.onMessage?.(event, socket, generation);
        },
        error: (event) => {
          if (!this.isActive(socket, generation)) return;
          this.onError?.(event, socket, generation);
          if (!settled) {
            this.clearTimer(timeout);
            settled = true;
            this.removeListeners(socket);
            this.socket = null;
            this.connectPromise = null;
            this.connectReject = null;
            this.connectTimeout = null;
            socket.close();
            reject(new Error('재생 서버에 연결할 수 없습니다.'));
          }
        },
        close: (event) => {
          if (!this.isActive(socket, generation)) return;
          this.clearTimer(timeout);
          this.removeListeners(socket);
          this.socket = null;
          this.connectPromise = null;
          this.connectReject = null;
          this.connectTimeout = null;
          if (!settled) {
            settled = true;
            reject(new Error('재생 서버 연결이 종료되었습니다.'));
          }
          this.onClose?.(event, socket, generation);
        },
      };
      this.listeners = { socket, listeners };
      for (const [name, listener] of Object.entries(listeners)) {
        socket.addEventListener(name, listener);
      }
    });
    return this.connectPromise;
  }

  send(payload, target = this.socket) {
    if (!target || target !== this.socket || target.readyState !== OPEN) return false;
    target.send(JSON.stringify(payload));
    return true;
  }

  scheduleReconnect(callback, delayMs) {
    if (this.disposed || this.reconnectTimer !== null) return;
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      if (!this.disposed) callback();
    }, delayMs);
  }

  cancelReconnect() {
    if (this.reconnectTimer !== null) this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  removeListeners(socket) {
    if (this.listeners?.socket !== socket) return;
    for (const [name, listener] of Object.entries(this.listeners.listeners)) {
      socket.removeEventListener(name, listener);
    }
    this.listeners = null;
  }

  closeCurrent() {
    const socket = this.socket;
    if (!socket) return;
    const reject = this.connectReject;
    this.generation += 1;
    if (this.connectTimeout !== null) this.clearTimer(this.connectTimeout);
    this.removeListeners(socket);
    this.socket = null;
    this.connectPromise = null;
    this.connectReject = null;
    this.connectTimeout = null;
    if ([CONNECTING, OPEN].includes(socket.readyState)) socket.close();
    reject?.(new Error('이전 재생 서버 연결이 교체되었습니다.'));
  }

  dispose() {
    this.disposed = true;
    this.cancelReconnect();
    this.closeCurrent();
  }
}
