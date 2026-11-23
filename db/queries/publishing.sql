-- Reference queries for the publish path. Parameters are $1..$n (node-postgres style).
-- Rule: any write after the claim is fenced on claim_token. 0 rows affected = you lost the lease; stop.

-- name: ScheduleVariant  (API; trigger raises SS003 if not approved, unique index -> 23505 if already scheduled)
INSERT INTO slots (variant_id, owner_id, adapter_key, scheduled_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ClaimSlot  (worker; $2 = new random claim_token, $3 = worker_id)
UPDATE slots
SET status = 'publishing', claim_token = $2, claimed_by = $3, claimed_at = now(),
    attempt_count = attempt_count + 1, next_attempt_at = NULL
WHERE id = $1
  AND (status = 'scheduled' OR (status = 'retry_wait' AND next_attempt_at <= now()))
RETURNING id, variant_id, owner_id, adapter_key, idempotency_key, attempt_count;

-- name: StartAttempt  ($4 = attempt_count from ClaimSlot, $5 = effective adapter_key)
INSERT INTO publish_attempts (slot_id, owner_id, idempotency_key, attempt_no, adapter_key, claim_token, worker_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id;

-- name: MarkRequestSent  (write-ahead, immediately before the HTTP call)
UPDATE publish_attempts a
SET status = 'request_sent', request_sent_at = now()
FROM slots s
WHERE a.id = $1 AND a.status = 'started'
  AND s.id = a.slot_id AND s.status = 'publishing' AND s.claim_token = $2
RETURNING a.id;

-- name: RecordSuccess  (one transaction, in this order; ROLLBACK if the slot update returns 0 rows)
-- A late success may also settle a slot the reconciler already marked 'uncertain'.
BEGIN;
UPDATE slots
SET status = 'published', external_id = $3, external_url = $4, published_at = now(),
    claim_token = NULL, last_error = NULL
WHERE id = $1 AND ((status = 'publishing' AND claim_token = $2) OR status = 'uncertain')
RETURNING id, variant_id;
UPDATE publish_attempts
SET status = 'succeeded', external_id = $3, external_url = $4, http_status = $6, finished_at = now()
WHERE id = $5 AND status IN ('request_sent', 'uncertain');
UPDATE variants SET status = 'published' WHERE id = $7 AND status = 'approved';
COMMIT;

-- name: RecordRetryableFailure  ($3 = delay seconds: max(backoff, retry_after))
BEGIN;
UPDATE slots
SET status = 'retry_wait', next_attempt_at = now() + make_interval(secs => $3),
    claim_token = NULL, last_error = $4
WHERE id = $1 AND status = 'publishing' AND claim_token = $2
RETURNING id, attempt_count;
UPDATE publish_attempts
SET status = 'failed_retryable', http_status = $6, error_code = $7, error_message = $4,
    retry_after_ms = $8, finished_at = now()
WHERE id = $5 AND status IN ('started', 'request_sent');
COMMIT;

-- name: RecordPermanentFailure  (also used when attempt_count >= MAX_PUBLISH_ATTEMPTS)
BEGIN;
UPDATE slots SET status = 'failed', claim_token = NULL, last_error = $3
WHERE id = $1 AND status = 'publishing' AND claim_token = $2
RETURNING id;
UPDATE publish_attempts
SET status = 'failed_permanent', http_status = $5, error_code = $6, error_message = $3, finished_at = now()
WHERE id = $4 AND status IN ('started', 'request_sent');
COMMIT;

-- name: CancelSlotVariantNotApproved  (worker defence in depth, after claim)
UPDATE slots SET status = 'cancelled', claim_token = NULL, cancel_reason = 'variant_no_longer_approved'
WHERE id = $1 AND status = 'publishing' AND claim_token = $2;


-- ---------- Reconciler (every RECONCILE_INTERVAL_SECONDS and at boot) ----------

-- name: FindDueSlots  (enqueue with jobId = `${id}_${attempt_count}`; BullMQ dedupes)
SELECT id, attempt_count FROM slots
WHERE status = 'scheduled' AND scheduled_at <= now() + make_interval(secs => $1)
ORDER BY scheduled_at LIMIT 500;

-- name: FindRetryDueSlots
SELECT id, attempt_count FROM slots
WHERE status = 'retry_wait' AND next_attempt_at <= now()
ORDER BY next_attempt_at LIMIT 500;

-- name: RecoverStaleLeasesNothingSent  (crash before request_sent: safe to retry)
WITH stale AS (
  SELECT s.id FROM slots s
  WHERE s.status = 'publishing' AND s.claimed_at < now() - make_interval(secs => $1)
    AND NOT EXISTS (SELECT 1 FROM publish_attempts a WHERE a.slot_id = s.id AND a.status = 'request_sent')
  FOR UPDATE OF s SKIP LOCKED
), closed AS (
  UPDATE publish_attempts a
  SET status = 'failed_retryable', error_code = 'LEASE_EXPIRED',
      error_message = 'worker lease expired before the request was sent', finished_at = now()
  FROM stale WHERE a.slot_id = stale.id AND a.status = 'started'
)
UPDATE slots s
SET status = 'retry_wait', next_attempt_at = now(), claim_token = NULL,
    last_error = 'worker lease expired before the request was sent'
FROM stale WHERE s.id = stale.id
RETURNING s.id, s.attempt_count;

-- name: FindStaleLeasesRequestSent  (ambiguity window: lookup via adapter if supported, else MarkUncertain)
SELECT s.id, s.claim_token, s.adapter_key, s.idempotency_key, a.id AS attempt_id, a.adapter_key AS attempt_adapter_key
FROM slots s
JOIN publish_attempts a ON a.slot_id = s.id AND a.status = 'request_sent'
WHERE s.status = 'publishing' AND s.claimed_at < now() - make_interval(secs => $1)
LIMIT 100;

-- name: MarkUncertain
BEGIN;
UPDATE slots SET status = 'uncertain', claim_token = NULL,
       last_error = 'worker stopped after the request was sent; outcome unknown'
WHERE id = $1 AND status = 'publishing' AND claim_token = $2
RETURNING id;
UPDATE publish_attempts SET status = 'uncertain' WHERE id = $3 AND status = 'request_sent';
COMMIT;

-- name: CancelSlotsForUnapprovedVariants
UPDATE slots s SET status = 'cancelled', cancel_reason = 'variant_no_longer_approved'
FROM variants v
WHERE v.id = s.variant_id AND v.status <> 'approved' AND s.status IN ('scheduled', 'retry_wait')
RETURNING s.id;


-- ---------- Human resolution of 'uncertain' (POST /api/slots/:id/resolve) ----------

-- name: ResolveUncertainAsPublished
BEGIN;
UPDATE slots SET status = 'published', published_at = now(), external_url = $3,
       resolved_by = $2, resolved_at = now()
WHERE id = $1 AND status = 'uncertain'
RETURNING id, variant_id;
UPDATE publish_attempts SET status = 'succeeded', external_url = $3, resolved_by = $2, finished_at = now()
WHERE slot_id = $1 AND status = 'uncertain';
UPDATE variants SET status = 'published' WHERE id = $4 AND status = 'approved';
COMMIT;

-- name: ResolveUncertainAsRetry  (the uncertain attempt stays in history as 'uncertain')
UPDATE slots SET status = 'retry_wait', next_attempt_at = now(), resolved_by = $2, resolved_at = now()
WHERE id = $1 AND status = 'uncertain'
RETURNING id, attempt_count;


-- ---------- Mock adapter ----------

-- name: MockPublish  (on conflict returns the existing row, so a repeat call is a no-op)
INSERT INTO mock_posts (adapter_key, idempotency_key, owner_id, body)
VALUES ($1, $2, $3, $4)
ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
RETURNING id, adapter_key, created_at;

-- name: MockFindByIdempotencyKey
SELECT id, adapter_key, created_at FROM mock_posts WHERE idempotency_key = $1;
