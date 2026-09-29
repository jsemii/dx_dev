import { useCallback, useEffect, useRef, useState } from 'react';
import TeamCalmCarePage from '../../frontend/frontend/src/CalmCarePage.jsx';
import {
  SAFETY_CARE_HOME_ID,
  getPlaybackStatus,
  getSafetyCareSetting,
  setSafetyCareEnabled,
  startRemoteDetection,
  stopPlayback,
  stopRemoteDetection,
} from './safetyCareApi.mjs';
import { PlaybackReadinessController } from './playbackReadiness.mjs';
import './local-calm-care.css';

const INITIAL_PLAYBACK_STATUS = {
  status: 'CHECKING', available: false, ready: false, ready_players: 0,
  connected_players: 0, busy: false, control_url: '', player_state: 'OFFLINE',
  microphone_ready: false, detection_requested: false, detection_result: null,
};

const STATUS_MESSAGE = {
  OFFLINE: '생활자 재생 화면을 먼저 준비해 주세요.',
  PREPARING: '생활자 재생 화면의 마이크를 준비하고 있습니다.',
  READY: '감지를 시작할 수 있습니다.',
  DETECTING: '생활자 화면에서 주변 소리를 감지하고 있습니다.',
  RECORDING: '생활자 화면에서 10초 동안 녹음하고 있습니다.',
  ANALYZING: '녹음된 음성을 분석하고 있습니다.',
  PLAYING: '생활자 화면에서 안정 콘텐츠를 재생하고 있습니다.',
  COOLDOWN: '재생 소리가 다시 감지되지 않도록 잠시 기다리고 있습니다.',
  ERROR: '생활자 화면의 음성 감지 상태를 확인해 주세요.',
};

