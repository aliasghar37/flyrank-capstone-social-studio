import type { Job } from 'bullmq';
import { logger } from '../lib/logger.js';

export interface PublishJobData {
  slotId: string;
  attemptCount: number;
}

// TODO: claim slot, re-check approval, write attempt, mark request_sent,
// call adapter, record result. Throws for now so nothing is marked published.
export async function processPublishSlot(job: Job<PublishJobData>): Promise<void> {
  logger.warn({ jobId: job.id, slotId: job.data.slotId }, 'publish processor not implemented');
  throw new Error('Publish processor not implemented');
}
