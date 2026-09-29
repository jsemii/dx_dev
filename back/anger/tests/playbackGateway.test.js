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

test('STOP 대기 중 READY heartbeat만으로 마이크 재개 조건을 충족하지 않는다', async () => {
  const { gateway, socket } = readyGateway();
  const requestId = '88888888-8888-4888-8888-888888888887';
  const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  socket.receive({ type: 'PLAYING', request_id: requestId });
  await playing;

  let resolved = false;
  const stopping = gateway.stopPlayback('home_23').then((result) => {
    resolved = true;
    return result;
  });
  socket.receive({ type: 'PONG', player_state: 'READY', request_id: null });
  await new Promise(setImmediate);
  assert.equal(resolved, false);
  assert.equal(gateway.getStatus('home_23').busy, true);
  socket.receive({ type: 'STOPPED', request_id: requestId });
  assert.deepEqual(await stopping, { stopped: true, ready: true });
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

test('PONG의 실제 Player 상태로 READY와 BUSY를 재동기화한다', async () => {
  const { gateway, socket } = readyGateway();
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);

  socket.receive({ type: 'PONG', player_state: 'PLAYING', request_id: requestId });
  assert.deepEqual(await playing, { requestId });
  assert.equal(gateway.getStatus('home_23').busy, true);

  socket.receive({ type: 'PONG', player_state: 'ENDED', request_id: requestId });
  assert.deepEqual(gateway.getStatus('home_23'), {
    ready: true, readyPlayers: 1, connectedPlayers: 1, busy: false,
  });
});

test('상태 heartbeat가 계속 오면 PLAYING BUSY를 유지하고 지연된 이전 상태는 무시한다', async () => {
  let now = 1_000;
  const { gateway, socket } = readyGateway({
    now: () => now,
    stateHeartbeatTimeoutMs: 45_000,
    connectionTimeoutMs: 120_000,
  });
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';
  const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  socket.receive({ type: 'PLAYING', request_id: requestId });
  await playing;

  now += 30_000;
  socket.receive({ type: 'PONG', player_state: 'PLAYING', request_id: requestId });
  socket.receive({
    type: 'PONG', player_state: 'READY',
    request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
  });
  now += 30_000;
  gateway.heartbeat();
  assert.equal(socket.closeCode, undefined);
  assert.equal(gateway.getStatus('home_23').busy, true);
});

test('WebSocket 재연결 시 REGISTER의 실제 PLAYING 상태를 복구한다', async () => {
  const { gateway, socket } = readyGateway();
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  socket.receive({ type: 'PLAYING', request_id: requestId });
  await playing;

  const reconnected = new FakeSocket();
  gateway.attach(reconnected, 'home_23');
  reconnected.receive({
    type: 'REGISTER', home_id: 'home_23', player_state: 'PLAYING', request_id: requestId,
  });
  assert.equal(gateway.getStatus('home_23').busy, true);
  socket.close(1006, 'network changed');
  assert.equal(gateway.getStatus('home_23').connectedPlayers, 0);
  reconnected.receive({ type: 'PONG', player_state: 'PLAYING', request_id: requestId });
  assert.deepEqual(gateway.getStatus('home_23'), {
    ready: false, readyPlayers: 0, connectedPlayers: 1, busy: true,
  });
});

test('PLAYING 상태 heartbeat가 끊기면 BUSY를 해제하고 소켓을 종료한다', async () => {
  let now = 1_000;
  const logs = [];
  const { gateway, socket } = readyGateway({
    now: () => now,
    stateHeartbeatTimeoutMs: 45_000,
    connectionTimeoutMs: 120_000,
    logger: { info(_message, fields) { logs.push(fields); } },
  });
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  socket.receive({ type: 'PLAYING', request_id: requestId });
  await playing;

  now += 45_001;
  gateway.heartbeat();
  assert.equal(socket.closeCode, 4002);
  assert.equal(socket.closeReason, 'player state heartbeat timeout');
  assert.deepEqual(gateway.getStatus('home_23'), {
    ready: false, readyPlayers: 0, connectedPlayers: 0, busy: false,
  });
  assert.equal(logs.some((entry) => entry.event === 'TIMEOUT'
    && entry.reason === 'PLAYING_STATE_HEARTBEAT_TIMEOUT'
    && entry.request_id === requestId), true);
});

test('구조화 로그는 상태 전환 식별자와 경과 시간만 기록한다', async () => {
  let now = 10_000;
  const logs = [];
  const { gateway, socket } = readyGateway({
    now: () => now,
    logger: { info(message, fields) { logs.push({ message, fields }); } },
  });
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
  const playing = gateway.requestPlayback({ homeId: 'home_23', content, requestId });
  await new Promise(setImmediate);
  now += 25;
  socket.receive({ type: 'PLAYING', request_id: requestId });
  await playing;
  const stopping = gateway.stopPlayback('home_23');
  await new Promise(setImmediate);
  now += 30;
  socket.receive({ type: 'STOPPED', request_id: requestId });
  await stopping;

  const endedRequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
  const ending = gateway.requestPlayback({
    homeId: 'home_23', content, requestId: endedRequestId,
  });
  await new Promise(setImmediate);
  socket.receive({ type: 'PLAYING', request_id: endedRequestId });
  await ending;
  now += 40;
  socket.receive({ type: 'ENDED', request_id: endedRequestId });

  const events = logs.map(({ fields }) => fields.event);
  for (const event of ['REGISTER', 'READY', 'PLAY', 'PLAYING', 'ENDED', 'STOP', 'STOPPED']) {
    assert.equal(events.includes(event), true, `${event} 로그가 필요합니다.`);
  }
  for (const { message, fields } of logs) {
    assert.equal(message, 'Playback gateway event');
    assert.equal(typeof fields.connection_id, 'string');
    assert.equal(Number.isFinite(fields.elapsed_ms), true);
    assert.equal('request_id' in fields, true);
    assert.deepEqual(Object.keys(fields).sort(), [
      'connection_id', 'elapsed_ms', 'event', 'home_id', 'reason', 'request_id',
    ]);
  }
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /youtube\.com|OPENAI|DATABASE_URL|transcript|pairing/i);
});

