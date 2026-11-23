import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// maxRetriesPerRequest: null is required by BullMQ-compatible connections.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  commandTimeout: 3_000,
});

redis.on('error', (error) => {
  logger.error({ error }, 'redis connection error');
});
