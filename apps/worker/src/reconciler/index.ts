import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// TODO: enqueue overdue and retry-due slots, recover stale leases,
// cancel slots whose variant is no longer approved.
export function startReconciler(): () => void {
  const timer = setInterval(() => {
    logger.debug('reconciler tick (scaffold)');
  }, env.RECONCILE_INTERVAL_SECONDS * 1000);

  timer.unref();
  return () => clearInterval(timer);
}
