-- Demo data for dev_user: one post with variants in draft / approved / rejected.
-- Safe to re-run. content_hash is sha256 of content_markdown, same as the API.

BEGIN;

INSERT INTO posts (id, owner_id, source_type, source_url, title, content_markdown, content_hash)
SELECT '00000000-0000-4000-8000-000000000001', 'dev_user', 'markdown',
       'https://example.com/blog/why-durable-queues-matter', 'Why durable queues matter', c,
       encode(sha256(convert_to(c, 'UTF8')), 'hex')
FROM (VALUES (
'# Why durable queues matter

In 2025 our team lost 14 scheduled posts when a single Redis node restarted.
We moved the job store into PostgreSQL and kept Redis only for wake-ups.
Since then, worker restarts have caused zero missed or duplicate posts.'
)) AS t(c)
ON CONFLICT (owner_id, content_hash) DO NOTHING;

INSERT INTO variants (id, post_id, owner_id, platform, body, hashtags, origin, validation_report)
VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'dev_user', 'x',
   'We lost 14 scheduled posts to one Redis restart. Now Postgres holds the jobs and Redis just wakes us up. https://example.com/blog/why-durable-queues-matter #backend',
   '{backend}', 'template', '{"passed": true, "violations": []}'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'dev_user', 'telegram',
   'Why durable queues matter: in 2025 a single Redis restart cost us 14 scheduled posts. We moved the job store into PostgreSQL, and worker restarts have caused zero missed or duplicate posts since. https://example.com/blog/why-durable-queues-matter',
   '{}', 'template', '{"passed": true, "violations": []}'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'dev_user', 'discord',
   'Story time: one Redis restart ate 14 of our scheduled posts in 2025. Fix: PostgreSQL is now the job store, Redis only handles wake-ups. Zero dupes since. https://example.com/blog/why-durable-queues-matter',
   '{}', 'template', '{"passed": true, "violations": []}'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'dev_user', 'linkedin',
   'In 2025 our team lost 14 scheduled posts when a single Redis node restarted. The lesson was simple: a queue is not a database. We moved the job store into PostgreSQL and kept Redis only for precise wake-ups. Since then, worker restarts have caused zero missed or duplicate posts. If your scheduler keeps its only copy of the schedule in memory, it is one restart away from the same story. https://example.com/blog/why-durable-queues-matter
#backend #reliability',
   '{backend,reliability}', 'template', '{"passed": true, "violations": []}')
ON CONFLICT (id) DO NOTHING;

-- Variants must be inserted as draft (guard trigger), then reviewed.
UPDATE variants SET status = 'approved', reviewed_by = 'dev_user', reviewed_at = now()
WHERE id IN ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102')
  AND status = 'draft';

UPDATE variants SET status = 'rejected', reviewed_by = 'dev_user', reviewed_at = now(),
       rejection_reason = 'Tone too casual for this campaign'
WHERE id = '00000000-0000-4000-8000-000000000103' AND status = 'draft';

COMMIT;
