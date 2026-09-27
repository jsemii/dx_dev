import pg from 'pg';

const { Pool } = pg;

export function createPool(config) {
  const ssl = config.pg.sslmode === 'disable' ? false : { rejectUnauthorized: false };
  if (config.databaseUrl) {
    return new Pool({ connectionString: config.databaseUrl, ssl, max: 5 });
  }
  return new Pool({
    host: config.pg.host,
    port: config.pg.port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
    ssl,
    max: 5,
  });
}
