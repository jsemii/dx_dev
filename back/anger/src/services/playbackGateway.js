import { randomUUID } from 'node:crypto';
import { conflict, unavailable } from '../errors.js';
import { parseYouTubeUrl } from '../validation.js';

const OPEN = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function send(socket, payload) {
  if (socket.readyState !== OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

export class PlaybackGateway {
  constructor({ ackTimeoutMs = 5_000, commandTtlMs = 15_000, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.ackTimeoutMs = ackTimeoutMs;
    this.commandTtlMs = commandTtlMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.players = new Map();
    this.connections = new Map();
    this.seenRequestIds = new Set();
  }

  attach(socket, homeId) {
    const player = {
      connectionId: randomUUID(),
      socket,
      homeId,
      registered: false,
      retired: false,
      ready: false,
      busy: false,
      currentRequestId: null,
      pendingAck: null,
      pendingStop: null,
      lastPongAt: this.now(),
    };
    const connections = this.connections.get(homeId) || new Set();
    connections.add(player);
    this.connections.set(homeId, connections);
    socket.on('message', (raw) => this.handleMessage(player, raw));
    socket.on('close', () => this.detach(player));
    socket.on('error', () => this.detach(player));
    return player;
  }

  rejectPending(player, error) {
    if (player.pendingAck) {
      this.clearTimer(player.pendingAck.timer);
      player.pendingAck.reject(error);
      player.pendingAck = null;
    }
    if (player.pendingStop) {
      this.clearTimer(player.pendingStop.timer);
      player.pendingStop.reject(error);
      player.pendingStop = null;
    }
  }

  retire(player, error = unavailable(
    'PLAYBACK_DISCONNECTED', '생활자 재생 화면 연결이 끊어졌습니다.',
  )) {
    this.rejectPending(player, error);
    player.registered = false;
    player.retired = true;
    player.ready = false;
    player.busy = false;
    player.currentRequestId = null;
  }

  register(player) {
    player.registered = true;
    const active = this.players.get(player.homeId);
    if (!active || !this.isConnected(active)) {
      this.players.set(player.homeId, player);
    }
    send(player.socket, {
      type: 'REGISTERED', home_id: player.homeId, connection_id: player.connectionId,
    });
  }

  promoteReady(player) {
    if (!player.registered || player.retired || player.socket.readyState !== OPEN) return;
    const previous = this.players.get(player.homeId);
    this.players.set(player.homeId, player);
    player.ready = true;
    player.busy = false;
    if (previous && previous !== player) {
      this.retire(previous, unavailable(
        'PLAYBACK_REPLACED', '새 생활자 재생 화면이 준비되었습니다.',
      ));
      previous.socket.close(4001, 'replaced by ready player');
    }
  }

  detach(player) {
    if (this.players.get(player.homeId) === player) this.players.delete(player.homeId);
    const connections = this.connections.get(player.homeId);
    connections?.delete(player);
    if (connections?.size === 0) this.connections.delete(player.homeId);
    this.retire(player);
  }

  isConnected(player) {
    return !player.retired && player.socket.readyState === OPEN;
  }

  isActive(player) {
    return player.registered
      && this.players.get(player.homeId) === player
      && this.isConnected(player);
  }

  finishPlayback(player) {
    if (player.pendingAck) {
      this.clearTimer(player.pendingAck.timer);
      player.pendingAck.resolve({ requestId: player.currentRequestId });
      player.pendingAck = null;
    }
    if (player.pendingStop) {
      this.clearTimer(player.pendingStop.timer);
      player.pendingStop.resolve({ stopped: true, ready: true });
      player.pendingStop = null;
    }
    player.busy = false;
    player.ready = true;
    player.currentRequestId = null;
  }

  handleMessage(player, raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message?.type === 'REGISTER') {
      if (player.retired) {
        player.socket.close(4001, 'connection retired');
        return;
      }
      if (message.home_id !== player.homeId) {
        player.socket.close(1008, 'home mismatch');
        return;
      }
      if (!player.registered) this.register(player);
      else send(player.socket, {
        type: 'REGISTERED', home_id: player.homeId, connection_id: player.connectionId,
      });
      return;
    }
    if (message?.type === 'PONG' && this.isConnected(player)) {
      player.lastPongAt = this.now();
      return;
    }
    if (!player.registered || !this.isConnected(player)) return;
    if (message?.type === 'READY') {
      if (!player.currentRequestId && !player.busy) this.promoteReady(player);
      return;
    }
    if (message?.type === 'NOT_READY') {
      if (!player.busy) player.ready = false;
      return;
    }
    if (!this.isActive(player)) return;
    if (!UUID.test(String(message?.request_id || ''))
        || message.request_id !== player.currentRequestId) return;
    if (message.type === 'PLAYING') {
      player.busy = true;
      player.ready = false;
      if (player.pendingAck) {
        this.clearTimer(player.pendingAck.timer);
        player.pendingAck.resolve({ requestId: message.request_id });
        player.pendingAck = null;
      }
      return;
    }
    if (message.type === 'ENDED' || message.type === 'STOPPED') {
      this.finishPlayback(player);
      return;
    }
    if (message.type === 'FAILED') {
      const playbackError = conflict(
        message.code === 'PLAYER_BUSY' ? 'PLAYER_BUSY' : 'PLAYBACK_FAILED',
        message.code === 'PLAYER_BUSY'
          ? '생활자 화면에서 콘텐츠를 재생 중입니다.'
          : '생활자 화면에서 콘텐츠를 재생할 수 없습니다.',
      );
      this.rejectPending(player, playbackError);
      player.busy = false;
      player.ready = message.code === 'PLAYER_BUSY';
      player.currentRequestId = null;
    }
  }

  getStatus(homeId) {
    const player = this.players.get(homeId);
    const connected = Boolean(player && this.isActive(player));
    const ready = Boolean(connected && player.ready && !player.busy);
    return {
      ready,
      readyPlayers: ready ? 1 : 0,
      connectedPlayers: connected ? 1 : 0,
      busy: Boolean(connected && player.busy),
    };
  }

  async assertReady(homeId) {
    const status = this.getStatus(homeId);
    if (!status.ready) {
      if (status.busy) throw conflict('PLAYER_BUSY', '생활자 화면에서 콘텐츠를 재생 중입니다.');
      if (status.connectedPlayers === 0) {
        throw conflict('PLAYER_OFFLINE', '생활자 재생 화면이 연결되지 않았습니다.');
      }
      throw conflict('PLAYBACK_NOT_READY', '생활자 재생 화면을 먼저 준비해 주세요.');
    }
    return status;
  }

  async requestPlayback({ homeId, content, requestId = randomUUID() }) {
    if (this.seenRequestIds.has(requestId)) {
      throw conflict('DUPLICATE_PLAYBACK_REQUEST', '이미 처리한 재생 요청입니다.');
    }
    const parsed = parseYouTubeUrl(content.contentUrl);
    if (!parsed) throw conflict('invalid_stored_youtube_url', '저장된 YouTube 링크를 재생할 수 없습니다.');
    await this.assertReady(homeId);
    const player = this.players.get(homeId);
    if (!player || !this.isActive(player) || !player.ready || player.busy) {
      throw conflict('PLAYBACK_NOT_READY', '생활자 재생 화면을 먼저 준비해 주세요.');
    }

    const issuedAt = this.now();
    const command = {
      type: 'PLAY', request_id: requestId, home_id: homeId, video_id: parsed.videoId,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(issuedAt + this.commandTtlMs).toISOString(),
    };
    this.seenRequestIds.add(requestId);
    player.ready = false;
    player.busy = true;
    player.currentRequestId = requestId;
    if (!send(player.socket, command)) {
      player.currentRequestId = null;
      player.busy = false;
      throw unavailable('PLAYBACK_DISCONNECTED', '생활자 재생 화면 연결이 끊어졌습니다.');
    }
    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        player.pendingAck = null;
        player.busy = false;
        player.ready = false;
        player.currentRequestId = null;
        reject(unavailable('PLAYBACK_ACK_TIMEOUT', '생활자 화면의 재생 시작을 확인하지 못했습니다.'));
      }, this.ackTimeoutMs);
      timer?.unref?.();
      player.pendingAck = { resolve, reject, timer };
    });
  }

  async stopPlayback(homeId) {
    const player = this.players.get(homeId);
    if (!player || !this.isActive(player)) {
      throw conflict('PLAYER_OFFLINE', '생활자 재생 화면이 연결되지 않았습니다.');
    }
    if (player.ready && !player.busy && !player.currentRequestId) {
      return { stopped: false, ready: true };
    }
    if (!player.busy || !player.currentRequestId) {
      throw conflict('PLAYBACK_NOT_READY', '생활자 재생 화면을 먼저 준비해 주세요.');
    }
    if (player.pendingStop) return player.pendingStop.promise;

    if (player.pendingAck) {
      this.clearTimer(player.pendingAck.timer);
      player.pendingAck.reject(conflict('PLAYBACK_STOPPED', '재생 시작 전에 영상이 중지되었습니다.'));
      player.pendingAck = null;
    }
    const requestId = player.currentRequestId;
    let resolveStop;
    let rejectStop;
    const promise = new Promise((resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
    });
    const timer = this.setTimer(() => {
      if (player.pendingStop?.requestId !== requestId) return;
      player.pendingStop = null;
      player.busy = false;
      player.ready = false;
      player.currentRequestId = null;
      rejectStop(unavailable('PLAYBACK_STOP_TIMEOUT', '생활자 화면의 영상 중지를 확인하지 못했습니다.'));
    }, this.ackTimeoutMs);
    timer?.unref?.();
    player.pendingStop = {
      requestId, resolve: resolveStop, reject: rejectStop, timer, promise,
    };
    if (!send(player.socket, { type: 'STOP', request_id: requestId, home_id: homeId })) {
      this.clearTimer(timer);
      player.pendingStop = null;
      player.busy = false;
      player.ready = false;
      player.currentRequestId = null;
      throw unavailable('PLAYBACK_DISCONNECTED', '생활자 재생 화면 연결이 끊어졌습니다.');
    }
    return promise;
  }

  heartbeat() {
    const players = [...this.connections.values()].flatMap((connections) => [...connections]);
    for (const player of players) {
      if (!this.isConnected(player)) continue;
      const now = this.now();
      if (now - player.lastPongAt > 60_000) {
        player.socket.terminate?.();
        continue;
      }
      send(player.socket, { type: 'PING', at: new Date(now).toISOString() });
    }
  }

  close() {
    const players = [...this.connections.values()].flatMap((connections) => [...connections]);
    this.players.clear();
    this.connections.clear();
    for (const player of players) {
      this.retire(player);
      player.socket.close(1001, 'server shutdown');
    }
  }
}
