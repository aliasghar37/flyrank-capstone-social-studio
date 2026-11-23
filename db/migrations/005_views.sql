-- Read model for GET /api/history. Always filter by owner_id.
CREATE VIEW publish_history AS
SELECT
  a.id,
  a.owner_id,
  a.slot_id,
  s.variant_id,
  v.post_id,
  v.platform,
  a.attempt_no,
  a.adapter_key,
  a.status,
  s.status       AS slot_status,
  s.scheduled_at,
  a.http_status,
  a.error_code,
  a.error_message,
  a.retry_after_ms,
  a.external_id,
  a.external_url,
  a.worker_id,
  a.resolved_by,
  a.started_at,
  a.request_sent_at,
  a.finished_at
FROM publish_attempts a
JOIN slots    s ON s.id = a.slot_id
JOIN variants v ON v.id = s.variant_id;
