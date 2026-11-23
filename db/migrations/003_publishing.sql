-- Publishing side: slots (durable job store), publish_attempts (history), mock_posts.

CREATE TABLE slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      uuid NOT NULL,
  owner_id        text NOT NULL,
  adapter_key     text NOT NULL CHECK (adapter_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  scheduled_at    timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'publishing', 'retry_wait', 'published',
                                    'failed', 'uncertain', 'cancelled')),
  -- Derived by the DB so the format can never drift: variant:{variantId}:slot:{slotId}
  idempotency_key text GENERATED ALWAYS AS
                  ('variant:' || variant_id::text || ':slot:' || id::text) STORED,
  attempt_count   integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  next_attempt_at timestamptz,
  claimed_by      text CHECK (char_length(claimed_by) <= 128),
  claim_token     uuid,          -- fencing token; set only while 'publishing'
  claimed_at      timestamptz,
  external_id     text CHECK (char_length(external_id) <= 256),
  external_url    text CHECK (char_length(external_url) <= 2048),
  published_at    timestamptz,
  last_error      text CHECK (char_length(last_error) <= 2000),  -- sanitized, never secrets
  cancel_reason   text CHECK (char_length(cancel_reason) <= 500),
  resolved_by     text,          -- who resolved an 'uncertain' slot
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT slots_variant_fk FOREIGN KEY (variant_id, owner_id)
    REFERENCES variants (id, owner_id) ON DELETE RESTRICT,
  CONSTRAINT slots_idempotency_key_uq UNIQUE (idempotency_key),
  CONSTRAINT slots_id_owner_key_uq    UNIQUE (id, owner_id, idempotency_key),
  CONSTRAINT slots_claim_coherent CHECK (
    (status = 'publishing') = (claim_token IS NOT NULL)
    AND (status <> 'publishing' OR claimed_at IS NOT NULL)
  ),
  CONSTRAINT slots_retry_has_time    CHECK (status <> 'retry_wait' OR next_attempt_at IS NOT NULL),
  CONSTRAINT slots_published_has_time CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT slots_cancel_has_reason CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);

-- L1: one active slot per variant (failed/cancelled slots don't block a reschedule).
CREATE UNIQUE INDEX slots_one_active_per_variant_uq ON slots (variant_id)
  WHERE status NOT IN ('cancelled', 'failed');

CREATE INDEX slots_variant_idx        ON slots (variant_id);
CREATE INDEX slots_owner_calendar_idx ON slots (owner_id, scheduled_at);
-- Small partial indexes for the reconciler; they only hold rows that need work.
CREATE INDEX slots_due_idx        ON slots (scheduled_at)    WHERE status = 'scheduled';
CREATE INDEX slots_retry_due_idx  ON slots (next_attempt_at) WHERE status = 'retry_wait';
CREATE INDEX slots_lease_idx      ON slots (claimed_at)      WHERE status = 'publishing';
CREATE INDEX slots_uncertain_idx  ON slots (owner_id)        WHERE status = 'uncertain';

CREATE TRIGGER slots_set_updated_at BEFORE UPDATE ON slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE publish_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id         uuid NOT NULL,
  owner_id        text NOT NULL,
  attempt_no      integer NOT NULL CHECK (attempt_no >= 1),
  adapter_key     text NOT NULL CHECK (adapter_key ~ '^[a-z][a-z0-9_]{0,31}$'),  -- effective adapter (after FORCE_ADAPTER)
  status          text NOT NULL DEFAULT 'started'
                  CHECK (status IN ('started', 'request_sent', 'succeeded',
                                    'failed_retryable', 'failed_permanent', 'uncertain')),
  idempotency_key text NOT NULL,
  claim_token     uuid NOT NULL,
  worker_id       text NOT NULL CHECK (char_length(worker_id) <= 128),
  http_status     smallint CHECK (http_status BETWEEN 100 AND 599),
  error_code      text CHECK (char_length(error_code) <= 64),
  error_message   text CHECK (char_length(error_message) <= 2000),  -- sanitized, never secrets
  retry_after_ms  integer CHECK (retry_after_ms >= 0),
  external_id     text CHECK (char_length(external_id) <= 256),
  external_url    text CHECK (char_length(external_url) <= 2048),
  resolved_by     text,  -- set when a human marks an uncertain attempt as posted
  started_at      timestamptz NOT NULL DEFAULT now(),
  request_sent_at timestamptz,
  finished_at     timestamptz,

  -- One FK pins slot, owner and idempotency key together.
  CONSTRAINT publish_attempts_slot_fk FOREIGN KEY (slot_id, owner_id, idempotency_key)
    REFERENCES slots (id, owner_id, idempotency_key) ON DELETE RESTRICT,
  CONSTRAINT publish_attempts_slot_no_uq UNIQUE (slot_id, attempt_no),
  CONSTRAINT publish_attempts_sent_has_time CHECK (
    status IN ('started') OR status LIKE 'failed_%' OR request_sent_at IS NOT NULL
  ),
  CONSTRAINT publish_attempts_finished_coherent CHECK (
    status IN ('started', 'request_sent', 'uncertain') OR finished_at IS NOT NULL
  )
);

-- L4: the database itself refuses a second success for the same slot.
CREATE UNIQUE INDEX publish_attempts_one_success_uq ON publish_attempts (slot_id)
  WHERE status = 'succeeded';
-- At most one in-flight attempt per slot.
CREATE UNIQUE INDEX publish_attempts_one_inflight_uq ON publish_attempts (slot_id)
  WHERE status IN ('started', 'request_sent');
CREATE INDEX publish_attempts_owner_history_idx ON publish_attempts (owner_id, started_at DESC);


-- What mock adapters "would post". L5: unique key makes mocks natively idempotent.
-- No FK to slots on purpose: adapters only know the key, and contract tests insert freely.
CREATE TABLE mock_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_key     text NOT NULL CHECK (adapter_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) <= 256),
  owner_id        text NOT NULL,
  body            text NOT NULL CHECK (char_length(body) <= 10000),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mock_posts_idempotency_key_uq UNIQUE (idempotency_key)
);

CREATE INDEX mock_posts_owner_idx ON mock_posts (owner_id, created_at DESC);
