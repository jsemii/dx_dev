import test from 'node:test';
import assert from 'node:assert/strict';
import { SinglePlayerSocket } from './singlePlayerSocket.mjs';

class FakeWebSocket {
  constructor() {
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
  }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  emit(name, event = {}) {
    if (name === 'open') this.readyState = 1;
    if (name === 'close') this.readyState = 3;
    for (const listener of this.listeners.get(name) || []) listener(event);
  }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.emit('close', { code: 1000 }); }
}

function socketHarness() {
  const sockets = [];
  const messages = [];
  const timers = [];
  const manager = new SinglePlayerSocket({
    createSocket: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
    onMessage: (event, socket, generation) => messages.push({ event, socket, generation }),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { if (timer) timer.cleared = true; },
  });
  return { manager, sockets, messages, timers };
}

test('CONNECTING 또는 OPEN 상태에서는 WebSocket을 하나만 생성한다', async () => {
  const harness = socketHarness();
  const first = harness.manager.connect();
  const second = harness.manager.connect();
  assert.equal(first, second);
  assert.equal(harness.sockets.length, 1);
  harness.sockets[0].emit('open');
  assert.equal(await first, harness.sockets[0]);
  assert.equal(await harness.manager.connect(), harness.sockets[0]);
  assert.equal(harness.sockets.length, 1);
});

test('메시지는 현재 세대의 동일 소켓과 함께 전달되고 오래된 이벤트는 무시한다', async () => {
  const harness = socketHarness();
  const firstConnect = harness.manager.connect();
  const first = harness.sockets[0];
  first.emit('open');
  await firstConnect;
  first.emit('message', { data: 'first' });
  assert.equal(harness.messages[0].socket, first);

  first.readyState = 3;
  const secondConnect = harness.manager.connect();
  const second = harness.sockets[1];
  second.emit('open');
  await secondConnect;
  first.emit('message', { data: 'stale' });
  second.emit('message', { data: 'active' });
  assert.deepEqual(harness.messages.map(({ event }) => event.data), ['first', 'active']);
  assert.equal(harness.messages.at(-1).socket, second);
});

test('dispose는 소켓·리스너·재연결 타이머를 완전히 정리한다', async () => {
  const harness = socketHarness();
  const connecting = harness.manager.connect();
  const socket = harness.sockets[0];
  socket.emit('open');
  await connecting;
  let reconnected = 0;
  harness.manager.scheduleReconnect(() => { reconnected += 1; }, 2_000);
  harness.manager.dispose();
  assert.equal(socket.readyState, 3);
  const reconnectTimer = harness.timers.find((timer) => timer.delay === 2_000);
  assert.equal(reconnectTimer.cleared, true);
  reconnectTimer.callback();
  assert.equal(reconnected, 0);
  assert.equal(harness.manager.socket, null);
});