test('원격 START/STOP 감지는 활성 Player의 동일 소켓과 command_id에 결합한다', async () => {
  const { gateway, socket } = readyGateway();
  socket.receive({
    type: 'PONG', player_state: 'READY', request_id: null,
    detection_state: 'READY', microphone_ready: true, detection_requested: false,
  });
  const starting = gateway.startDetection('home_23');
  await new Promise(setImmediate);
  const start = socket.sent.find((message) => message.type === 'START_DETECTION');
  assert.equal(start.home_id, 'home_23');
  socket.receive({
    type: 'DETECTION_STARTED', command_id: start.command_id,
    detection_state: 'DETECTING', microphone_ready: true, detection_requested: true,
  });
  assert.equal((await starting).state, 'DETECTING');
  assert.equal(gateway.getDetailedStatus('home_23').detectionRequested, true);

  const stopping = gateway.stopDetection('home_23');
  await new Promise(setImmediate);
  const stop = socket.sent.find((message) => message.type === 'STOP_DETECTION');
  socket.receive({
    type: 'DETECTION_STOPPED', command_id: stop.command_id,
    detection_state: 'READY', microphone_ready: true, detection_requested: false,
  });
  assert.equal((await stopping).state, 'READY');
  assert.equal(gateway.getDetailedStatus('home_23').detectionState, 'READY');
  assert.equal(gateway.getDetailedStatus('home_23').detectionRequested, false);
});

test('교체된 Player의 지연된 감지 ACK는 현재 Player 상태를 오염시키지 않는다', async () => {
  const gateway = new PlaybackGateway({ ackTimeoutMs: 20 });
  const oldSocket = new FakeSocket();
  const newSocket = new FakeSocket();
  gateway.attach(oldSocket, 'home_23');
  oldSocket.receive({ type: 'REGISTER', home_id: 'home_23', microphone_ready: true });
  oldSocket.receive({ type: 'READY', microphone_ready: true, detection_state: 'READY' });
  gateway.attach(newSocket, 'home_23');
  newSocket.receive({ type: 'REGISTER', home_id: 'home_23', microphone_ready: true });
  newSocket.receive({ type: 'READY', microphone_ready: true, detection_state: 'READY' });
  assert.equal(oldSocket.closeCode, 4001);

  const starting = gateway.startDetection('home_23');
  await new Promise(setImmediate);
  const start = newSocket.sent.find((message) => message.type === 'START_DETECTION');
  oldSocket.receive({
    type: 'DETECTION_STARTED', command_id: start.command_id,
    detection_state: 'DETECTING', microphone_ready: true, detection_requested: true,
  });
  assert.equal(gateway.getDetailedStatus('home_23').detectionState, 'PREPARING');
  assert.equal(gateway.getDetailedStatus('home_23').detectionRequested, true);
  newSocket.receive({
    type: 'DETECTION_STARTED', command_id: start.command_id,
    detection_state: 'DETECTING', microphone_ready: true, detection_requested: true,
  });
  await starting;
  assert.equal(gateway.getStatus('home_23').connectedPlayers, 1);
  assert.equal(gateway.getDetailedStatus('home_23').detectionRequested, true);
});