export default function LocalCalmCarePage({ onBack, onOpenVoice, onOpenContent, onEnabledChange }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState(INITIAL_PLAYBACK_STATUS);
  const [errorMessage, setErrorMessage] = useState('');
  const mountedRef = useRef(true);
  const playbackStatusRef = useRef(INITIAL_PLAYBACK_STATUS);
  const playbackControllerRef = useRef(null);

  const applyPlaybackStatus = useCallback((status) => {
    if (!mountedRef.current) return;
    playbackStatusRef.current = status;
    setPlaybackStatus(status);
    if (status.available && status.connected_players > 0) setErrorMessage('');
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    getSafetyCareSetting(fetch, SAFETY_CARE_HOME_ID, { signal: controller.signal })
      .then((setting) => {
        if (!mountedRef.current) return;
        setEnabled(setting.enabled);
        onEnabledChange?.(setting.enabled);
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && mountedRef.current) setErrorMessage(error.message);
      })
      .finally(() => { if (mountedRef.current) setLoading(false); });
    return () => { mountedRef.current = false; controller.abort(); };
  }, [onEnabledChange]);

  useEffect(() => {
    const controller = new PlaybackReadinessController({
      getStatus: (signal) => getPlaybackStatus(fetch, SAFETY_CARE_HOME_ID, { signal }),
      onStatus: applyPlaybackStatus,
      onTransientError: () => {},
      onError: () => {
        if (!mountedRef.current) return;
        applyPlaybackStatus({ ...INITIAL_PLAYBACK_STATUS, status: 'UNAVAILABLE' });
        setErrorMessage('생활자 재생 서비스에 연결할 수 없습니다.');
      },
    });
    playbackControllerRef.current = controller;
    controller.start();
    return () => { controller.stop(); playbackControllerRef.current = null; };
  }, [applyPlaybackStatus]);

  const changeEnabled = useCallback(async (nextEnabled) => {
    if (loading || saving) return;
    setSaving(true);
    setErrorMessage('');
    try {
      if (!nextEnabled) {
        try { await stopRemoteDetection(fetch, SAFETY_CARE_HOME_ID); } catch { /* OFF remains possible offline. */ }
      }
      const setting = await setSafetyCareEnabled(fetch, SAFETY_CARE_HOME_ID, nextEnabled);
      if (!mountedRef.current) return;
      setEnabled(setting.enabled);
      onEnabledChange?.(setting.enabled);
      await playbackControllerRef.current?.poll();
    } catch (error) {
      if (mountedRef.current) setErrorMessage(error.message);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [loading, onEnabledChange, saving]);

  const startDetection = useCallback(async () => {
    if (!enabled || saving) return;
    setSaving(true);
    setErrorMessage('');
    try {
      let status = await getPlaybackStatus(fetch, SAFETY_CARE_HOME_ID);
      applyPlaybackStatus(status);
      if (status.busy) {
        await stopPlayback(fetch, SAFETY_CARE_HOME_ID);
        status = await getPlaybackStatus(fetch, SAFETY_CARE_HOME_ID);
        applyPlaybackStatus(status);
      }
      if (!status.ready || !status.microphone_ready) {
        throw new Error('생활자 재생 화면을 먼저 준비해 주세요.');
      }
      const setting = await getSafetyCareSetting(fetch, SAFETY_CARE_HOME_ID);
      if (!setting.enabled) {
        setEnabled(false);
        onEnabledChange?.(false);
        return;
      }
      await startRemoteDetection(fetch, SAFETY_CARE_HOME_ID);
      const refreshed = await playbackControllerRef.current?.poll();
      if (refreshed) applyPlaybackStatus(refreshed);
    } catch (error) {
      if (mountedRef.current) setErrorMessage(error.message || '감지를 시작하지 못했습니다.');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [applyPlaybackStatus, enabled, onEnabledChange, saving]);

  const stopDetection = useCallback(async () => {
    if (!enabled || saving) return;
    setSaving(true);
    setErrorMessage('');
    try {
      await stopRemoteDetection(fetch, SAFETY_CARE_HOME_ID);
      const refreshed = await playbackControllerRef.current?.poll();
      if (refreshed) applyPlaybackStatus(refreshed);
    } catch (error) {
      if (mountedRef.current) setErrorMessage(error.message || '감지를 중지하지 못했습니다.');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [applyPlaybackStatus, enabled, saving]);

  const playerState = playbackStatus.player_state;
  const detected = playbackStatus.detection_result === 'DETECTED';
  const canStart = enabled && playbackStatus.ready && playbackStatus.microphone_ready
    && !playbackStatus.detection_requested && !playbackStatus.busy;
  return (
    <div className="local-calm-care-shell" aria-busy={loading || saving}>
      <TeamCalmCarePage
        onBack={onBack}
        enabled={enabled}
        onEnabledChange={changeEnabled}
        onOpenVoice={onOpenVoice}
        onOpenContent={onOpenContent}
      />
      {enabled && (
        <section className="local-calm-care-status" aria-live="polite">
          <strong>{detected && playbackStatus.busy ? '분노 표현 감지됨'
            : errorMessage || playerState === 'ERROR' ? '감지 오류'
              : playerState === 'OFFLINE' ? '재생 화면 준비 필요'
                : '안정 돌봄 감지 상태'}</strong>
          <p>{errorMessage || (detected && playbackStatus.busy
            ? '분노 표현을 감지했어요. 생활자 화면에서 안정 콘텐츠를 재생하고 있어요.'
            : STATUS_MESSAGE[playerState] || '생활자 재생 화면 상태를 확인하고 있습니다.')}</p>
          {playbackStatus.detection_requested && !playbackStatus.busy ? (
            <button type="button" onClick={stopDetection} disabled={saving}>감지 중지</button>
          ) : (canStart || detected || playbackStatus.busy || errorMessage || playerState === 'ERROR') && (
            <button type="button" onClick={startDetection} disabled={saving}>
              {detected || playbackStatus.busy ? '감지 재개' : '감지 시작'}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
