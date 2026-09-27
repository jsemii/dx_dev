import { Router } from 'express';
import { validateHomeId } from '../validation.js';
import { PLAYER_CONTROL_URL } from '../constants/player.js';

export function createPlaybackStatusRouter({ playbackClient }) {
  const router = Router();

  router.get('/playback-status', async (request, response, next) => {
    try {
      const homeId = validateHomeId(request.query.home_id);
      const status = playbackClient.getStatus(homeId);
      return response.json({
        status: status.ready ? 'READY' : status.busy ? 'BUSY'
          : status.connectedPlayers === 0 ? 'OFFLINE' : 'NOT_READY',
        available: true,
        ready: status.ready,
        ready_players: status.readyPlayers,
        control_url: PLAYER_CONTROL_URL,
      });
    } catch (error) {
      if (error?.code === 'PLAYBACK_UNAVAILABLE') {
        return response.json({
          status: 'UNAVAILABLE',
          available: false,
          ready: false,
          ready_players: 0,
          control_url: PLAYER_CONTROL_URL,
        });
      }
      return next(error);
    }
  });

  return router;
}
