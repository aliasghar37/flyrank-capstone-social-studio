import type { Job } from 'bullmq';
import { logger } from '../lib/logger.js';

export interface PublishJobData {
  slotId: string;
  attemptCount: number;
}

/**
 * Phase 4 fills this in with the real flow:
 *   atomic claim -> verify variant still approved -> attempt journal ->
 *   mark request_sent -> adapter.publish -> success transaction.
 *
 * Until then it throws so a scaffold can never silently report a successful
 * publish.
 */
export async function processPublishSlot(job: Job<PublishJobData>): Promise<void> {
  logger.warn({ jobId: job.id, slotId: job.data.slotId }, 'publish processor not implemented');
  throw new Error('Publish processor is not implemented yet (Phase 4)');
}
