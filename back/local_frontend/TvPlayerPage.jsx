import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlayerSession, pairPlayer } from './playerApi.mjs';
import { SinglePlayerSocket } from './singlePlayerSocket.mjs';
import { AngerMonitor } from './angerMonitor.mjs';
import {
  isActiveDetectionState, PlayerAudioCoordinator, REMOTE_DETECTION_STATE,
} from './playerAudioCoordinator.mjs';
import { analyzeAnger } from './safetyCareApi.mjs';
import {
  decidePlayCommand, PlaybackRequestGuard, playbackWebSocketUrl,
  playerHeartbeatSnapshot, TV_PLAYER_STATE,
} from './tvPlayerProtocol.mjs';

const YOUTUBE_API = 'https://www.youtube.com/iframe_api';

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('YouTube Player를 준비하지 못했습니다.')), 15_000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      previous?.();
      resolve(window.YT);
    };
    if (!document.querySelector(`script[src="${YOUTUBE_API}"]`)) {
      const script = document.createElement('script');
      script.src = YOUTUBE_API;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('YouTube Player를 준비하지 못했습니다.'));
      };
      document.head.append(script);
    }
  });
}

function createYouTubePlayer(YT, elementId, handlers) {
  return new Promise((resolve) => {
    const player = new YT.Player(elementId, {
      width: '100%', height: '100%', videoId: '',
      playerVars: {
        autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3,
        modestbranding: 1, playsinline: 1, rel: 0, origin: window.location.origin,
        widget_referrer: window.location.origin,
      },
      events: {
        onReady: (event) => {
          event.target.setVolume?.(100);
          const iframe = event.target.getIframe?.();
          if (iframe) iframe.referrerPolicy = 'strict-origin-when-cross-origin';
          resolve(event.target);
        },
        onStateChange: handlers.onStateChange,
        onError: handlers.onError,
        onAutoplayBlocked: handlers.onAutoplayBlocked,
      },
    });
  });
}

