import { Queue } from 'bullmq';
import { redis } from '../db/redis.js';

export const PUBLISH_QUEUE_NAME = 'publish';

/**
 * BullMQ is only the wake-up mechanism. The `slots` table in PostgreSQL is the
 * durable job store, so losing Redis never loses scheduled work.
 */
export const publishQueue = new Queue(PUBLISH_QUEUE_NAME, {
  connection: redis,
});
