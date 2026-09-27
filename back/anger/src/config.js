import 'dotenv/config';

function splitOrigins(value) {
  return (value || 'http://127.0.0.1:5175,http://localhost:5175')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, defaultValue, name, maximum) {
  const raw = value === undefined || value === '' ? String(defaultValue) : String(value);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} 설정이 올바르지 않습니다.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} 설정이 올바르지 않습니다.`);
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 설정이 올바르지 않습니다.');
  }
  return {
    port,
    openAiApiKey: env.OPENAI_API_KEY || '',
    databaseUrl: env.DATABASE_URL || '',
    pg: {
      host: env.PGHOST || '',
      port: Number(env.PGPORT || 5432),
      database: env.PGDATABASE || '',
      user: env.PGUSER || '',
      password: env.PGPASSWORD || '',
      sslmode: env.PGSSLMODE || 'require',
    },
    openAiTimeoutMs: positiveInteger(env.OPENAI_TIMEOUT_MS, 30_000, 'OPENAI_TIMEOUT_MS', 300_000),
    playbackTimeoutMs: positiveInteger(env.PLAYBACK_TIMEOUT_MS, 5_000, 'PLAYBACK_TIMEOUT_MS', 60_000),
    playbackCommandTtlMs: positiveInteger(
      env.PLAYBACK_COMMAND_TTL_MS, 15_000, 'PLAYBACK_COMMAND_TTL_MS', 120_000,
    ),
    playerPairingCode: env.PLAYER_PAIRING_CODE || '',
    playerSessionSecret: env.PLAYER_SESSION_SECRET || '',
    playerSessionTtlSeconds: positiveInteger(
      env.PLAYER_SESSION_TTL_SECONDS, 86_400, 'PLAYER_SESSION_TTL_SECONDS', 2_592_000,
    ),
    playerPairingMaxAttempts: positiveInteger(
      env.PLAYER_PAIRING_MAX_ATTEMPTS, 5, 'PLAYER_PAIRING_MAX_ATTEMPTS', 20,
    ),
    playerPairingWindowMs: positiveInteger(
      env.PLAYER_PAIRING_WINDOW_MS, 300_000, 'PLAYER_PAIRING_WINDOW_MS', 3_600_000,
    ),
    playerCookieSecure: env.PLAYER_COOKIE_SECURE || 'auto',
    allowedOrigins: splitOrigins(env.ANGER_ALLOWED_ORIGINS),
  };
}

export function assertRuntimeConfig(config) {
  if (!config.openAiApiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  if (!config.playerPairingCode) throw new Error('PLAYER_PAIRING_CODE가 설정되지 않았습니다.');
  if (config.playerPairingCode.length < 8) throw new Error('PLAYER_PAIRING_CODE는 8자 이상이어야 합니다.');
  if (!config.playerSessionSecret || config.playerSessionSecret.length < 32) {
    throw new Error('PLAYER_SESSION_SECRET은 32자 이상이어야 합니다.');
  }
  if (!['auto', 'true', 'false'].includes(config.playerCookieSecure)) {
    throw new Error('PLAYER_COOKIE_SECURE 설정이 올바르지 않습니다.');
  }
  if (!config.databaseUrl && (!config.pg.host || !config.pg.database || !config.pg.user || !config.pg.password)) {
    throw new Error('PostgreSQL 환경변수가 설정되지 않았습니다.');
  }
}
