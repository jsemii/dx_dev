import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PlaybackGateway } from '../src/services/playbackGateway.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close'); }
  receive(message) { this.emit('message', JSON.stringify(message)); }
}

const content = {
  contentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  contentUrl: 'https://www.youtube.com/watch?v=rFjRsWPGZxY',
};

function readyGateway(options = {}) {
  const gateway = new PlaybackGateway(options);
  const socket = new FakeSocket();
  gateway.attach(socket, 'home_23');
  socket.receive({ type: 'REGISTER', home_id: 'home_23' });
  socket.receive({ type: 'READY' });
  return { gateway, socket };
}

test('생활자별 READY를 분리하고 준비 전 STT 차단용 상태를 제공한다', async () => {
  const { gateway } = readyGateway();
  assert.equal(gateway.getStatus('home_23').ready, true);
  assert.equal(gateway.getStatus('home_24').ready, false);
  await assert.rejects(gateway.assertReady('home_24'), (error) => error.code === 'PLAYER_OFFLINE');
});

test('PLAY을 보내고 PLAYING ACK 뒤에만 완료한다', async () => {
  const { gateway, socket } = readyGateway();
  const requestId = '11111111-1111-4111-8111-111111111111';
  const pending = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  const play = socket.sent.find((message) => message.type === 'PLAY');
  assert.equal(play.video_id, 'rFjRsWPGZxY');
  assert.equal(play.home_id, 'home_23');
  socket.receive({ type: 'PLAYING', request_id: requestId });
  assert.deepEqual(await pending, { requestId });
  assert.equal(gateway.getStatus('home_23').busy, true);
  socket.receive({ type: 'ENDED', request_id: requestId });
  assert.equal(gateway.getStatus('home_23').ready, true);
});

test('재생 중 새 요청은 PLAYER_BUSY, 동일 ID는 중복으로 거부한다', async () => {
  const { gateway, socket } = readyGateway();
  const firstId = '11111111-1111-4111-8111-111111111111';
  const pending = gateway.requestPlayback({ homeId: 'home_23', content, requestId: firstId });
  await new Promise(setImmediate);
  socket.receive({ type: 'PLAYING', request_id: firstId });
  await pending;
  await assert.rejects(
    gateway.requestPlayback({ homeId: 'home_23', content, requestId: '22222222-2222-4222-8222-222222222222' }),
    (error) => error.code === 'PLAYER_BUSY',
  );
  await assert.rejects(
    gateway.requestPlayback({ homeId: 'home_23', content, requestId: firstId }),
    (error) => error.code === 'DUPLICATE_PLAYBACK_REQUEST',
  );
});

test('PLAYING ACK가 없으면 안전하게 timeout 처리한다', async () => {
  const { gateway } = readyGateway({ ackTimeoutMs: 5 });
  await assert.rejects(
    gateway.requestPlayback({
      homeId: 'home_23', content, requestId: '33333333-3333-4333-8333-333333333333',
    }),
    (error) => error.code === 'PLAYBACK_ACK_TIMEOUT',
  );
});

test('ENDED 뒤 새 request_id로 같은 영상을 다시 0초 명령으로 보낸다', async () => {
  const { gateway, socket } = readyGateway();
  const ids = [
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
  ];
  for (const requestId of ids) {
    const pending = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
    await new Promise(setImmediate);
    socket.receive({ type: 'PLAYING', request_id: requestId });
    await pending;
    socket.receive({ type: 'ENDED', request_id: requestId });
  }
  const plays = socket.sent.filter((message) => message.type === 'PLAY');
  assert.deepEqual(plays.map((message) => message.request_id), ids);
  assert.deepEqual(plays.map((message) => message.video_id), ['rFjRsWPGZxY', 'rFjRsWPGZxY']);
  assert.equal(gateway.getStatus('home_23').ready, true);
});
