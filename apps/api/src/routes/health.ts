import { Router } from 'express';
import { pool } from '../db/pool.js';
import { redis } from '../db/redis.js';

export const healthRouter: Router = Router();

healthRouter.get('/health', async (_req, res) => {
  const [database, cache] = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()]);
  const ok = database.status === 'fulfilled' && cache.status === 'fulfilled';

  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    checks: {
      database: database.status,
      redis: cache.status,
    },
    uptimeSeconds: Math.round(process.uptime()),
  });
});
