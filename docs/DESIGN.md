# Design — Social Media Studio

## Problem

A team publishes a blog post and must hand-rewrite it for every social platform, remember
when to post it, and avoid posting twice or posting something unapproved. Doing this by hand
is slow and error-prone, and most automation either posts duplicates on retry or loses
scheduled work when a worker restarts. Social Media Studio is the reliable core of that
workflow: one stored post becomes platform-specific variants, a person approves each one, and
a durable scheduler publishes each approved variant **one time, never twice**, through one
adapter interface.

## Users

Small marketing teams and solo creators who publish a blog and want a reviewed, scheduled
multi-platform campaign without a full social-media management suite.

## Scope and non-goal

**Core:** ingestion, constraint-enforced generation, review workflow,
adapter layer, idempotent scheduling and publish history.

**Optional, after the core works:** Discord adapter, grounding check, Clerk auth (with an
`AUTH_MODE=dev` bypass), Next.js dashboard, LangGraph repair loop.

**Explicit non-goal:** This project will **not** generate images, track analytics or
engagement, or publish to real X, LinkedIn, or Instagram accounts. It is the reliable
publishing core, not a full social-media management suite.

## Data model

`posts 1─* variants 1─* slots 1─* publish_attempts`, plus `generation_runs` (observability,
blocked output) and `mock_posts` (mock adapter output). The schema already exists in `db/`.

| Entity | Purpose | Key rule |
|---|---|---|
| `posts` | single source of truth; generation reads only this row | immutable; `UNIQUE(owner_id, content_hash)` |
| `variants` | one platform-specific version | `draft/approved/rejected/published`; one live variant per `(post, platform)`; only validator-passed rows stored |
| `slots` | durable job store + calendar | only for `approved` variants; `UNIQUE(idempotency_key)`; one active slot per variant |
| `publish_attempts` | visible publish history | at most one `succeeded` row per slot |
| `mock_posts` | what mock adapters would post | `UNIQUE(idempotency_key)` makes mocks idempotent |
| `generation_runs` | every generation attempt | stores blocked output and rule violations |

**States:** variant `draft → approved | rejected`, edit returns to `draft`, `approved →
published` only via a published slot, `published` terminal. Slot `scheduled → publishing →
published | retry_wait | failed | uncertain | cancelled`; `uncertain` is resolved by a person.
Attempt `started → request_sent → succeeded | failed_retryable | failed_permanent | uncertain`.

## API surface

Base `/api`, JSON in/out, errors as `{error:{code,message,details}}`.

| Endpoint | Purpose |
|---|---|
| `POST /api/posts` | ingest `{url}` or `{markdown,title,canonicalUrl?}` |
| `GET /api/posts`, `GET /api/posts/:id` | list / read posts |
| `POST /api/posts/:id/generate` | generate variants for enabled platforms |
| `GET/POST /api/posts/:id/variants` | list / create manually |
| `GET/PATCH /api/variants/:id` | read / edit (edit resets to `draft`) |
| `POST /api/variants/:id/approve` · `/reject` · `/schedule` | review + schedule |
| `GET /api/slots`, `GET /api/slots/:id`, `DELETE /api/slots/:id` | calendar / cancel |
| `POST /api/slots/:id/resolve` | resolve an `uncertain` slot |
| `GET /api/history`, `GET /api/posts/:id/generation-runs` | history / blocked output |
| `GET /preview/:adapter/:id`, `GET /health`, `GET /api/platforms` | mock preview / liveness / profiles |

Key refusals: unapproved schedule → `409 VARIANT_NOT_APPROVED`; past time →
`400 SCHEDULE_TIME_IN_PAST`; duplicate active slot → `409 VARIANT_ALREADY_SCHEDULED`;
constraint violation → `422 CONSTRAINT_VIOLATION` naming the broken rule.

## Constraint profiles

Profiles live in code; a **pure validator** enforces them. A variant that fails never reaches
review.

| Platform | Mode | maxChars | minChars | Hashtags | Emoji | Tone |
|---|---|---|---|---|---|---|
| x | mock | 280 | 40 | 0–2 | ≤2 | punchy, direct, one idea |
| linkedin | mock | 1500 | 300 | 1–5 at end | 0 | professional, insight-led |
| telegram | real | 1200 | 100 | 0–3 | ≤5 | friendly, conversational, plain text |
| discord | real | 1200 | 80 | 0–2 | ≤5 | casual, community-style, markdown allowed |

Rule ids: `max_length`, `min_length`, `hashtag_count`, `hashtag_position`, `emoji_limit`,
`all_caps`, `banned_phrase`, `link_required`, `markdown_not_allowed`, `empty_or_whitespace`.
`link_required` applies only when the stored post has a canonical URL.

## Publisher seam

```ts
interface SocialPublisher {
  readonly key: string;                       // telegram | discord | mock_x | mock_linkedin
  readonly supportsIdempotentLookup: boolean;
  publish(req: PublishRequest): Promise<PublishResult>;
  findByIdempotencyKey?(key: string): Promise<PublishResult | null>;
}
```

Adapters: `TelegramPublisher`, `DiscordPublisher` (real); `MockXPublisher`,
`MockLinkedInPublisher` (mock). `config/platforms.json` maps platform → adapter, so a swap is
a configuration change, not a code change.

## Reliability

Idempotency key `variant:{variantId}:slot:{slotId}`, generated and `UNIQUE` in Postgres.
Five layers: unique slot key + one active slot per variant; BullMQ
`jobId = {slotId}_{attempt_count}`; atomic claim with `claim_token` fencing; at most one
`succeeded` attempt per slot; `mock_posts` unique key.

A write-ahead attempt journal (`started` → `request_sent` → result), a lease + reconciler,
and key-based mock lookup recover crashes. Real adapters are **at-most-once**: an unrecorded
send becomes `uncertain` for human resolution, never a duplicate.

## Layers and stack

`routes → services → repositories → PostgreSQL`; a separate worker consumes BullMQ jobs;
adapters sit behind the registry. Node.js + Express + TypeScript, PostgreSQL 16,
Redis/BullMQ, Docker Compose. Template generation and `AUTH_MODE=dev` need no API keys;
Groq is optional. Full diagrams and state machines:
`docs/architecture.md`.
