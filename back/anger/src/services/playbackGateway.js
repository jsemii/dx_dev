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
    this.seenRequestIds = new Set();
  }

  attach(socket, homeId) {
    const player = {
      socket, homeId, registered: false, ready: false, busy: false,
      currentRequestId: null, pendingAck: null, lastPongAt: this.now(),
    };
    let homes = this.players.get(homeId);
    if (!homes) {
      homes = new Set();
      this.players.set(homeId, homes);
    }
    homes.add(player);
    socket.on('message', (raw) => this.handleMessage(player, raw));
    socket.on('close', () => this.detach(player));
    socket.on('error', () => this.detach(player));
    return player;
  }

  detach(player) {
    if (player.pendingAck) {
      this.clearTimer(player.pendingAck.timer);
      player.pendingAck.reject(unavailable('PLAYBACK_DISCONNECTED', '생활자 재생 화면 연결이 끊어졌습니다.'));
      player.pendingAck = null;
    }
    const homes = this.players.get(player.homeId);
    homes?.delete(player);
    if (homes?.size === 0) this.players.delete(player.homeId);
  }

  handleMessage(player, raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message?.type === 'REGISTER') {
      if (message.home_id !== player.homeId) {
        player.socket.close(1008, 'home mismatch');
        return;
      }
      player.registered = true;
      send(player.socket, { type: 'REGISTERED', home_id: player.homeId });
      return;
    }
    if (!player.registered) return;
    if (message?.type === 'READY') {
      player.ready = true;
      player.busy = false;
      return;
    }
    if (message?.type === 'NOT_READY') {
      player.ready = false;
      return;
    }
    if (message?.type === 'PONG') { player.lastPongAt = this.now(); return; }
    if (!UUID.test(String(message?.request_id || '')) || message.request_id !== player.currentRequestId) return;
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
    if (message.type === 'ENDED') {
      player.busy = false;
      player.ready = true;
      player.currentRequestId = null;
      return;
    }
    if (message.type === 'FAILED') {
      if (player.pendingAck) {
        this.clearTimer(player.pendingAck.timer);
        const code = message.code === 'PLAYER_BUSY' ? 'PLAYER_BUSY' : 'PLAYBACK_FAILED';
        player.pendingAck.reject(conflict(code, code === 'PLAYER_BUSY'
          ? '생활자 화면에서 콘텐츠를 재생 중입니다.' : '생활자 화면에서 콘텐츠를 재생할 수 없습니다.'));
        player.pendingAck = null;
      }
      player.busy = false;
      player.ready = message.code === 'PLAYER_BUSY';
      player.currentRequestId = null;
    }
  }

  getStatus(homeId) {
    const players = [...(this.players.get(homeId) || [])]
      .filter((player) => player.socket.readyState === OPEN && player.registered);
    const readyPlayers = players.filter((player) => player.ready && !player.busy).length;
    return {
      ready: readyPlayers > 0,
      readyPlayers,
      connectedPlayers: players.length,
      busy: players.some((player) => player.busy),
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
    const player = [...(this.players.get(homeId) || [])]
      .find((candidate) => candidate.ready && !candidate.busy && candidate.socket.readyState === OPEN);
    if (!player) throw conflict('PLAYBACK_NOT_READY', '생활자 재생 화면을 먼저 준비해 주세요.');

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

  heartbeat() {
    for (const homes of this.players.values()) {
      for (const player of homes) {
        const now = this.now();
        if (now - player.lastPongAt > 60_000) {
          player.socket.terminate?.();
          continue;
        }
        send(player.socket, { type: 'PING', at: new Date(now).toISOString() });
      }
    }
  }

  close() {
    for (const homes of this.players.values()) {
      for (const player of homes) player.socket.close(1001, 'server shutdown');
    }
    this.players.clear();
  }
}
