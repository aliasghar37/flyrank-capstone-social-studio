# Social Media Studio

Turn one blog post into a reviewed, scheduled multi-platform campaign. A person approves each
platform-specific variant, and a durable scheduler publishes it **one time, never twice**.

> **Status:** work in progress. Ingestion, variant generation and constraint validation are
> implemented; review and publishing are not implemented yet.

## Why this exists

A marketing team publishes a blog post and must rewrite it for every platform, remember when
to post, and avoid duplicates or unapproved posts. Most automation breaks on retry or worker
restart. This project is the reliable core:

- **Idempotency** — a retry never creates a second post.
- **Constraint profiles** — length, tone and hashtag rules enforced by code, not hope.
- **Durable scheduling** — a worker that stops mid-batch continues safely.
- **The adapter seam** — the app never knows which platform it publishes to.

## Architecture

```mermaid
flowchart LR
    A["Blog post<br/>URL or Markdown"] --> B["API<br/>ingest + store"]
    B --> C["Variant generation<br/>template or Groq"]
    C --> D["Constraint validation<br/>pure code"]
    D --> E["Human review<br/>draft / approved / rejected"]
    E --> F["Durable scheduler<br/>PostgreSQL job store"]
    F --> G["SocialPublisher interface"]
    G --> H["Telegram<br/>real"]
    G --> I["Discord<br/>real"]
    G --> J["Mock X"]
    G --> K["Mock LinkedIn"]
    H --> L["Publish history"]
    I --> L
    J --> L
    K --> L
```

Full diagrams, state machines and idempotency layers: [`docs/architecture.md`](docs/architecture.md).
Design decisions: [`docs/DESIGN.md`](docs/DESIGN.md).

## Stack

| Area | Choice |
|---|---|
| Language | Node.js 24 + TypeScript |
| API | Express 5 |
| Worker / queue | BullMQ + Redis (PostgreSQL is the source of truth) |
| Database | PostgreSQL 16 |
| Dashboard | Next.js 16 (App Router) + Tailwind CSS 4 |
| Shared domain | `packages/shared` (types, constraint profiles, validator contract) |
| Monorepo | pnpm workspaces |
| Infra | Docker Compose |
| Tests | Vitest |

## Repository layout

```
.
├── apps/
│   ├── api/            # Express API: routes → services → repositories
│   ├── worker/         # BullMQ worker, reconciler, publisher adapters
│   └── web/            # Next.js dashboard
├── packages/
│   └── shared/         # Types, constraint profiles, rule ids
├── config/
│   └── platforms.json  # Enabled platforms + adapter mapping
├── db/                 # PostgreSQL migrations, queries, seed, ERD
├── docs/               # DESIGN.md, architecture.md
├── scripts/            # seed, crash demo
├── tests/              # Vitest tests
├── docker-compose.yml
└── .env.example
```

## Quick start (Docker, one command)

Prerequisites: Docker with Compose v2.

```bash
cp .env.example .env
docker compose up --build
```

Then seed the demo data:

```bash
docker compose exec api pnpm db:seed
```

Open:

- Dashboard: <http://localhost:3000>
- API health: <http://localhost:4000/health>
- Platform profiles: <http://localhost:4000/api/platforms>

The defaults (`AUTH_MODE=dev`, `LLM_PROVIDER=template`) need no API keys. Real Telegram/Discord publishing needs your own bot or webhook values in `.env`.

## Local development (without rebuilding containers)

```bash
pnpm install
docker compose up -d postgres redis

# If you run services on the host, change the hosts in .env:
#   DATABASE_URL=postgresql://studio:studio@localhost:5432/studio
#   REDIS_URL=redis://localhost:6379

pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` builds `@studio/shared` first, then runs the API, worker and dashboard together.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Build shared, then run API + worker + web in parallel |
| `pnpm build` | Build every workspace package |
| `pnpm typecheck` | Build shared, then typecheck all packages |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier write |
| `pnpm test` | Vitest (set `TEST_DATABASE_URL` to include the database tests) |
| `pnpm db:migrate` | Apply PostgreSQL migrations |
| `pnpm db:seed` | Seed the demo post and variants |
| `pnpm demo:crash` | Crash-recovery demo (not implemented yet) |

## Ingesting a post

```bash
# Pasted Markdown
curl -s localhost:4000/api/posts -H 'content-type: application/json' \
  -d '{"markdown":"# My post\n\nBody text","canonicalUrl":"https://example.com/my-post"}'

# A public URL (article text is extracted from the page)
curl -s localhost:4000/api/posts -H 'content-type: application/json' \
  -d '{"url":"https://example.com/blog/post"}'
```

A new post returns `201`. Sending the same content again returns `200` with the existing post
(`"created": false`). URL fetching only allows public http(s) addresses, follows at most 3
redirects, and stops after 10 seconds or 2 MB.

## Generating variants

```bash
curl -s -X POST localhost:4000/api/posts/$POST_ID/generate
```

The response lists the stored `variants` (status `draft`), any `blocked` platforms with the
rules they broke, and `skipped` platforms that already have a live variant. Every variant is
checked by the validator in `packages/shared/src/validator.ts` before it is stored; a variant
that breaks a rule is never stored and is logged in `generation_runs`.

A hand-written variant goes through the same check:

```bash
curl -s localhost:4000/api/posts/$POST_ID/variants -H 'content-type: application/json' \
  -d '{"platform":"x","body":"Way too long ... #a #b #c"}'
# 422 {"error":{"code":"CONSTRAINT_VIOLATION","message":"Variant violates 2 rule(s) for platform 'x': max_length, hashtag_count", "details":[{"rule":"max_length","limit":280,"actual":412,...}]}}
```

## Current API

| Endpoint | Status |
|---|---|
| `GET /health` | Implemented — checks PostgreSQL and Redis |
| `GET /api/platforms` | Implemented — enabled platforms, adapter map, profiles |
| `POST /api/posts` | Implemented — ingest `{ "url" }` or `{ "markdown", "title?", "canonicalUrl?" }` |
| `GET /api/posts`, `GET /api/posts/:id` | Implemented — list and read stored posts |
| `POST /api/posts/:id/generate` | Implemented — one template variant per enabled platform (optional `{ "platforms": [...] }`) |
| `GET /api/posts/:id/variants` | Implemented — list a post's variants |
| `POST /api/posts/:id/variants` | Implemented — add a hand-written `{ "platform", "body" }`; `422` names each broken rule |
| `GET /api/posts/:id/generation-runs` | Implemented — every generation attempt, including blocked output |
| Review, scheduling, history | Not implemented yet |

## Known limitations

- Review, scheduling and dashboard pages are not implemented yet.
- Variants are generated from templates only; the optional Groq engine is not wired yet.
- Auth middleware and Clerk are not wired; `AUTH_MODE=dev` is the only working path.
- Real adapters need your own Telegram bot or Discord webhook. Without them, use mock adapters.
- Real Telegram/Discord publishing is **at-most-once** in the ambiguity window: an unrecorded
  send becomes `uncertain` for human resolution rather than risking a duplicate.
- Image generation, analytics and real X/LinkedIn/Instagram publishing are explicit non-goals.

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) — one-page design.
- [`docs/architecture.md`](docs/architecture.md) — diagrams, state machines, idempotency.
- [`db/README.md`](db/README.md) — schema, database-enforced guarantees, error mapping.
- [`EVIDENCE.md`](EVIDENCE.md) — requirement proofs.
- [`BUILDLOG.md`](BUILDLOG.md) — AI-usage log.
