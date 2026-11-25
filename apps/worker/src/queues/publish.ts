import { Queue } from 'bullmq';
import { redis } from '../db/redis.js';

export const PUBLISH_QUEUE_NAME = 'publish';

// Jobs only wake the worker. Scheduled work lives in the slots table,
// so nothing is lost if Redis is flushed.
export const publishQueue = new Queue(PUBLISH_QUEUE_NAME, {
  connection: redis,
});