export default function TvPlayerPage({ homeId }) {
  const [state, setState] = useState(TV_PLAYER_STATE.SETUP);
  const [paired, setPaired] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
  const [microphoneLabel, setMicrophoneLabel] = useState('권한 확인 전');
  const [detectionState, setDetectionState] = useState(REMOTE_DETECTION_STATE.OFFLINE);
  const [cursorHidden, setCursorHidden] = useState(false);
  const [debugInfo, setDebugInfo] = useState({
    socket: 'CLOSED', requestId: '-', videoId: '-', error: '-', heartbeat: '-',
  });
  const [audioDebug, setAudioDebug] = useState({
    audioContextState: 'unavailable', trackEnabled: false, trackMuted: false,
    trackReadyState: 'unavailable', rms: 0, db: -Infinity, thresholdDb: -40,
    aboveThresholdMs: 0, measurementRunning: false,
  });
  const debug = new URLSearchParams(window.location.search).get('debug') === '1';
  const mounted = useRef(true);
  const prepared = useRef(false);
  const socketManager = useRef(null);
  const connectSocketRef = useRef(null);
  const handleSocketMessageRef = useRef(null);
  const player = useRef(null);
  const currentPlayback = useRef(null);
  const guard = useRef(new PlaybackRequestGuard());
  const wakeLock = useRef(null);
  const stateRef = useRef(state);
  const monitor = useRef(null);
  const audioCoordinator = useRef(null);
  stateRef.current = state;

  if (!monitor.current) {
    monitor.current = new AngerMonitor({
      analyze: (audio, sessionId, signal) => analyzeAnger(
        fetch, homeId, sessionId, audio, { signal },
      ),
      keepStream: true,
      onDevice: ({ label }) => {
        if (mounted.current) setMicrophoneLabel(label || '연결된 마이크');
      },
      onDiagnostics: (diagnostics) => {
        if (mounted.current) setAudioDebug(diagnostics);
      },
      onState: (status) => audioCoordinator.current?.handleMonitorState(status),
    });
    audioCoordinator.current = new PlayerAudioCoordinator({
      monitor: monitor.current,
      onState: (status) => {
        if (!mounted.current) return;
        setDetectionState(status.state);
        socketManager.current?.send({
          type: 'DETECTION_STATE',
          detection_state: status.state,
          microphone_ready: status.microphoneReady,
          detection_requested: status.requested,
          detection_result: status.lastResult,
        });
        if (status.state === REMOTE_DETECTION_STATE.ERROR && status.message) {
          setMessage(status.message);
          setState(TV_PLAYER_STATE.ERROR);
        }
      },
    });
  }

  const send = useCallback((payload, target) => (
    socketManager.current?.send(payload, target) || false
  ), []);

  const announceReady = useCallback((target) => {
    const detection = audioCoordinator.current?.snapshot() || {};
    send({
      type: 'REGISTER', home_id: homeId, player_state: 'READY', request_id: null, ...detection,
    }, target);
    send({ type: 'READY', ...detection }, target);
    if (mounted.current) setState(TV_PLAYER_STATE.READY);
  }, [homeId, send]);

  const heartbeatSnapshot = useCallback(() => playerHeartbeatSnapshot({
    prepared: prepared.current,
    uiState: stateRef.current,
    requestId: currentPlayback.current?.requestId || null,
    youtubeState: player.current?.getPlayerState?.(),
    detection: audioCoordinator.current?.snapshot(),
  }), []);

  const finishLocalPlayback = useCallback((playback) => {
    if (!playback || currentPlayback.current?.requestId !== playback.requestId) return;
    currentPlayback.current = null;
    send({ type: 'ENDED', request_id: playback.requestId }, playback.socket);
    player.current?.stopVideo?.();
    audioCoordinator.current?.afterPlayback();
    setState(TV_PLAYER_STATE.ENDED);
    window.setTimeout(() => {
      if (mounted.current && prepared.current) announceReady(playback.socket);
    }, 150);
  }, [announceReady, send]);

  const onYouTubeState = useCallback((event) => {
    const playback = currentPlayback.current;
    if (event.data === window.YT?.PlayerState?.PLAYING && playback) {
      setState(TV_PLAYER_STATE.PLAYING);
      send({ type: 'PLAYING', request_id: playback.requestId }, playback.socket);
    } else if (event.data === window.YT?.PlayerState?.ENDED && playback) {
      finishLocalPlayback(playback);
    }
  }, [finishLocalPlayback, send]);

  const failPlayback = useCallback((code = 'PLAYBACK_FAILED', failed = currentPlayback.current) => {
    if (failed) {
      send({ type: 'FAILED', request_id: failed.requestId, code }, failed.socket);
      send({ type: 'NOT_READY' }, failed.socket);
    }
    currentPlayback.current = null;
    audioCoordinator.current?.afterPlayback();
    setDebugInfo((current) => ({ ...current, error: code }));
    setMessage('콘텐츠를 재생할 수 없습니다.');
    setState(TV_PLAYER_STATE.ERROR);
    window.setTimeout(() => {
      if (!mounted.current || !prepared.current) return;
      setMessage('');
      announceReady(failed?.socket);
    }, 1_600);
  }, [announceReady, send]);

  const handleSocketMessage = useCallback((event, sourceSocket, generation) => {
    let command;
    try { command = JSON.parse(event.data); } catch { return; }
    if (command.type === 'PING') {
      setDebugInfo((current) => ({ ...current, heartbeat: command.at || new Date().toISOString() }));
      const snapshot = heartbeatSnapshot();
      if (snapshot.player_state === 'ENDED' && currentPlayback.current) {
        finishLocalPlayback(currentPlayback.current);
        send({
          type: 'PONG', at: command.at, player_state: 'READY', request_id: null,
          ...audioCoordinator.current.snapshot(),
        }, sourceSocket);
      } else {
        send({ type: 'PONG', at: command.at, ...snapshot }, sourceSocket);
      }
      return;
    }
    if (command.type === 'START_DETECTION' || command.type === 'STOP_DETECTION') {
      if (command.home_id !== homeId || typeof command.command_id !== 'string') return;
      const action = command.type === 'START_DETECTION'
        ? audioCoordinator.current.start()
        : Promise.resolve(audioCoordinator.current.stop());
      Promise.resolve(action).then(() => {
        const snapshot = audioCoordinator.current.snapshot();
        if (command.type === 'START_DETECTION'
            && !isActiveDetectionState(snapshot.detection_state)) {
          throw Object.assign(new Error('음성 감지가 실제로 시작되지 않았습니다.'), {
            code: 'DETECTION_NOT_STARTED',
          });
        }
        if (command.type === 'STOP_DETECTION'
            && (snapshot.detection_requested || snapshot.detection_state !== 'READY')) {
          throw Object.assign(new Error('음성 감지 중지를 확인하지 못했습니다.'), {
            code: 'DETECTION_NOT_STOPPED',
          });
        }
        send({
          type: command.type === 'START_DETECTION' ? 'DETECTION_STARTED' : 'DETECTION_STOPPED',
          command_id: command.command_id,
          ...snapshot,
        }, sourceSocket);
      }).catch((error) => {
        const snapshot = audioCoordinator.current.reportStartFailure(
          error.message || '음성 감지 명령에 실패했습니다.',
        );
        send({ type: 'DETECTION_FAILED', command_id: command.command_id,
          code: error.code || 'MICROPHONE_UNAVAILABLE', message: error.message,
          ...snapshot }, sourceSocket);
      });
      return;
    }
    if (command.type === 'STOP') {
      const playback = currentPlayback.current;
      if (command.home_id !== homeId || !playback || command.request_id !== playback.requestId
          || playback.socket !== sourceSocket || playback.generation !== generation) {
        if (!playback && command.home_id === homeId) {
          send({ type: 'STOPPED', request_id: command.request_id }, sourceSocket);
          announceReady(sourceSocket);
        } else {
          send({ type: 'FAILED', request_id: command.request_id, code: 'INVALID_STOP_REQUEST' }, sourceSocket);
        }
        return;
      }
      currentPlayback.current = null;
      player.current?.stopVideo?.();
      audioCoordinator.current?.afterPlayback();
      send({ type: 'STOPPED', request_id: command.request_id }, sourceSocket);
      setState(TV_PLAYER_STATE.ENDED);
      announceReady(sourceSocket);
      return;
    }
    if (command.type !== 'PLAY') return;
    const active = currentPlayback.current;
    const decision = decidePlayCommand({
      message: command, homeId, state: stateRef.current,
      currentRequestId: active?.requestId || null, guard: guard.current,
    });
    if (decision.action === 'IGNORE_DUPLICATE') return;
    if (decision.action === 'FAILED') {
      send({ type: 'FAILED', request_id: command.request_id, code: decision.code }, sourceSocket);
      return;
    }
    const playback = { requestId: command.request_id, socket: sourceSocket, generation };
    audioCoordinator.current?.beforePlayback();
    currentPlayback.current = playback;
    setDebugInfo((current) => ({
      ...current, requestId: command.request_id, videoId: command.video_id, error: '-',
    }));
    setState(TV_PLAYER_STATE.CONNECTING);
    try {
      player.current.unMute?.();
      player.current.setVolume?.(100);
      player.current.loadVideoById({ videoId: command.video_id, startSeconds: 0 });
      player.current.playVideo();
    } catch {
      failPlayback('PLAYBACK_FAILED', playback);
    }
  }, [announceReady, failPlayback, finishLocalPlayback, heartbeatSnapshot, homeId, send]);
  handleSocketMessageRef.current = handleSocketMessage;

  const ensureSocketManager = useCallback(() => {
    if (socketManager.current) return socketManager.current;
    socketManager.current = new SinglePlayerSocket({
      createSocket: () => new WebSocket(playbackWebSocketUrl(window.location)),
      onOpen: (webSocket, generation) => {
        setDebugInfo((current) => ({ ...current, socket: 'OPEN' }));
        if (!prepared.current || !player.current) return;
        const playback = currentPlayback.current;
        audioCoordinator.current?.recoverConnection({ playbackActive: Boolean(playback) });
        if (!playback) {
          announceReady(webSocket);
          return;
        }
        playback.socket = webSocket;
        playback.generation = generation;
        const snapshot = heartbeatSnapshot();
        if (snapshot.player_state === 'ENDED') {
          finishLocalPlayback(playback);
          announceReady(webSocket);
          return;
        }
        send({ type: 'REGISTER', home_id: homeId, ...snapshot }, webSocket);
        send({ type: 'PLAYING', request_id: playback.requestId }, webSocket);
        setState(TV_PLAYER_STATE.PLAYING);
      },
      onMessage: (event, webSocket, generation) => {
        handleSocketMessageRef.current?.(event, webSocket, generation);
      },
      onClose: (event, closedSocket) => {
        setDebugInfo((current) => ({ ...current, socket: 'CLOSED' }));
        if (!mounted.current || !prepared.current) return;
        if (event?.code === 4001) {
          socketManager.current?.cancelReconnect();
          if (currentPlayback.current?.socket === closedSocket) {
            currentPlayback.current = null;
            player.current?.stopVideo?.();
          }
          prepared.current = false;
          audioCoordinator.current?.dispose();
          setMessage('다른 생활자 재생 화면이 연결되었습니다.');
          setState(TV_PLAYER_STATE.ERROR);
          return;
        }
        setState(TV_PLAYER_STATE.DISCONNECTED);
        socketManager.current?.scheduleReconnect(
          () => void connectSocketRef.current?.().catch(() => {}), 2_000,
        );
      },
    });
    return socketManager.current;
  }, [announceReady, finishLocalPlayback, heartbeatSnapshot, homeId, send]);

  const connectSocket = useCallback(() => ensureSocketManager().connect(), [ensureSocketManager]);
  connectSocketRef.current = connectSocket;

  const requestWakeLock = useCallback(async () => {
    try { wakeLock.current = await navigator.wakeLock?.request('screen'); } catch {
      setDebugInfo((current) => ({ ...current, error: 'WAKE_LOCK_UNAVAILABLE' }));
    }
  }, []);

  const prepare = useCallback(async () => {
    setState(TV_PLAYER_STATE.CONNECTING);
    setMessage('');
    void document.documentElement.requestFullscreen?.().catch(() => {});
    void requestWakeLock();
    const microphonePromise = audioCoordinator.current.prepare();
    try {
      if (!paired) {
        if (!pairingCode.trim()) throw new Error('연결 코드를 입력해 주세요.');
        await pairPlayer(fetch, homeId, pairingCode.trim());
        setPaired(true);
      }
      const [YT, webSocket] = await Promise.all([
        loadYouTubeApi(), connectSocket(), microphonePromise,
      ]);
      if (!player.current) {
        player.current = await createYouTubePlayer(YT, 'nulbom-tv-player', {
          onStateChange: onYouTubeState,
          onError: (event) => failPlayback(`YOUTUBE_${event?.data || 'UNKNOWN'}`),
          onAutoplayBlocked: () => failPlayback('AUTOPLAY_BLOCKED'),
        });
      }
      prepared.current = true;
      announceReady(webSocket);
    } catch (error) {
      prepared.current = false;
      audioCoordinator.current?.dispose();
      setMessage(error.userMessage || error.message || '재생 화면을 준비할 수 없습니다.');
      setState(paired ? TV_PLAYER_STATE.ERROR : TV_PLAYER_STATE.SETUP);
    }
  }, [announceReady, connectSocket, failPlayback, homeId, onYouTubeState, paired, pairingCode, requestWakeLock]);

  useEffect(() => {
    mounted.current = true;
    getPlayerSession(fetch, homeId).then(setPaired).catch(() => setPaired(false));
    return () => {
      mounted.current = false;
      prepared.current = false;
      currentPlayback.current = null;
      socketManager.current?.dispose();
      socketManager.current = null;
      wakeLock.current?.release?.();
      player.current?.destroy?.();
      player.current = null;
      audioCoordinator.current?.dispose();
    };
  }, [homeId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && prepared.current) void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [requestWakeLock]);

  useEffect(() => {
    let timer;
    const wakeCursor = () => {
      setCursorHidden(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCursorHidden(true), 2_500);
    };
    window.addEventListener('mousemove', wakeCursor);
    wakeCursor();
    return () => { window.clearTimeout(timer); window.removeEventListener('mousemove', wakeCursor); };
  }, []);

  const setupVisible = state === TV_PLAYER_STATE.SETUP;
  const errorVisible = state === TV_PLAYER_STATE.ERROR;
  const connecting = state === TV_PLAYER_STATE.CONNECTING;
  return (
    <main className={`tv-player tv-player--${state.toLowerCase()} ${cursorHidden ? 'tv-player--cursor-hidden' : ''}`}>
      <div id="nulbom-tv-player" className="tv-player__video" aria-hidden={state !== TV_PLAYER_STATE.PLAYING} />
      {setupVisible && (
        <section className="tv-player__setup">
          <h1>ThinQ 늘봄</h1>
          <p>안정 콘텐츠 재생 화면을 준비합니다.</p>
          {!paired && (
            <>
              <input type="password" value={pairingCode} onChange={(event) => { setPairingCode(event.target.value); setMessage(''); }} aria-label="재생 화면 연결 코드" placeholder="연결 코드" autoComplete="one-time-code" />
              {message && <p className="tv-player__setup-error" role="alert">{message}</p>}
            </>
          )}
          <button type="button" onClick={prepare}>시연 화면 준비</button>
        </section>
      )}
      {connecting && <div className="tv-player__loading" aria-live="polite"><span />재생 화면을 준비하고 있습니다.</div>}
      {errorVisible && (
        <section className="tv-player__error" aria-live="assertive">
          <p>{message || '콘텐츠를 재생할 수 없습니다.'}</p>
          <button type="button" onClick={prepare}>재생 화면 다시 준비</button>
        </section>
      )}
      {state === TV_PLAYER_STATE.DISCONNECTED && <p className="tv-player__disconnected">늘봄 서비스에 다시 연결하고 있습니다.</p>}
      <aside className="tv-player__device-status" aria-live="polite">
        <span>마이크: {microphoneLabel}</span>
        <span>마이크 권한: {audioCoordinator.current?.microphoneReady ? '허용됨' : '준비 필요'}</span>
        <span>서비스 연결: {debugInfo.socket === 'OPEN' ? '연결됨' : '연결 안 됨'}</span>
        <span>재생 준비: {prepared.current ? '준비됨' : '준비 필요'}</span>
        <span>감지 상태: {detectionState}</span>
      </aside>
      {debug && (
        <output className="tv-player__debug">
          state={state}<br />socket={debugInfo.socket}<br />ready={String(state === TV_PLAYER_STATE.READY)}<br />
          request={debugInfo.requestId}<br />video={debugInfo.videoId}<br />error={debugInfo.error}<br />
          heartbeat={debugInfo.heartbeat}<br />home={homeId}
          <br />detection={detectionState}<br />microphone={microphoneLabel}
          <br />audio_context={audioDebug.audioContextState}
          <br />track_enabled={String(audioDebug.trackEnabled)}
          <br />track_muted={String(audioDebug.trackMuted)}
          <br />track_ready_state={audioDebug.trackReadyState}
          <br />rms={Number(audioDebug.rms || 0).toFixed(5)}
          <br />db={Number.isFinite(audioDebug.db) ? audioDebug.db.toFixed(1) : '-Infinity'}
          <br />threshold_db={audioDebug.thresholdDb}
          <br />above_threshold_ms={Math.round(audioDebug.aboveThresholdMs || 0)}
          <br />measurement_running={String(audioDebug.measurementRunning)}
        </output>
      )}
    </main>
  );
}
