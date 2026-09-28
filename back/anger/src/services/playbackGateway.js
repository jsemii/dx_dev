import { randomUUID } from 'node:crypto';
import {
  PLAYER_CONNECTION_TIMEOUT_MS,
  PLAYER_REPLACED_CLOSE_CODE,
  PLAYER_STATE_HEARTBEAT_TIMEOUT_MS,
  PLAYER_STATE_TIMEOUT_CLOSE_CODE,
} from '../constants/player.js';
import { conflict, unavailable } from '../errors.js';
import { parseYouTubeUrl } from '../validation.js';

const OPEN = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSY_PLAYER_STATES = new Set([
  'CONNECTING', 'UNSTARTED', 'CUED', 'BUFFERING', 'PLAYING', 'PAUSED',
]);
const READY_PLAYER_STATES = new Set(['READY', 'ENDED']);

function send(socket, payload) {
  if (socket.readyState !== OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

export class PlaybackGateway {
  constructor({ ackTimeoutMs = 5_000, commandTtlMs = 15_000, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout,
    connectionTimeoutMs = PLAYER_CONNECTION_TIMEOUT_MS,
    stateHeartbeatTimeoutMs = PLAYER_STATE_HEARTBEAT_TIMEOUT_MS,
    logger = {} } = {}) {
    this.ackTimeoutMs = ackTimeoutMs;
    this.commandTtlMs = commandTtlMs;
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.stateHeartbeatTimeoutMs = stateHeartbeatTimeoutMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.logger = logger;
    this.players = new Map();
    this.connections = new Map();
    this.seenRequestIds = new Set();
  }

  logEvent(event, player, { requestId = player?.currentRequestId || null,
    reason = null, elapsedMs = null } = {}) {
    if (!player) return;
    const startedAt = player.playStartedAt || player.connectedAt;
    const elapsed = elapsedMs ?? Math.max(0, this.now() - startedAt);
    this.logger.info?.('Playback gateway event', {
      event,
      home_id: player.homeId,
      connection_id: player.connectionId,
      request_id: requestId,
      elapsed_ms: elapsed,
      reason,
    });
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
      connectedAt: this.now(),
      lastPongAt: this.now(),
      lastStateHeartbeatAt: null,
      playStartedAt: null,
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
    player.lastStateHeartbeatAt = null;
    player.playStartedAt = null;
  }

  register(player, snapshot = {}) {
    player.registered = true;
    const active = this.players.get(player.homeId);
    if (!active || !this.isConnected(active)) {
      this.players.set(player.homeId, player);
    }
    this.logEvent('REGISTER', player, { requestId: snapshot.request_id || null });
    send(player.socket, {
      type: 'REGISTERED', home_id: player.homeId, connection_id: player.connectionId,
    });
    if (this.isActive(player)) this.reconcilePlayerState(player, snapshot, 'REGISTER');
  }

  promoteReady(player) {
    if (!player.registered || player.retired || player.socket.readyState !== OPEN) return;
    const previous = this.players.get(player.homeId);
    this.players.set(player.homeId, player);
    player.ready = true;
    player.busy = false;
    player.currentRequestId = null;
    player.lastStateHeartbeatAt = this.now();
    player.playStartedAt = null;
    this.logEvent('READY', player);
    if (previous && previous !== player) {
      this.retire(previous, unavailable(
        'PLAYBACK_REPLACED', '새 생활자 재생 화면이 준비되었습니다.',
      ));
      previous.socket.close(PLAYER_REPLACED_CLOSE_CODE, 'replaced by ready player');
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
    const requestId = player.currentRequestId;
    if (player.pendingAck) {
      this.clearTimer(player.pendingAck.timer);
      player.pendingAck.resolve({ requestId });
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
    player.lastStateHeartbeatAt = this.now();
    player.playStartedAt = null;
    return requestId;
  }

  markPlaying(player, requestId, source) {
    if (!UUID.test(String(requestId || ''))) return false;
    if (player.currentRequestId && player.currentRequestId !== requestId) return false;
    if (!player.currentRequestId && !this.seenRequestIds.has(requestId)
        && !source.startsWith('REGISTER')) {
      return false;
    }
    const changed = !player.busy || player.ready || player.currentRequestId !== requestId;
    player.currentRequestId = requestId;
    player.busy = true;
    player.ready = false;
    player.lastStateHeartbeatAt = this.now();
    player.playStartedAt ??= this.now();
    if (player.pendingAck) {
      this.clearTimer(player.pendingAck.timer);
      player.pendingAck.resolve({ requestId });
      player.pendingAck = null;
    }
    if (changed || source === 'ACK' || source.startsWith('REGISTER')) {
      this.logEvent('PLAYING', player, { requestId, reason: source });
    }
    return true;
  }

  reconcilePlayerState(player, snapshot, source) {
    const playerState = String(snapshot?.player_state || '').toUpperCase();
    const requestId = snapshot?.request_id || null;
    if (!playerState) return false;
    if (READY_PLAYER_STATES.has(playerState)) {
      if (requestId && player.currentRequestId && requestId !== player.currentRequestId) return false;
      if (player.pendingStop) {
        player.lastStateHeartbeatAt = this.now();
        return true;
      }
      if (player.busy || player.currentRequestId) {
        if (player.pendingAck) {
          this.clearTimer(player.pendingAck.timer);
          player.pendingAck.reject(unavailable(
            'PLAYBACK_NOT_STARTED', '생활자 화면에서 영상 재생이 시작되지 않았습니다.',
          ));
          player.pendingAck = null;
        }
        const elapsedMs = player.playStartedAt ? this.now() - player.playStartedAt : 0;
        const finishedRequestId = this.finishPlayback(player);
        this.logEvent(playerState === 'ENDED' ? 'ENDED' : 'READY', player, {
          requestId: finishedRequestId || requestId,
          reason: `${source}_SYNC`,
          elapsedMs,
        });
      } else if (!player.ready || !this.isActive(player)) {
        this.promoteReady(player);
      }
      player.lastStateHeartbeatAt = this.now();
      return true;
    }
    if (BUSY_PLAYER_STATES.has(playerState) && UUID.test(String(requestId || ''))) {
      return this.markPlaying(player, requestId, `${source}_${playerState}`);
    }
    if (playerState === 'NOT_READY' || playerState === 'ERROR') {
      if (!player.busy) player.ready = false;
      return true;
    }
    return false;
  }

  handleMessage(player, raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message?.type === 'REGISTER') {
      if (player.retired) {
        player.socket.close(PLAYER_REPLACED_CLOSE_CODE, 'connection retired');
        return;
      }
      if (message.home_id !== player.homeId) {
        player.socket.close(1008, 'home mismatch');
        return;
      }
      if (!player.registered) this.register(player, message);
      else send(player.socket, {
        type: 'REGISTERED', home_id: player.homeId, connection_id: player.connectionId,
      });
      return;
    }
    if (message?.type === 'PONG' && this.isConnected(player)) {
      player.lastPongAt = this.now();
      const active = this.players.get(player.homeId);
      if (player.registered && (!active || !this.isConnected(active))) {
        this.players.set(player.homeId, player);
      }
      if (player.registered && this.reconcilePlayerState(player, message, 'HEARTBEAT')) {
        player.lastStateHeartbeatAt = this.now();
      }
      return;
    }
    if (!player.registered || !this.isConnected(player)) return;
    if (message?.type === 'READY') {
      if (!player.currentRequestId && !player.busy
          && (!player.ready || !this.isActive(player))) this.promoteReady(player);
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
      this.markPlaying(player, message.request_id, 'ACK');
      return;
    }
    if (message.type === 'ENDED' && player.pendingStop) {
      this.logEvent('ENDED', player, {
        requestId: message.request_id,
        reason: 'STOP_PENDING',
      });
      return;
    }
    if (message.type === 'ENDED' || message.type === 'STOPPED') {
      const elapsedMs = player.playStartedAt ? this.now() - player.playStartedAt : 0;
      const requestId = this.finishPlayback(player);
      this.logEvent(message.type, player, { requestId, elapsedMs });
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
      player.playStartedAt = null;
      player.lastStateHeartbeatAt = this.now();
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
    player.playStartedAt = issuedAt;
    player.lastStateHeartbeatAt = issuedAt;
    this.logEvent('PLAY', player, { requestId, elapsedMs: 0 });
    if (!send(player.socket, command)) {
      player.currentRequestId = null;
      player.busy = false;
      player.playStartedAt = null;
      player.lastStateHeartbeatAt = null;
      throw unavailable('PLAYBACK_DISCONNECTED', '생활자 재생 화면 연결이 끊어졌습니다.');
    }
    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        player.pendingAck = null;
        player.busy = false;
        player.ready = false;
        player.currentRequestId = null;
        player.playStartedAt = null;
        player.lastStateHeartbeatAt = null;
        this.logEvent('TIMEOUT', player, {
          requestId, reason: 'PLAYING_ACK_TIMEOUT', elapsedMs: this.ackTimeoutMs,
        });
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
    this.logEvent('STOP', player, { requestId });
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
      player.playStartedAt = null;
      player.lastStateHeartbeatAt = null;
      this.logEvent('TIMEOUT', player, {
        requestId, reason: 'STOPPED_ACK_TIMEOUT', elapsedMs: this.ackTimeoutMs,
      });
      rejectStop(unavailable('PLAYBACK_STOP_TIMEOUT', '생활자 화면의 영상 중지를 확인하지 못했습니다.'));
      player.socket.close(PLAYER_STATE_TIMEOUT_CLOSE_CODE, 'playback stop timeout');
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
      player.playStartedAt = null;
      player.lastStateHeartbeatAt = null;
      throw unavailable('PLAYBACK_DISCONNECTED', '생활자 재생 화면 연결이 끊어졌습니다.');
    }
    return promise;
  }

  heartbeat() {
    const players = [...this.connections.values()].flatMap((connections) => [...connections]);
    for (const player of players) {
      if (!this.isConnected(player)) continue;
      const now = this.now();
      if (now - player.lastPongAt > this.connectionTimeoutMs) {
        this.logEvent('TIMEOUT', player, {
          reason: 'CONNECTION_HEARTBEAT_TIMEOUT',
          elapsedMs: now - player.lastPongAt,
        });
        player.socket.terminate?.();
        continue;
      }
      const lastStateAt = player.lastStateHeartbeatAt ?? player.playStartedAt ?? now;
      if (player.busy && player.currentRequestId
          && now - lastStateAt > this.stateHeartbeatTimeoutMs) {
        const requestId = player.currentRequestId;
        this.logEvent('TIMEOUT', player, {
          requestId,
          reason: 'PLAYING_STATE_HEARTBEAT_TIMEOUT',
          elapsedMs: now - lastStateAt,
        });
        this.retire(player, unavailable(
          'PLAYBACK_STATE_TIMEOUT', '생활자 화면의 재생 상태 확인이 중단되었습니다.',
        ));
        player.socket.close(PLAYER_STATE_TIMEOUT_CLOSE_CODE, 'player state heartbeat timeout');
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
