import { ANGER_MONITOR_STATE } from './angerMonitor.mjs';

const RESUMABLE_STATES = new Set([
  ANGER_MONITOR_STATE.NOT_DETECTED,
  ANGER_MONITOR_STATE.ERROR,
  ANGER_MONITOR_STATE.DETECTED,
  ANGER_MONITOR_STATE.STOPPING_PLAYBACK,
  ANGER_MONITOR_STATE.PLAYER_CHECKING,
  ANGER_MONITOR_STATE.PLAYER_NOT_READY,
  ANGER_MONITOR_STATE.READY_TO_START,
]);

export async function resumeDetectionWorkflow({
  homeId,
  monitor,
  playbackStatus,
  getPlaybackStatus,
  stopPlayback,
  getSetting,
}) {
  const currentPlaybackStatus = getPlaybackStatus
    ? await getPlaybackStatus(homeId)
    : playbackStatus;
  const detectedWhileBusy = monitor.state === ANGER_MONITOR_STATE.DETECTED
    && currentPlaybackStatus.status === 'BUSY';
  if (detectedWhileBusy) {
    monitor.beginPlaybackStop();
    const stopped = await stopPlayback(homeId);
    if (!stopped?.ready) throw new Error('생활자 재생 화면의 영상 중지를 확인하지 못했습니다.');
  } else if (!currentPlaybackStatus.ready) {
    const error = new Error('생활자 재생 화면을 먼저 준비해 주세요.');
    error.code = currentPlaybackStatus.status === 'OFFLINE'
      ? 'PLAYER_OFFLINE' : 'PLAYBACK_NOT_READY';
    throw error;
  }

  const setting = await getSetting(homeId);
  if (!setting.enabled) {
    monitor.stop();
    return { enabled: false, resumed: false };
  }
  if (RESUMABLE_STATES.has(monitor.state)) await monitor.resume();
  else await monitor.start();
  return { enabled: true, resumed: true };
}
