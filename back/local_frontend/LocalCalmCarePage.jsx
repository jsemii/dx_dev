import { useCallback, useEffect, useRef, useState } from 'react';
import TeamCalmCarePage from '../../frontend/frontend/src/CalmCarePage.jsx';
import { AngerMonitor, ANGER_MONITOR_STATE } from './angerMonitor.mjs';
import {
  SAFETY_CARE_HOME_ID,
  analyzeAnger,
  getPlaybackStatus,
  getSafetyCareSetting,
  setSafetyCareEnabled,
  stopPlayback,
} from './safetyCareApi.mjs';
import { PlaybackReadinessController } from './playbackReadiness.mjs';
import {
  blockMonitorForPlayback,
  syncPlaybackMonitor,
} from './playbackStatusTransition.mjs';
import { resumeDetectionWorkflow } from './resumeDetection.mjs';
import './local-calm-care.css';

const STATUS_MESSAGE = {
  REQUESTING_PERMISSION: '마이크 권한을 확인하고 있습니다.',
  LISTENING: '주변 소리를 감지하고 있습니다.',
  RECORDING: '10초 동안 녹음하고 있습니다.',
  ANALYZING: '녹음된 음성을 분석하고 있습니다.',
  DETECTED: '분노 표현을 감지했어요. 생활자 화면에서 안정 콘텐츠를 재생하고 있어요.',
  STOPPING_PLAYBACK: '생활자 화면의 영상을 중지하고 감지를 다시 준비하고 있습니다.',
  PLAYER_CHECKING: '생활자 재생 화면 상태를 확인하고 있습니다.',
  PLAYER_NOT_READY: '생활자 재생 화면을 먼저 준비해 주세요.',
  READY_TO_START: '감지를 시작할 수 있습니다.',
};

const INITIAL_PLAYBACK_STATUS = {
  status: 'CHECKING',
  available: false,
  ready: false,
  ready_players: 0,
  connected_players: 0,
  busy: false,
  control_url: '',
};

