import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlayerSession, pairPlayer } from './playerApi.mjs';
import { SinglePlayerSocket } from './singlePlayerSocket.mjs';
import {
  decidePlayCommand, PlaybackRequestGuard, playbackWebSocketUrl, TV_PLAYER_STATE,
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
  const [cursorHidden, setCursorHidden] = useState(false);
  const [debugInfo, setDebugInfo] = useState({
    socket: 'CLOSED', requestId: '-', videoId: '-', error: '-', heartbeat: '-',
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
  stateRef.current = state;

  const send = useCallback((payload, target) => (
    socketManager.current?.send(payload, target) || false
  ), []);

  const announceReady = useCallback((target) => {
    send({ type: 'REGISTER', home_id: homeId }, target);
    send({ type: 'READY' }, target);
    if (mounted.current) setState(TV_PLAYER_STATE.READY);
  }, [homeId, send]);

  const onYouTubeState = useCallback((event) => {
    const playback = currentPlayback.current;
    if (event.data === window.YT?.PlayerState?.PLAYING && playback) {
      setState(TV_PLAYER_STATE.PLAYING);
      send({ type: 'PLAYING', request_id: playback.requestId }, playback.socket);
    } else if (event.data === window.YT?.PlayerState?.ENDED && playback) {
      currentPlayback.current = null;
      send({ type: 'ENDED', request_id: playback.requestId }, playback.socket);
      player.current?.stopVideo?.();
      setState(TV_PLAYER_STATE.ENDED);
      window.setTimeout(() => {
        if (mounted.current && prepared.current) announceReady(playback.socket);
      }, 150);
    }
  }, [announceReady, send]);

  const failPlayback = useCallback((code = 'PLAYBACK_FAILED', failed = currentPlayback.current) => {
    if (failed) {
      send({ type: 'FAILED', request_id: failed.requestId, code }, failed.socket);
      send({ type: 'NOT_READY' }, failed.socket);
    }
    currentPlayback.current = null;
    setDebugInfo((current) => ({ ...current, error: code }));
    setMessage('콘텐츠를 재생할 수 없습니다.');
    setState(TV_PLAYER_STATE.ERROR);
  }, [send]);

  const handleSocketMessage = useCallback((event, sourceSocket, generation) => {
    let command;
    try { command = JSON.parse(event.data); } catch { return; }
    if (command.type === 'PING') {
      setDebugInfo((current) => ({ ...current, heartbeat: command.at || new Date().toISOString() }));
      send({ type: 'PONG', at: command.at }, sourceSocket);
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
  }, [announceReady, failPlayback, homeId, send]);
  handleSocketMessageRef.current = handleSocketMessage;

  const ensureSocketManager = useCallback(() => {
    if (socketManager.current) return socketManager.current;
    socketManager.current = new SinglePlayerSocket({
      createSocket: () => new WebSocket(playbackWebSocketUrl(window.location)),
      onOpen: (webSocket) => {
        setDebugInfo((current) => ({ ...current, socket: 'OPEN' }));
        if (prepared.current && player.current) announceReady(webSocket);
      },
      onMessage: (event, webSocket, generation) => {
        handleSocketMessageRef.current?.(event, webSocket, generation);
      },
      onClose: (event, closedSocket) => {
        setDebugInfo((current) => ({ ...current, socket: 'CLOSED' }));
        if (currentPlayback.current?.socket === closedSocket) {
          currentPlayback.current = null;
          player.current?.stopVideo?.();
        }
        if (!mounted.current || !prepared.current) return;
        if (event?.code === 4001) {
          socketManager.current?.cancelReconnect();
          prepared.current = false;
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
  }, [announceReady]);

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
    try {
      if (!paired) {
        if (!pairingCode.trim()) throw new Error('연결 코드를 입력해 주세요.');
        await pairPlayer(fetch, homeId, pairingCode.trim());
        setPaired(true);
      }
      const [YT, webSocket] = await Promise.all([loadYouTubeApi(), connectSocket()]);
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
      setMessage(error.message || '재생 화면을 준비할 수 없습니다.');
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
      {debug && (
        <output className="tv-player__debug">
          state={state}<br />socket={debugInfo.socket}<br />ready={String(state === TV_PLAYER_STATE.READY)}<br />
          request={debugInfo.requestId}<br />video={debugInfo.videoId}<br />error={debugInfo.error}<br />
          heartbeat={debugInfo.heartbeat}<br />home={homeId}
        </output>
      )}
    </main>
  );
}
