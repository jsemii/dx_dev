import test from 'node:test';
import assert from 'node:assert/strict';
import { closeAngerResources } from '../src/lifecycle.js';

test('Anger 종료는 HTTP 서버를 닫은 뒤 PostgreSQL pool을 종료한다', async () => {
  const order = [];
  const server = {
    close(callback) { order.push('http-close'); callback(); },
    closeAllConnections() { order.push('force-close'); },
  };
  const pool = { async end() { order.push('pool-end'); } };
  await closeAngerResources(server, pool, {
    setTimer() { return 1; },
    clearTimer() { order.push('timer-clear'); },
  });
  assert.deepEqual(order, ['http-close', 'timer-clear', 'pool-end']);
});
