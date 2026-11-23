import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2_000,
  query_timeout: 2_000,
});

pool.on('error', (error) => {
  logger.error({ error }, 'unexpected database pool error');
});
