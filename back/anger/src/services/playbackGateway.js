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
const ACTIVE_DETECTION_STATES = new Set(['DETECTING', 'RECORDING', 'ANALYZING']);

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
      pendingDetection: null,
      detectionState: 'PREPARING',
      detectionRequested: false,
      detectionResult: null,
      microphoneReady: false,
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
    if (player.pendingDetection) {
      this.clearTimer(player.pendingDetection.timer);
      player.pendingDetection.reject(error);
      player.pendingDetection = null;
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
    player.detectionState = 'OFFLINE';
    player.detectionRequested = false;
    player.microphoneReady = false;
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
    this.reconcileDetectionState(player, snapshot);
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
    this.reconcileDetectionState(player, snapshot);
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

  reconcileDetectionState(player, snapshot) {
    const validStates = new Set([
      'OFFLINE', 'PREPARING', 'READY', 'DETECTING', 'RECORDING', 'ANALYZING',
      'PLAYING', 'COOLDOWN', 'ERROR',
    ]);
    const detectionState = String(snapshot?.detection_state || '').toUpperCase();
    const hasRequested = typeof snapshot?.detection_requested === 'boolean';
    const requested = hasRequested ? snapshot.detection_requested : player.detectionRequested;
    if (detectionState === 'READY' && player.pendingDetection?.type === 'START_DETECTION') {
      return false;
    }
    if (detectionState === 'READY' && requested) {
      if (ACTIVE_DETECTION_STATES.has(player.detectionState) && player.detectionRequested) return false;
      player.detectionState = 'ERROR';
      player.detectionRequested = false;
    } else if (validStates.has(detectionState)) {
      player.detectionState = detectionState;
      if (ACTIVE_DETECTION_STATES.has(detectionState)) player.detectionRequested = true;
      else if (['READY', 'ERROR', 'OFFLINE'].includes(detectionState)) player.detectionRequested = false;
      else if (hasRequested) player.detectionRequested = requested;
    } else if (hasRequested) {
      player.detectionRequested = requested;
    }
    if (typeof snapshot?.microphone_ready === 'boolean') {
      player.microphoneReady = snapshot.microphone_ready;
    }
    if (Object.hasOwn(snapshot || {}, 'detection_result')) {
      player.detectionResult = ['DETECTED', 'NOT_DETECTED'].includes(snapshot.detection_result)
        ? snapshot.detection_result : null;
    }
    return true;
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
      this.reconcileDetectionState(player, message);
      if (!player.currentRequestId && !player.busy
          && (!player.ready || !this.isActive(player))) this.promoteReady(player);
      return;
    }
    if (message?.type === 'NOT_READY') {
      if (!player.busy) player.ready = false;
      return;
    }
    if (!this.isActive(player)) return;
    if (message?.type === 'DETECTION_STATE') {
      this.reconcileDetectionState(player, message);
      return;
    }
    if (['DETECTION_STARTED', 'DETECTION_STOPPED', 'DETECTION_FAILED'].includes(message?.type)) {
      const pending = player.pendingDetection;
      if (!pending || message.command_id !== pending.commandId
          || (message.type !== pending.expectedType && message.type !== 'DETECTION_FAILED')) {
        return;
      }
      this.clearTimer(pending.timer);
      player.pendingDetection = null;
      if (message.type === 'DETECTION_FAILED') {
        player.detectionRequested = false;
        player.detectionState = 'ERROR';
        this.reconcileDetectionState(player, message);
        pending.reject(conflict(
          message.code || 'DETECTION_FAILED',
          message.message || '생활자 화면에서 음성 감지를 시작하지 못했습니다.',
        ));
      } else if (message.type === 'DETECTION_STARTED'
          && !ACTIVE_DETECTION_STATES.has(String(message.detection_state || '').toUpperCase())) {
        player.detectionRequested = false;
        player.detectionState = 'ERROR';
        pending.reject(conflict(
          'INVALID_DETECTION_STARTED_ACK', '생활자 화면에서 음성 감지가 실제로 시작되지 않았습니다.',
        ));
      } else if (message.type === 'DETECTION_STOPPED'
          && (message.detection_requested !== false
            || !['READY', 'PLAYING'].includes(String(message.detection_state || '').toUpperCase()))) {
        player.detectionRequested = false;
        player.detectionState = 'ERROR';
        pending.reject(conflict(
          'INVALID_DETECTION_STOPPED_ACK', '생활자 화면에서 음성 감지 중지를 확인하지 못했습니다.',
        ));
      } else {
        this.reconcileDetectionState(player, message);
        pending.resolve({ state: player.detectionState, microphoneReady: player.microphoneReady });
      }
      return;
    }
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

  getDetailedStatus(homeId) {
    const status = this.getStatus(homeId);
    const player = this.players.get(homeId);
    const connected = Boolean(player && this.isActive(player));
    return {
      ...status,
      detectionState: connected ? (player.busy ? 'PLAYING' : player.detectionState) : 'OFFLINE',
      detectionRequested: Boolean(connected && player.detectionRequested),
      detectionResult: connected ? player.detectionResult : null,
      microphoneReady: Boolean(connected && player.microphoneReady),
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
    player.detectionState = 'PLAYING';
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

  async requestDetectionCommand(homeId, type) {
    const player = this.players.get(homeId);
    if (!player || !this.isActive(player)) {
      throw conflict('PLAYER_OFFLINE', '생활자 재생 화면이 연결되지 않았습니다.');
    }
    if (!player.microphoneReady) {
      throw conflict('PLAYER_MICROPHONE_NOT_READY', '생활자 재생 화면의 마이크를 먼저 준비해 주세요.');
    }
    if (type === 'START_DETECTION' && !player.ready) {
      throw conflict('PLAYBACK_NOT_READY', '생활자 재생 화면을 먼저 준비해 주세요.');
    }
    if (type === 'START_DETECTION' && player.busy) {
      throw conflict('PLAYER_BUSY', '생활자 화면에서 콘텐츠를 재생 중입니다.');
    }
    if (player.pendingDetection?.type === type) return player.pendingDetection.promise;
    if (player.pendingDetection) {
      this.clearTimer(player.pendingDetection.timer);
      player.pendingDetection.reject(conflict(
        'DETECTION_COMMAND_REPLACED', '새 음성 감지 명령으로 이전 명령을 교체했습니다.',
      ));
      player.pendingDetection = null;
    }
    if (type === 'START_DETECTION' && player.detectionRequested
        && ['DETECTING', 'RECORDING', 'ANALYZING'].includes(player.detectionState)) {
      return { state: player.detectionState, microphoneReady: true };
    }
    if (type === 'STOP_DETECTION' && !player.detectionRequested
        && !['DETECTING', 'RECORDING', 'ANALYZING', 'COOLDOWN'].includes(player.detectionState)) {
      return { state: player.detectionState, microphoneReady: true };
    }
    const commandId = randomUUID();
    const expectedType = type === 'START_DETECTION' ? 'DETECTION_STARTED' : 'DETECTION_STOPPED';
    let resolveCommand;
    let rejectCommand;
    const promise = new Promise((resolve, reject) => {
      resolveCommand = resolve;
      rejectCommand = reject;
    });
    const timer = this.setTimer(() => {
      if (player.pendingDetection?.commandId !== commandId) return;
      player.pendingDetection = null;
      player.detectionRequested = false;
      player.detectionState = 'ERROR';
      rejectCommand(unavailable('DETECTION_ACK_TIMEOUT', '생활자 화면의 음성 감지 응답을 확인하지 못했습니다.'));
    }, this.ackTimeoutMs);
    timer?.unref?.();
    player.pendingDetection = {
      type, commandId, expectedType, resolve: resolveCommand, reject: rejectCommand, timer, promise,
    };
    if (type === 'START_DETECTION') {
      player.detectionRequested = true;
      player.detectionState = 'PREPARING';
    }
    if (!send(player.socket, { type, command_id: commandId, home_id: homeId })) {
      this.clearTimer(timer);
      player.pendingDetection = null;
      player.detectionRequested = false;
      player.detectionState = 'ERROR';
      throw unavailable('PLAYBACK_DISCONNECTED', '생활자 재생 화면 연결이 끊어졌습니다.');
    }
    return promise;
  }

  startDetection(homeId) {
    return this.requestDetectionCommand(homeId, 'START_DETECTION');
  }

  stopDetection(homeId) {
    return this.requestDetectionCommand(homeId, 'STOP_DETECTION');
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
