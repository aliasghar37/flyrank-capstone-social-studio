import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { redis } from './db/redis.js';
import { logger } from './lib/logger.js';

const server = createServer(app);

server.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, 'api listening');
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down api');

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await pool.end();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
