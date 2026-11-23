-- State-machine guards. The API checks these rules first and returns clean errors;
-- the triggers make sure a bug or a race can never break them.

-- Posts are the source of truth: immutable once stored.
CREATE OR REPLACE FUNCTION guard_post_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'post % is immutable', OLD.id USING ERRCODE = 'SS006';
END $$;

CREATE TRIGGER posts_immutable BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION guard_post_update();


-- draft -> approved | rejected | draft(edit);  approved|rejected -> draft(edit);
-- approved -> published (only alongside a published slot).  published is terminal.
CREATE OR REPLACE FUNCTION guard_variant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'new variants must start as draft' USING ERRCODE = 'SS001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'variant % is published and immutable', OLD.id USING ERRCODE = 'SS002';
  END IF;

  IF NEW.post_id <> OLD.post_id OR NEW.owner_id <> OLD.owner_id OR NEW.platform <> OLD.platform THEN
    RAISE EXCEPTION 'post_id, owner_id and platform are immutable' USING ERRCODE = 'SS002';
  END IF;

  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.hashtags IS DISTINCT FROM OLD.hashtags THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'editing a variant must return it to draft' USING ERRCODE = 'SS001';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft'    AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status IN ('draft', 'published'))
    OR (OLD.status = 'rejected' AND NEW.status = 'draft')
  ) THEN
    RAISE EXCEPTION 'invalid variant transition % -> %', OLD.status, NEW.status USING ERRCODE = 'SS001';
  END IF;

  IF NEW.status = 'published' AND OLD.status <> 'published' AND NOT EXISTS (
    SELECT 1 FROM slots WHERE variant_id = NEW.id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'variant can only be published by a published slot' USING ERRCODE = 'SS001';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER variants_guard BEFORE INSERT OR UPDATE ON variants
  FOR EACH ROW EXECUTE FUNCTION guard_variant();


-- A slot may only be created for an approved variant. FOR SHARE blocks a concurrent
-- edit/reject of that variant until this transaction ends.
CREATE OR REPLACE FUNCTION guard_slot_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM variants WHERE id = NEW.variant_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'variant % is not approved (status: %)', NEW.variant_id, coalesce(v_status, 'missing')
      USING ERRCODE = 'SS003';
  END IF;
  IF NEW.status <> 'scheduled' OR NEW.attempt_count <> 0 THEN
    RAISE EXCEPTION 'new slots must start as scheduled with 0 attempts' USING ERRCODE = 'SS004';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER slots_guard_insert BEFORE INSERT ON slots
  FOR EACH ROW EXECUTE FUNCTION guard_slot_insert();


-- scheduled|retry_wait -> publishing|cancelled; publishing -> published|retry_wait|failed|uncertain|cancelled;
-- uncertain -> published|retry_wait.  published, failed, cancelled are terminal.
CREATE OR REPLACE FUNCTION guard_slot_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.variant_id <> OLD.variant_id OR NEW.owner_id <> OLD.owner_id
     OR NEW.scheduled_at <> OLD.scheduled_at THEN
    RAISE EXCEPTION 'variant_id, owner_id and scheduled_at are immutable (cancel and reschedule instead)'
      USING ERRCODE = 'SS004';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status IN ('scheduled', 'retry_wait') AND NEW.status IN ('publishing', 'cancelled'))
    OR (OLD.status = 'publishing' AND NEW.status IN ('published', 'retry_wait', 'failed', 'uncertain', 'cancelled'))
    OR (OLD.status = 'uncertain'  AND NEW.status IN ('published', 'retry_wait'))
  ) THEN
    RAISE EXCEPTION 'invalid slot transition % -> %', OLD.status, NEW.status USING ERRCODE = 'SS004';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER slots_guard_update BEFORE UPDATE ON slots
  FOR EACH ROW EXECUTE FUNCTION guard_slot_update();


-- started -> request_sent|failed_*; request_sent -> succeeded|failed_*|uncertain;
-- uncertain -> succeeded|failed_permanent.  Identity columns never change.
CREATE OR REPLACE FUNCTION guard_attempt_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slot_id <> OLD.slot_id OR NEW.attempt_no <> OLD.attempt_no
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.claim_token <> OLD.claim_token
     OR NEW.adapter_key <> OLD.adapter_key OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION 'attempt identity columns are immutable' USING ERRCODE = 'SS005';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'started'      AND NEW.status IN ('request_sent', 'failed_retryable', 'failed_permanent'))
    OR (OLD.status = 'request_sent' AND NEW.status IN ('succeeded', 'failed_retryable', 'failed_permanent', 'uncertain'))
    OR (OLD.status = 'uncertain'    AND NEW.status IN ('succeeded', 'failed_permanent'))
  ) THEN
    RAISE EXCEPTION 'invalid attempt transition % -> %', OLD.status, NEW.status USING ERRCODE = 'SS005';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER publish_attempts_guard BEFORE UPDATE ON publish_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_attempt_update();
