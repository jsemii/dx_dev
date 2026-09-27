import { WebSocketServer } from 'ws';
import { sessionFromCookieHeader } from './services/playerSession.js';

function reject(socket, status, message) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
  socket.destroy();
}

export function attachPlaybackWebSocket(server, { config, playbackGateway }) {
  const webSocketServer = new WebSocketServer({ noServer: true, clientTracking: true });
  server.on('upgrade', (request, socket, head) => {
    let url;
    try { url = new URL(request.url, 'http://internal'); } catch { reject(socket, '400 Bad Request', 'bad request'); return; }
    if (url.pathname !== '/ws/playback') {
      reject(socket, '404 Not Found', 'not found');
      return;
    }
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.includes(origin)) {
      reject(socket, '403 Forbidden', 'forbidden');
      return;
    }
    const session = sessionFromCookieHeader(request.headers.cookie, config.playerSessionSecret);
    if (!session) {
      reject(socket, '401 Unauthorized', 'unauthorized');
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      playbackGateway.attach(webSocket, session.home_id);
      webSocketServer.emit('connection', webSocket, request);
    });
  });
  return webSocketServer;
}
