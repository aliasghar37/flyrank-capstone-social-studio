# Database — Social Media Studio

PostgreSQL 16, plain SQL migrations.

```
db/
├── migrate.sh                 # applies migrations in order, skips applied ones
├── migrations/
│   ├── 001_helpers.sql        # updated_at trigger fn, SQLSTATE list
│   ├── 002_content.sql        # posts, variants, generation_runs
│   ├── 003_publishing.sql     # slots, publish_attempts, mock_posts
│   ├── 004_guards.sql         # state-machine triggers
│   └── 005_views.sql          # publish_history view
├── queries/publishing.sql     # claim / fence / success / retry / reconciler / resolve SQL
├── roles.sql                  # optional least-privilege runtime role
└── seed/seed.sql              # dev_user demo data
```

## Run

```bash
DATABASE_URL=postgresql://studio:studio@localhost:5432/studio ./db/migrate.sh
psql "$DATABASE_URL" -f db/seed/seed.sql
```

With Docker Compose, the `api` container runs `migrate.sh` on start.

## Entity map

```
posts 1──* variants 1──* slots 1──* publish_attempts
  └──* generation_runs                 mock_posts (keyed by slot idempotency_key)
```

## Guarantees enforced by the database (not just the app)

| Guarantee | Mechanism |
|---|---|
| Only valid variants are stored | `CHECK validation_report->>'passed' = 'true'` |
| One live variant per platform per post | partial unique `variants_live_platform_uq` |
| Only approved variants get a slot | `guard_slot_insert` trigger (locks the variant `FOR SHARE`) |
| One active slot per variant (L1) | partial unique `slots_one_active_per_variant_uq` |
| Idempotency key format can't drift | generated column `variant:{variantId}:slot:{slotId}`, unique |
| One worker per slot (L3) | atomic claim `UPDATE … WHERE status IN (…)` + `claim_token` fencing |
| One in-flight attempt per slot | partial unique `publish_attempts_one_inflight_uq` |
| At most one success per slot (L4) | partial unique `publish_attempts_one_success_uq` |
| Mock posts idempotent (L5) | unique `mock_posts.idempotency_key` |
| Variant only `published` via a published slot | `guard_variant` trigger |
| Posts are immutable (source of truth) | `guard_post_update` trigger |
| No cross-owner references | composite FKs `(id, owner_id)` on every child table |
| Legal state transitions only | triggers on variants, slots, publish_attempts |

## Error mapping for the API

| Postgres error | Constraint / code | HTTP |
|---|---|---|
| `SS003` | variant not approved | 409 `VARIANT_NOT_APPROVED` |
| `SS001` | invalid variant transition | 409 `INVALID_STATUS_TRANSITION` |
| `SS002` | variant published | 409 `VARIANT_PUBLISHED_IMMUTABLE` |
| `SS004` / `SS005` / `SS006` | slot / attempt / post guard | 409 (indicates an app bug; log it) |
| `23505` | `slots_one_active_per_variant_uq` | 409 `VARIANT_ALREADY_SCHEDULED` |
| `23505` | `posts_owner_hash_uq` | not raised: ingest returns the existing post with `200` |
| `23505` | `variants_live_platform_uq` | 409 live variant exists |
| `23503` | any `*_fk` | 404 (other owner's data or missing) |

The API checks these rules itself first; the database errors are a backstop.

## Conventions

- **Fence every write after the claim** on `claim_token`. 0 rows affected = lease lost; stop and never call the adapter.
- **Success transaction order:** slot → attempt → variant (the variant trigger checks for a published slot).
- **Always filter by `owner_id`** in user-facing queries, including the `publish_history` view.
- **Schedule time in the past** is checked in the API (400). The DB doesn't check it, so tests can create overdue slots.
- **Regenerate** (`?regenerate=true`): reject the old drafts (`rejection_reason = 'superseded'`) instead of deleting them.
- **Content hash:** hash exactly what you store in `content_markdown` (sha256 hex), or normalize the same way everywhere.

## Notes on the schema

- Status columns use `CHECK` instead of `ENUM` types, so values can change without `ALTER TYPE`.
- Platform, adapter and engine keys are format-checked, not listed, so a new adapter needs no migration.
- `slots.idempotency_key` is a generated column; the app never builds it.
- Added: `variants.rejection_reason`, `variants.version`, `slots.cancel_reason`, `slots.resolved_by/at`,
  `publish_attempts.owner_id`, `claim_token`, `request_sent_at`, `resolved_by`, `generation_runs.variant_id`.
- `mock_posts.preview_url` dropped: derive it as `${PUBLIC_API_URL}/preview/${adapter}/${id}` so it survives a URL change.
- `slots` with status `published` no longer require `external_id`, because a human-resolved uncertain slot may not have one.
- A late success can settle a slot the reconciler already marked `uncertain`, so it records a real success instead of needing a human.

## Optional: least-privilege role

`roles.sql` creates `studio_app` with no `DELETE`/`TRUNCATE`, so the app can't erase history.
Use it with two URLs: `MIGRATION_DATABASE_URL` (owner) for migrations, `DATABASE_URL` (studio_app) at runtime.
Without it, everything runs as the single `studio` user.
