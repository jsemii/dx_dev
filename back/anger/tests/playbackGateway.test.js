import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PlaybackGateway } from '../src/services/playbackGateway.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code, reason) { this.closeCode = code; this.closeReason = reason; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(1006, 'terminated'); }
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

test('새 Player가 REGISTER만 한 동안에는 기존 READY Player를 유지한다', async () => {
  const gateway = new PlaybackGateway();
  const first = new FakeSocket();
  const second = new FakeSocket();
  gateway.attach(first, 'home_23');
  first.receive({ type: 'REGISTER', home_id: 'home_23' });
  first.receive({ type: 'READY' });
  gateway.attach(second, 'home_23');
  second.receive({ type: 'REGISTER', home_id: 'home_23' });

  assert.equal(first.closeCode, undefined);
  assert.deepEqual(gateway.getStatus('home_23'), {
    ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false,
  });
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  const pending = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  assert.equal(first.sent.some((message) => message.type === 'PLAY'), true);
  assert.equal(second.sent.some((message) => message.type === 'PLAY'), false);
  first.receive({ type: 'PLAYING', request_id: requestId });
  await pending;
  first.receive({ type: 'ENDED', request_id: requestId });
});

test('같은 생활자의 가장 최근 READY Player가 활성화되고 이전 close는 새 연결을 지우지 않는다', () => {
  const gateway = new PlaybackGateway();
  const first = new FakeSocket();
  const second = new FakeSocket();
  gateway.attach(first, 'home_23');
  first.receive({ type: 'REGISTER', home_id: 'home_23' });
  first.receive({ type: 'READY' });
  gateway.attach(second, 'home_23');
  second.receive({ type: 'REGISTER', home_id: 'home_23' });
  assert.equal(first.closeCode, undefined);
  second.receive({ type: 'READY' });

  assert.equal(first.closeCode, 4001);
  assert.equal(first.closeReason, 'replaced by ready player');
  assert.deepEqual(gateway.getStatus('home_23'), {
    ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false,
  });
  first.emit('close');
  assert.equal(gateway.getStatus('home_23').connectedPlayers, 1);
  assert.equal(gateway.getStatus('home_23').readyPlayers, 1);
});

test('여러 후보 중 READY를 가장 나중에 보낸 Player가 항상 우선권을 갖는다', () => {
  const gateway = new PlaybackGateway();
  const first = new FakeSocket();
  const second = new FakeSocket();
  const third = new FakeSocket();
  for (const socket of [first, second, third]) {
    gateway.attach(socket, 'home_23');
    socket.receive({ type: 'REGISTER', home_id: 'home_23' });
  }

  first.receive({ type: 'READY' });
  assert.equal(second.closeCode, undefined);
  assert.equal(third.closeCode, undefined);
  third.receive({ type: 'READY' });
  assert.equal(first.closeCode, 4001);
  assert.equal(second.closeCode, undefined);
  second.receive({ type: 'READY' });
  assert.equal(third.closeCode, 4001);
  assert.deepEqual(gateway.getStatus('home_23'), {
    ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false,
  });
});

test('준비되지 않은 새 Player가 연결 종료돼도 기존 READY Player에 영향이 없다', () => {
  const { gateway, socket: active } = readyGateway();
  const candidate = new FakeSocket();
  gateway.attach(candidate, 'home_23');
  candidate.receive({ type: 'REGISTER', home_id: 'home_23' });
  candidate.close(1000, 'setup cancelled');

  assert.equal(active.closeCode, undefined);
  assert.deepEqual(gateway.getStatus('home_23'), {
    ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false,
  });
});

test('PLAY 명령과 ACK는 활성 소켓 및 동일 request_id에만 결합한다', async () => {
  const gateway = new PlaybackGateway();
  const stale = new FakeSocket();
  const active = new FakeSocket();
  gateway.attach(stale, 'home_23');
  stale.receive({ type: 'REGISTER', home_id: 'home_23' });
  stale.receive({ type: 'READY' });
  gateway.attach(active, 'home_23');
  active.receive({ type: 'REGISTER', home_id: 'home_23' });
  active.receive({ type: 'READY' });
  const requestId = '66666666-6666-4666-8666-666666666666';
  const pending = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);

  assert.equal(stale.sent.some((message) => message.type === 'PLAY'), false);
  assert.equal(active.sent.some((message) => message.type === 'PLAY'), true);
  stale.receive({ type: 'PLAYING', request_id: requestId });
  assert.equal(gateway.getStatus('home_23').busy, true);
  active.receive({ type: 'PLAYING', request_id: '77777777-7777-4777-8777-777777777777' });
  assert.equal(gateway.getStatus('home_23').busy, true);
  active.receive({ type: 'PLAYING', request_id: requestId });
  assert.deepEqual(await pending, { requestId });
});

test('STOP은 STOPPED ACK 뒤 READY로 복귀하고 READY에서는 멱등 성공한다', async () => {
  const { gateway, socket } = readyGateway();
  const requestId = '88888888-8888-4888-8888-888888888888';
  const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  socket.receive({ type: 'PLAYING', request_id: requestId });
  await playing;

  const stopping = gateway.stopPlayback('home_23');
  await new Promise(setImmediate);
  assert.deepEqual(socket.sent.find((message) => message.type === 'STOP'), {
    type: 'STOP', request_id: requestId, home_id: 'home_23',
  });
  socket.receive({ type: 'STOPPED', request_id: requestId });
  assert.deepEqual(await stopping, { stopped: true, ready: true });
  assert.deepEqual(gateway.getStatus('home_23'), {
    ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false,
  });
  assert.deepEqual(await gateway.stopPlayback('home_23'), { stopped: false, ready: true });
});

test('STOP timeout은 BUSY와 현재 요청을 정리한다', async () => {
  const { gateway, socket } = readyGateway({ ackTimeoutMs: 5 });
  const requestId = '99999999-9999-4999-8999-999999999999';
  const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  socket.receive({ type: 'PLAYING', request_id: requestId });
  await playing;
  await assert.rejects(gateway.stopPlayback('home_23'), (error) => error.code === 'PLAYBACK_STOP_TIMEOUT');
  assert.equal(gateway.getStatus('home_23').busy, false);
  assert.equal(gateway.getStatus('home_23').ready, false);
});

test('PLAY → STOP → READY 흐름을 새 request_id로 3회 반복한다', async () => {
  const { gateway, socket } = readyGateway();
  const ids = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  ];
  for (const requestId of ids) {
    const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
    await new Promise(setImmediate);
    socket.receive({ type: 'PLAYING', request_id: requestId });
    await playing;
    const stopping = gateway.stopPlayback('home_23');
    await new Promise(setImmediate);
    socket.receive({ type: 'STOPPED', request_id: requestId });
    await stopping;
    assert.deepEqual(gateway.getStatus('home_23'), {
      ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false,
    });
  }
  assert.deepEqual(
    socket.sent.filter((message) => message.type === 'PLAY').map((message) => message.request_id), ids,
  );
  assert.equal(socket.sent.filter((message) => message.type === 'STOP').length, 3);
});
