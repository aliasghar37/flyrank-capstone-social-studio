import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Phase 5 turns this into the safety net:
 *  - enqueue missed/overdue slots,
 *  - enqueue retry-due slots,
 *  - recover stale leases (reset safe ones, mark ambiguous ones uncertain),
 *  - cancel slots whose variant is no longer approved.
 */
export function startReconciler(): () => void {
  const timer = setInterval(() => {
    logger.debug('reconciler tick (scaffold)');
  }, env.RECONCILE_INTERVAL_SECONDS * 1000);

  timer.unref();
  return () => clearInterval(timer);
}
