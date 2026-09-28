import { ANGER_MONITOR_STATE } from './angerMonitor.mjs';

export function playbackStatusMessage(status) {
  if (status.status === 'CHECKING') return '생활자 재생 화면 상태를 확인하고 있습니다.';
  if (status.status === 'BUSY') return '생활자 화면에서 콘텐츠를 재생 중입니다.';
  return status.available
    ? '생활자 재생 화면을 먼저 준비해 주세요.'
    : '생활자 재생 서비스에 연결할 수 없습니다.';
}

export function blockMonitorForPlayback(monitor, status) {
  const message = playbackStatusMessage(status);
  if (['CHECKING', 'BUSY'].includes(status.status)) monitor.waitForPlayer(message);
  else monitor.blockForPlayer(message);
  return true;
}

export function syncPlaybackMonitor({ enabled, monitor, status, blocked }) {
  if (!enabled) return false;
  if (status.ready) {
    if (blocked) monitor.readyForDetection();
    return false;
  }
  const preservePlaybackState = [
    ANGER_MONITOR_STATE.ANALYZING,
    ANGER_MONITOR_STATE.DETECTED,
    ANGER_MONITOR_STATE.STOPPING_PLAYBACK,
  ].includes(monitor.state);
  if (status.status === 'BUSY' && preservePlaybackState) return blocked;
  return blockMonitorForPlayback(monitor, status);
}
