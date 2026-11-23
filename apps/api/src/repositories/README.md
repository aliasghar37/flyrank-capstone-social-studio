# Repositories

All SQL lives here. Add one module per aggregate as the API grows:

- `posts.ts` — insert, find by id, list by owner, dedupe by content hash.
- `variants.ts` — create, list, status transitions, optimistic locking.
- `slots.ts` — schedule, claim, fence, publish, retry, cancel.
- `attempts.ts` — write-ahead attempt journal and history queries.
- `generation-runs.ts` — blocked output and cost log.

Rules: every user-facing query filters by `owner_id`; no SQL in routes or services.
