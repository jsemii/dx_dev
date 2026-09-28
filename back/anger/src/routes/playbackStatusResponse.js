import { PLAYER_CONTROL_URL } from '../constants/player.js';

export function playbackStatusResponse(status) {
  return {
    status: status.ready ? 'READY' : status.busy ? 'BUSY'
      : status.connectedPlayers === 0 ? 'OFFLINE' : 'NOT_READY',
    available: true,
    ready: status.ready,
    ready_players: status.readyPlayers,
    connected_players: status.connectedPlayers,
    busy: status.busy,
    control_url: PLAYER_CONTROL_URL,
  };
}

export function unavailablePlaybackStatusResponse() {
  return {
    status: 'UNAVAILABLE',
    available: false,
    ready: false,
    ready_players: 0,
    connected_players: 0,
    busy: false,
    control_url: PLAYER_CONTROL_URL,
  };
}
