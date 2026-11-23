# Social Media Studio

Turn one blog post into a reviewed, scheduled multi-platform campaign. A person approves each
platform-specific variant, and a durable scheduler publishes it **one time, never twice**.

> **Project status:** Phase 1 (design) is complete and the monorepo scaffold is in place.
> The API currently exposes `/health` and `/api/platforms`; ingestion, generation, review,
> scheduling and publishing arrive in Phases 2–5. See [`BUILDLOG.md`](BUILDLOG.md) and
> [`EVIDENCE.md`](EVIDENCE.md) for the honest build state.

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

The zero-key defaults (`AUTH_MODE=dev`, `LLM_PROVIDER=template`) are enough to run the
scaffold. Real Telegram/Discord publishing needs your own bot or webhook values in `.env`.

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
| `pnpm test` | Vitest |
| `pnpm db:migrate` | Apply PostgreSQL migrations |
| `pnpm db:seed` | Seed the demo post and variants |
| `pnpm demo:crash` | Crash-recovery demo (Phase 5) |

## Current API

| Endpoint | Status |
|---|---|
| `GET /health` | Implemented — checks PostgreSQL and Redis |
| `GET /api/platforms` | Implemented — enabled platforms, adapter map, profiles |
| `POST /api/posts`, generation, review, scheduling, history | Planned for Phases 2–5 |

## Known limitations

- This is a scaffold: feature endpoints and dashboard pages are not implemented yet.
- Auth middleware and Clerk are not wired; `AUTH_MODE=dev` is the only working path.
- Real adapters need your own Telegram bot or Discord webhook. Without them, use mock adapters.
- Real Telegram/Discord publishing is **at-most-once** in the ambiguity window: an unrecorded
  send becomes `uncertain` for human resolution rather than risking a duplicate.
- Image generation, analytics and real X/LinkedIn/Instagram publishing are explicit non-goals.

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) — Phase 1 gate document.
- [`docs/architecture.md`](docs/architecture.md) — diagrams, state machines, idempotency.
- [`db/README.md`](db/README.md) — schema, database-enforced guarantees, error mapping.
- [`EVIDENCE.md`](EVIDENCE.md) — requirement proofs (filled as phases land).
- [`BUILDLOG.md`](BUILDLOG.md) — AI-usage log.
