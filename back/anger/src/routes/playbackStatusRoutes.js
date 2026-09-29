import { Router } from 'express';
import { validateHomeId } from '../validation.js';
import {
  playbackStatusResponse,
  unavailablePlaybackStatusResponse,
} from './playbackStatusResponse.js';

export function createPlaybackStatusRouter({ playbackClient }) {
  const router = Router();

  router.get('/playback-status', async (request, response, next) => {
    try {
      const homeId = validateHomeId(request.query.home_id);
      const status = playbackClient.getDetailedStatus?.(homeId) || playbackClient.getStatus(homeId);
      return response.json(playbackStatusResponse(status));
    } catch (error) {
      if (error?.code === 'PLAYBACK_UNAVAILABLE') {
        return response.json(unavailablePlaybackStatusResponse());
      }
      return next(error);
    }
  });

  return router;
}
