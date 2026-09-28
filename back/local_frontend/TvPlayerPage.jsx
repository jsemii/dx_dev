import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlayerSession, pairPlayer } from './playerApi.mjs';
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
      },
      events: {
        onReady: (event) => { event.target.setVolume?.(100); resolve(event.target); },
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
  const socket = useRef(null);
  const reconnectTimer = useRef(null);
  const player = useRef(null);
  const currentRequest = useRef(null);
  const guard = useRef(new PlaybackRequestGuard());
  const wakeLock = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = useCallback((payload) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(payload));
  }, []);

  const announceReady = useCallback(() => {
    send({ type: 'REGISTER', home_id: homeId });
    send({ type: 'READY' });
    if (mounted.current) setState(TV_PLAYER_STATE.READY);
  }, [homeId, send]);

  const onYouTubeState = useCallback((event) => {
    const requestId = currentRequest.current;
    if (event.data === window.YT?.PlayerState?.PLAYING && requestId) {
      setState(TV_PLAYER_STATE.PLAYING);
      send({ type: 'PLAYING', request_id: requestId });
    } else if (event.data === window.YT?.PlayerState?.ENDED && requestId) {
      send({ type: 'ENDED', request_id: requestId });
      currentRequest.current = null;
      player.current?.stopVideo?.();
      setState(TV_PLAYER_STATE.ENDED);
      window.setTimeout(() => mounted.current && announceReady(), 150);
    }
  }, [announceReady, send]);

  const failPlayback = useCallback((code = 'PLAYBACK_FAILED') => {
    if (currentRequest.current) send({ type: 'FAILED', request_id: currentRequest.current, code });
    send({ type: 'NOT_READY' });
    currentRequest.current = null;
    setDebugInfo((current) => ({ ...current, error: code }));
    setMessage('콘텐츠를 재생할 수 없습니다.');
    setState(TV_PLAYER_STATE.ERROR);
  }, [send]);

  const handleSocketMessage = useCallback((event) => {
    let command;
    try { command = JSON.parse(event.data); } catch { return; }
    if (command.type === 'PING') {
      setDebugInfo((current) => ({ ...current, heartbeat: command.at || new Date().toISOString() }));
      send({ type: 'PONG', at: command.at });
      return;
    }
    if (command.type !== 'PLAY') return;
    const decision = decidePlayCommand({
      message: command, homeId, state: stateRef.current,
      currentRequestId: currentRequest.current, guard: guard.current,
    });
    if (decision.action === 'IGNORE_DUPLICATE') return;
    if (decision.action === 'FAILED') {
      send({ type: 'FAILED', request_id: command.request_id, code: decision.code });
      return;
    }
    currentRequest.current = command.request_id;
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
      failPlayback();
    }
  }, [failPlayback, homeId, send]);

  const connectSocket = useCallback(() => new Promise((resolve, reject) => {
    const webSocket = new WebSocket(playbackWebSocketUrl(window.location));
    socket.current = webSocket;
    const timeout = window.setTimeout(() => {
      webSocket.close();
      reject(new Error('재생 서버 연결 시간이 초과되었습니다.'));
    }, 8_000);
    webSocket.addEventListener('open', () => {
      window.clearTimeout(timeout);
      setDebugInfo((current) => ({ ...current, socket: 'OPEN' }));
      if (prepared.current && player.current) {
        if (currentRequest.current) {
          send({ type: 'REGISTER', home_id: homeId });
          send({ type: 'NOT_READY' });
        } else announceReady();
      }
      resolve(webSocket);
    }, { once: true });
    webSocket.addEventListener('message', handleSocketMessage);
    webSocket.addEventListener('error', () => {
      window.clearTimeout(timeout);
      if (!prepared.current) reject(new Error('재생 서버에 연결할 수 없습니다.'));
    });
    webSocket.addEventListener('close', () => {
      window.clearTimeout(timeout);
      setDebugInfo((current) => ({ ...current, socket: 'CLOSED' }));
      if (!mounted.current || !prepared.current) return;
      setState(TV_PLAYER_STATE.DISCONNECTED);
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = window.setTimeout(() => void connectSocket().catch(() => {}), 2_000);
    });
  }), [announceReady, handleSocketMessage, homeId, send]);

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
      const [YT] = await Promise.all([loadYouTubeApi(), connectSocket()]);
      if (!player.current) {
        player.current = await createYouTubePlayer(YT, 'nulbom-tv-player', {
          onStateChange: onYouTubeState,
          onError: () => failPlayback(),
          onAutoplayBlocked: () => failPlayback('AUTOPLAY_BLOCKED'),
        });
      }
      prepared.current = true;
      announceReady();
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
      window.clearTimeout(reconnectTimer.current);
      socket.current?.close();
      wakeLock.current?.release?.();
      player.current?.destroy?.();
    };
  }, [homeId]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible' && prepared.current) void requestWakeLock(); };
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
