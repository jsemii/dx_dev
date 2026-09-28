import { Router } from 'express';
import { validateHomeId } from '../validation.js';
import {
  createPlayerSession, playerSessionCookie, secureEqual, sessionFromCookieHeader,
  PairingAttemptLimiter,
} from '../services/playerSession.js';
import { badRequest, tooManyRequests } from '../errors.js';
import { playbackStatusResponse } from './playbackStatusResponse.js';

function secureRequest(request, mode) {
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  return request.secure || request.get('x-forwarded-proto') === 'https';
}

export function createPlaybackRouter({ config, playbackGateway }) {
  const router = Router();
  const limiter = new PairingAttemptLimiter({
    maxAttempts: config.playerPairingMaxAttempts,
    windowMs: config.playerPairingWindowMs,
  });

  router.post('/pair', (request, response, next) => {
    try {
      const homeId = validateHomeId(request.body?.home_id);
      const limitKey = `${request.ip}:${homeId}`;
      const limit = limiter.status(limitKey);
      if (!limit.allowed) {
        response.setHeader('Retry-After', String(limit.retryAfterSeconds));
        throw tooManyRequests('pairing_rate_limited', '연결 코드 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.');
      }
      if (!secureEqual(request.body?.pairing_code || '', config.playerPairingCode)) {
        limiter.failure(limitKey);
        throw badRequest('invalid_pairing_code', '재생 화면 연결 코드를 확인해 주세요.');
      }
      limiter.success(limitKey);
      const token = createPlayerSession(homeId, config.playerSessionSecret, config.playerSessionTtlSeconds);
      response.setHeader('Set-Cookie', playerSessionCookie(
        token, config.playerSessionTtlSeconds, secureRequest(request, config.playerCookieSecure),
      ));
      response.json({ paired: true, home_id: homeId });
    } catch (error) { next(error); }
  });

  router.get('/session', (request, response) => {
    const session = sessionFromCookieHeader(request.headers.cookie, config.playerSessionSecret);
    const requestedHome = request.query.home_id;
    response.json({ paired: Boolean(session && session.home_id === requestedHome) });
  });

  router.get('/status', (request, response, next) => {
    try {
      const homeId = validateHomeId(request.query.home_id);
      const status = playbackGateway.getStatus(homeId);
      response.json(playbackStatusResponse(status));
    } catch (error) { next(error); }
  });

  router.post('/stop', async (request, response, next) => {
    try {
      const homeId = validateHomeId(request.body?.home_id);
      const result = await playbackGateway.stopPlayback(homeId);
      response.json({
        home_id: homeId,
        stopped: result.stopped,
        status: 'READY',
        ready: result.ready,
      });
    } catch (error) { next(error); }
  });

  return router;
}