test('DETECTION_STARTED ACK가 READY이면 실패하고 READY+requested를 남기지 않는다', async () => {
  const { gateway, socket } = readyGateway();
  socket.receive({
    type: 'PONG', player_state: 'READY', request_id: null,
    detection_state: 'READY', microphone_ready: true, detection_requested: false,
  });
  const starting = gateway.startDetection('home_23');
  await new Promise(setImmediate);
  const start = socket.sent.find((message) => message.type === 'START_DETECTION');
  socket.receive({
    type: 'PONG', player_state: 'READY', request_id: null,
    detection_state: 'READY', microphone_ready: true, detection_requested: false,
  });
  assert.equal(gateway.getDetailedStatus('home_23').detectionState, 'PREPARING');
  assert.equal(gateway.getDetailedStatus('home_23').detectionRequested, true);
  socket.receive({
    type: 'DETECTION_STARTED', command_id: start.command_id,
    detection_state: 'READY', microphone_ready: true, detection_requested: true,
  });
  await assert.rejects(starting, (error) => error.code === 'INVALID_DETECTION_STARTED_ACK');
  const status = gateway.getDetailedStatus('home_23');
  assert.equal(status.detectionState, 'ERROR');
  assert.equal(status.detectionRequested, false);
});

test('감지 시작 뒤 stale READY heartbeat가 DETECTING을 덮어쓰지 않는다', async () => {
  const { gateway, socket } = readyGateway();
  socket.receive({
    type: 'PONG', player_state: 'READY', request_id: null,
    detection_state: 'READY', microphone_ready: true, detection_requested: false,
  });
  const starting = gateway.startDetection('home_23');
  await new Promise(setImmediate);
  const start = socket.sent.find((message) => message.type === 'START_DETECTION');
  socket.receive({
    type: 'DETECTION_STARTED', command_id: start.command_id,
    detection_state: 'DETECTING', microphone_ready: true, detection_requested: true,
  });
  await starting;
  socket.receive({
    type: 'PONG', player_state: 'READY', request_id: null,
    detection_state: 'READY', microphone_ready: true, detection_requested: true,
  });
  const status = gateway.getDetailedStatus('home_23');
  assert.equal(status.detectionState, 'DETECTING');
  assert.equal(status.detectionRequested, true);
});

test('Player 교체 후 새 활성 연결에서 START가 성공한다', async () => {
  const gateway = new PlaybackGateway();
  const first = new FakeSocket();
  const second = new FakeSocket();
  gateway.attach(first, 'home_23');
  first.receive({ type: 'REGISTER', home_id: 'home_23', microphone_ready: true });
  first.receive({ type: 'READY', detection_state: 'READY', microphone_ready: true,
    detection_requested: false });
  gateway.attach(second, 'home_23');
  second.receive({ type: 'REGISTER', home_id: 'home_23', microphone_ready: true });
  second.receive({ type: 'READY', detection_state: 'READY', microphone_ready: true,
    detection_requested: false });
  assert.equal(first.closeCode, 4001);
  const starting = gateway.startDetection('home_23');
  await new Promise(setImmediate);
  const command = second.sent.find((message) => message.type === 'START_DETECTION');
  assert.equal(first.sent.some((message) => message.type === 'START_DETECTION'), false);
  second.receive({ type: 'DETECTION_STARTED', command_id: command.command_id,
    detection_state: 'DETECTING', microphone_ready: true, detection_requested: true });
  assert.equal((await starting).state, 'DETECTING');
  assert.equal(gateway.getStatus('home_23').connectedPlayers, 1);
});
