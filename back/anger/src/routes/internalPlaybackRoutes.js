import { Router } from 'express';
import { badRequest, unauthorized, unavailable } from '../errors.js';
import { validateHomeId, validateUuid } from '../validation.js';
import { secureEqual } from '../services/playerSession.js';
import {
  ALARM_AUDIO_MIME_TYPE, DEFAULT_MAX_ALARM_AUDIO_BYTES,
} from '../services/playbackGateway.js';

function decodeStrictBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw badRequest('invalid_audio_data', '알림 음성 데이터 형식이 올바르지 않습니다.');
  }
  return Buffer.from(value, 'base64');
}

export function createInternalPlaybackRouter({ config, playbackGateway }) {
  const router = Router();
  const maxBytes = config.alarmAudioMaxBytes || DEFAULT_MAX_ALARM_AUDIO_BYTES;

  router.use((request, _response, next) => {
    try {
      if (!config.playbackInternalToken || config.playbackInternalToken.length < 32) {
        throw unavailable('internal_playback_disabled', '내부 알림 재생 서비스가 설정되지 않았습니다.');
      }
      if (request.headers.origin) {
        throw unauthorized('internal_route_only', '내부 서비스 전용 요청입니다.');
      }
      const token = request.get('x-internal-token') || '';
      if (!secureEqual(token, config.playbackInternalToken)) {
        throw unauthorized('invalid_internal_token', '내부 서비스 인증에 실패했습니다.');
      }
      next();
    } catch (error) { next(error); }
  });

  router.post('/audio', async (request, response, next) => {
    try {
      const homeId = validateHomeId(request.body?.home_id);
      const alarmId = validateUuid(request.body?.alarm_id, '알림 ID');
      const requestId = validateUuid(request.body?.request_id, '요청 ID');
      if (request.body?.mime_type !== ALARM_AUDIO_MIME_TYPE) {
        throw badRequest('invalid_audio_mime', '지원하지 않는 알림 음성 형식입니다.');
      }
      const audio = decodeStrictBase64(request.body?.audio);
      if (audio.length < 1 || audio.length > maxBytes) {
        throw badRequest(
          audio.length > maxBytes ? 'audio_too_large' : 'invalid_audio_data',
          '알림 음성 데이터 크기가 올바르지 않습니다.',
        );
      }
      const result = await playbackGateway.requestAudioPlayback({
        homeId,
        alarmId,
        requestId,
        audio,
        mimeType: request.body.mime_type,
        maxBytes,
      });
      response.json({
        request_id: result.requestId,
        status: result.status,
        started_at: result.startedAt,
        ended_at: result.endedAt,
        failure_code: result.failureCode,
      });
    } catch (error) { next(error); }
  });

  return router;
}
