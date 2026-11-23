import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { redis } from './db/redis.js';
import { logger } from './lib/logger.js';
import { processPublishSlot } from './processors/publish.js';
import { PUBLISH_QUEUE_NAME } from './queues/publish.js';
import { startReconciler } from './reconciler/index.js';

const worker = new Worker(PUBLISH_QUEUE_NAME, processPublishSlot, {
  connection: redis,
  concurrency: 5,
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'publish job completed');
});

worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, error }, 'publish job failed');
});

const stopReconciler = startReconciler();

logger.info(
  {
    queue: PUBLISH_QUEUE_NAME,
    leaseSeconds: env.PUBLISH_LEASE_SECONDS,
    maxAttempts: env.MAX_PUBLISH_ATTEMPTS,
  },
  'worker listening',
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down worker');

  stopReconciler();
  await worker.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