export default function LocalCalmCarePage({ onBack, onOpenVoice, onOpenContent, onEnabledChange }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [monitorStatus, setMonitorStatus] = useState({ state: ANGER_MONITOR_STATE.OFF });
  const [playbackStatus, setPlaybackStatus] = useState(INITIAL_PLAYBACK_STATUS);
  const [audioLevels, setAudioLevels] = useState([]);
  const mountedRef = useRef(true);
  const enabledRef = useRef(false);
  const playbackStatusRef = useRef(INITIAL_PLAYBACK_STATUS);
  const playbackBlockedRef = useRef(false);
  const monitorRef = useRef(null);
  const playbackControllerRef = useRef(null);

  if (!monitorRef.current) {
    monitorRef.current = new AngerMonitor({
      analyze: (audio, sessionId, signal) => analyzeAnger(
        fetch,
        SAFETY_CARE_HOME_ID,
        sessionId,
        audio,
        { signal },
      ),
      onState: (status) => {
        if (mountedRef.current) setMonitorStatus(status);
      },
      onLevel: (level) => {
        if (!mountedRef.current) return;
        if (level === null) {
          setAudioLevels([]);
          return;
        }
        setAudioLevels((current) => [...current.slice(-39), level]);
      },
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    getSafetyCareSetting(fetch, SAFETY_CARE_HOME_ID, { signal: controller.signal })
      .then(async (setting) => {
        if (!mountedRef.current) return;
        setEnabled(setting.enabled);
        enabledRef.current = setting.enabled;
        onEnabledChange?.(setting.enabled);
        if (setting.enabled && !playbackStatusRef.current.ready) {
          playbackBlockedRef.current = blockMonitorForPlayback(
            monitorRef.current, playbackStatusRef.current,
          );
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && mountedRef.current) {
          setMonitorStatus({ state: ANGER_MONITOR_STATE.ERROR, message: error.message });
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      monitorRef.current?.stop();
    };
  }, [onEnabledChange]);

  useEffect(() => {
    const controller = new PlaybackReadinessController({
      getStatus: (signal) => getPlaybackStatus(fetch, SAFETY_CARE_HOME_ID, { signal }),
      onStatus: (status) => {
        if (!mountedRef.current) return;
        playbackStatusRef.current = status;
        setPlaybackStatus(status);
        playbackBlockedRef.current = syncPlaybackMonitor({
          enabled: enabledRef.current,
          monitor: monitorRef.current,
          status,
          blocked: playbackBlockedRef.current,
        });
      },
      onTransientError: () => {
        // Keep the last known state. A single polling failure must not turn READY into unavailable.
      },
      onError: () => {
        if (!mountedRef.current) return;
        const status = {
          ...playbackStatusRef.current,
          status: 'UNAVAILABLE',
          available: false,
          ready: false,
          ready_players: 0,
          connected_players: 0,
          busy: false,
        };
        playbackStatusRef.current = status;
        setPlaybackStatus(status);
        if (enabledRef.current) {
          playbackBlockedRef.current = true;
          monitorRef.current.blockForPlayer('YouTube 재생 서버에 연결할 수 없습니다.');
        }
      },
    });
    playbackControllerRef.current = controller;
    controller.start();
    return () => {
      controller.stop();
      if (playbackControllerRef.current === controller) playbackControllerRef.current = null;
    };
  }, []);

  const changeEnabled = useCallback(async (nextEnabled) => {
    if (loading || saving) return;
    setSaving(true);
    if (!nextEnabled) {
      playbackBlockedRef.current = false;
      monitorRef.current.stop();
    }
    try {
      const setting = await setSafetyCareEnabled(fetch, SAFETY_CARE_HOME_ID, nextEnabled);
      if (!mountedRef.current) return;
      setEnabled(setting.enabled);
      enabledRef.current = setting.enabled;
      onEnabledChange?.(setting.enabled);
      if (setting.enabled) {
        const refreshedStatus = await playbackControllerRef.current?.poll();
        if (!mountedRef.current) return;
        const status = refreshedStatus || playbackStatusRef.current;
        if (status.ready) {
          playbackBlockedRef.current = false;
          await monitorRef.current.start();
        } else {
          playbackBlockedRef.current = blockMonitorForPlayback(monitorRef.current, status);
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        setMonitorStatus({ state: ANGER_MONITOR_STATE.ERROR, message: error.message });
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [loading, onEnabledChange, saving]);

  const resumeDetection = useCallback(async () => {
    if (!enabled || saving) return;
    setSaving(true);
    try {
      const result = await resumeDetectionWorkflow({
        homeId: SAFETY_CARE_HOME_ID,
        monitor: monitorRef.current,
        playbackStatus: playbackStatusRef.current,
        getPlaybackStatus: (homeId) => getPlaybackStatus(fetch, homeId),
        stopPlayback: (homeId) => stopPlayback(fetch, homeId),
        getSetting: (homeId) => getSafetyCareSetting(fetch, homeId),
      });
      if (!mountedRef.current) return;
      if (!result.enabled) {
        setEnabled(false);
        enabledRef.current = false;
        onEnabledChange?.(false);
      }
    } catch (error) {
      if (mountedRef.current) {
        monitorRef.current.reportError(
          error.message || '감지를 다시 시작하지 못했습니다.', error.code,
        );
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [enabled, onEnabledChange, saving]);

  const state = monitorStatus.state;
  const playerReady = playbackStatus.ready;
  const showStatus = enabled && ![
    ANGER_MONITOR_STATE.OFF,
    ANGER_MONITOR_STATE.READY_TO_START,
  ].includes(state)
    && !([ANGER_MONITOR_STATE.PLAYER_NOT_READY, ANGER_MONITOR_STATE.PLAYER_CHECKING]
      .includes(state) && playerReady);
  const showDetectionStart = enabled && playerReady
    && [
      ANGER_MONITOR_STATE.OFF,
      ANGER_MONITOR_STATE.PLAYER_CHECKING,
      ANGER_MONITOR_STATE.PLAYER_NOT_READY,
      ANGER_MONITOR_STATE.READY_TO_START,
    ].includes(state);
  const canResumeDetected = ['READY', 'BUSY'].includes(playbackStatus.status);
  const showWaveform = [ANGER_MONITOR_STATE.LISTENING, ANGER_MONITOR_STATE.RECORDING].includes(state);
  const waveform = Array.from({ length: 40 }, (_, index) => (
    audioLevels[index - (40 - audioLevels.length)] ?? 0.03
  ));
  return (
    <div className="local-calm-care-shell" aria-busy={loading || saving}>
      <TeamCalmCarePage
        onBack={onBack}
        enabled={enabled}
        onEnabledChange={changeEnabled}
        onOpenVoice={onOpenVoice}
        onOpenContent={onOpenContent}
      />
      {showDetectionStart && (
        <section className="local-calm-care-status" aria-live="polite">
          <strong>안정 돌봄 감지 상태</strong>
          <p>감지를 시작할 수 있습니다.</p>
          <button type="button" onClick={resumeDetection}>감지 시작</button>
        </section>
      )}
      {showStatus && (
        <section className="local-calm-care-status" aria-live="polite">
          {state === ANGER_MONITOR_STATE.NOT_DETECTED ? (
            <div className="local-calm-care-result-actions">
              <button type="button" disabled>분노 감지 안됨</button>
              <button type="button" onClick={resumeDetection} disabled={!playerReady || saving}>감지 재개</button>
            </div>
          ) : state === ANGER_MONITOR_STATE.DETECTED ? (
            <div className="local-calm-care-detected-result">
              <strong>분노 표현 감지됨</strong>
              <p>분노 표현을 감지했어요. 생활자 화면에서 안정 콘텐츠를 재생하고 있어요.</p>
              <button type="button" onClick={resumeDetection} disabled={!canResumeDetected || saving}>감지 재개</button>
            </div>
          ) : (
            <>
              <strong>{state === ANGER_MONITOR_STATE.ERROR ? '감지 오류'
                : state === ANGER_MONITOR_STATE.PLAYER_NOT_READY ? '재생 화면 준비 필요'
                  : state === ANGER_MONITOR_STATE.PLAYER_CHECKING ? '재생 화면 확인 중'
                  : '안정 돌봄 감지 상태'}</strong>
              <p>{monitorStatus.message || STATUS_MESSAGE[state] || '감지를 중지했습니다.'}</p>
              {showWaveform && (
                <div className="local-calm-care-waveform" role="img" aria-label="실시간 마이크 음량 파형">
                  {waveform.map((level, index) => (
                    <span key={index} style={{ height: `${Math.max(4, Math.round(level * 48))}px` }} />
                  ))}
                </div>
              )}
              {state === ANGER_MONITOR_STATE.ERROR && (
                <button type="button" onClick={resumeDetection} disabled={!playerReady || saving}>감지 재개</button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
