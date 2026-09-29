import { loadConfig, assertRuntimeConfig } from './config.js';
import { createServer } from 'node:http';
import { createPool } from './db.js';
import { createApp } from './app.js';
import { SafetyCareRepository } from './repositories/safetyCareRepository.js';
import { PreferredContentRepository } from './repositories/preferredContentRepository.js';
import { TranscriptionService } from './services/transcriptionService.js';
import { PlaybackGateway } from './services/playbackGateway.js';
import { AngerAnalysisService } from './services/angerAnalysisService.js';
import { SessionResultCache } from './services/sessionResultCache.js';
import { closeAngerResources } from './lifecycle.js';
import { attachPlaybackWebSocket } from './playbackWebSocket.js';
import {
  PLAYER_CONNECTION_TIMEOUT_MS,
  PLAYER_HEARTBEAT_INTERVAL_MS,
  PLAYER_STATE_HEARTBEAT_TIMEOUT_MS,
} from './constants/player.js';

const config = loadConfig();
assertRuntimeConfig(config);
const pool = createPool(config);
const safetyCareRepository = new SafetyCareRepository(pool);
const preferredContentRepository = new PreferredContentRepository(pool);
const transcriptionService = new TranscriptionService(
  config.openAiApiKey,
  null,
  config.openAiTimeoutMs,
);
const playbackClient = new PlaybackGateway({
  ackTimeoutMs: config.playbackTimeoutMs,
  commandTtlMs: config.playbackCommandTtlMs,
  audioCompletionTimeoutMs: config.playbackAudioCompletionTimeoutMs,
  connectionTimeoutMs: PLAYER_CONNECTION_TIMEOUT_MS,
  stateHeartbeatTimeoutMs: PLAYER_STATE_HEARTBEAT_TIMEOUT_MS,
  logger: console,
});
const analysisService = new AngerAnalysisService({
  safetyCareRepository,
  preferredContentRepository,
  transcriptionService,
  playbackClient,
});
const sessionCache = new SessionResultCache();
const app = createApp({
  config, safetyCareRepository, analysisService, playbackClient, sessionCache,
});

const server = createServer(app);
const webSocketServer = attachPlaybackWebSocket(server, { config, playbackGateway: playbackClient });
const heartbeat = setInterval(() => playbackClient.heartbeat(), PLAYER_HEARTBEAT_INTERVAL_MS);
heartbeat.unref?.();

server.listen(config.port, '0.0.0.0', () => {
  console.info(`Anger API listening on port ${config.port}`);
});

async function shutdown() {
  clearInterval(heartbeat);
  await closeAngerResources(server, pool, { playbackGateway: playbackClient, webSocketServer });
}

let shuttingDown = false;
async function handleShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await shutdown();
  } catch {
    process.exitCode = 1;
  }
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
