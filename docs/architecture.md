# Architecture

Detailed diagrams for `docs/DESIGN.md`, written in Mermaid.

## 1. System flow

```mermaid
flowchart TD
    A["Blog post: URL or Markdown"] --> B["Ingest + store<br/>posts (source of truth)"]
    B --> C["Variant generator<br/>template or Groq"]
    C --> D["Constraint validator<br/>pure code"]
    D -- "violations" --> C
    D -- "passed" --> E["Variants<br/>draft"]
    E --> F["Human review<br/>approve / edit / reject"]
    F -- "approved" --> G["Schedule slot<br/>durable job store"]
    F -- "rejected" --> X["Rejected<br/>(edit returns to draft)"]
    G --> H["Worker + reconciler<br/>atomic claim, lease, fencing"]
    H --> I["SocialPublisher interface"]
    I --> J["TelegramPublisher<br/>(real)"]
    I --> K["DiscordPublisher<br/>(real)"]
    I --> L["MockXPublisher<br/>(mock)"]
    I --> M["MockLinkedInPublisher<br/>(mock)"]
    J --> N["Publish history<br/>publish_attempts"]
    K --> N
    L --> N
    M --> N
    N --> O["Exactly one success per slot"]
```

## 2. Publish sequence

```mermaid
sequenceDiagram
    participant W as Worker
    participant DB as PostgreSQL
    participant A as SocialPublisher
    participant P as Platform

    W->>DB: claim slot (UPDATE ... WHERE status IN ('scheduled','retry_wait') RETURNING)
    alt 0 rows
        W-->>W: another worker owns it, exit
    end
    W->>DB: verify variant still approved
    W->>DB: INSERT attempt (status='started')
    W->>DB: UPDATE attempt (status='request_sent') [fenced on claim_token]
    W->>A: publish(idempotencyKey, text)
    A->>P: platform API call
    P-->>A: external id / url
    A-->>W: PublishResult
    W->>DB: TX: attempt=succeeded, slot=published, variant=published
```

## 3. Data model

```mermaid
erDiagram
    posts ||--o{ variants : has
    posts ||--o{ generation_runs : logs
    variants ||--o{ slots : scheduled_as
    slots ||--o{ publish_attempts : records

    posts {
      uuid id PK
      text owner_id
      text source_type
      text source_url
      text title
      text content_markdown
      char content_hash
    }
    variants {
      uuid id PK
      uuid post_id FK
      text platform
      text body
      text[] hashtags
      text status
      text origin
      jsonb validation_report
      jsonb grounding_report
      int version
    }
    slots {
      uuid id PK
      uuid variant_id FK
      text adapter_key
      timestamptz scheduled_at
      text status
      text idempotency_key
      int attempt_count
      uuid claim_token
      text external_url
    }
    publish_attempts {
      uuid id PK
      uuid slot_id FK
      int attempt_no
      text status
      text idempotency_key
      uuid claim_token
      text external_id
      text external_url
    }
    mock_posts {
      uuid id PK
      text adapter_key
      text idempotency_key
      text body
    }
    generation_runs {
      uuid id PK
      uuid post_id FK
      text platform
      text engine
      text outcome
      jsonb violations
    }
```

Full column definitions and constraints: `db/README.md` and `db/migrations/`.

## 4. State machines

### Variant

```mermaid
stateDiagram-v2
    [*] --> draft: generate / manual create (validator passes)
    draft --> approved: approve (re-validate)
    draft --> rejected: reject
    approved --> draft: edit (re-validate)
    rejected --> draft: edit (re-validate)
    approved --> published: slot publishes
    published --> [*]
```

### Slot

```mermaid
stateDiagram-v2
    [*] --> scheduled: schedule approved variant
    scheduled --> publishing: worker claim
    scheduled --> cancelled: cancel
    publishing --> published: success
    publishing --> retry_wait: retryable error
    publishing --> failed: permanent error / attempts exhausted
    publishing --> uncertain: ambiguous crash
    publishing --> cancelled: variant no longer approved
    retry_wait --> publishing: retry due
    uncertain --> published: human resolves "posted"
    uncertain --> retry_wait: human resolves "retry"
    published --> [*]
    failed --> [*]
    cancelled --> [*]
```

## 5. The adapter seam

```ts
export interface PublishRequest {
  idempotencyKey: string;     // stable per variant + slot
  text: string;
  platform: string;           // profile key, informational
  linkUrl?: string;
  ownerId: string;
}

export interface PublishResult {
  externalId: string;
  externalUrl: string;        // live message link or mock preview link
  raw?: unknown;              // sanitized metadata for debugging
}

export type PublishErrorKind = 'retryable' | 'permanent' | 'ambiguous';

export class PublishError extends Error {
  kind: PublishErrorKind;
  httpStatus?: number;
  retryAfterMs?: number;
}

export interface SocialPublisher {
  readonly key: string;
  readonly supportsIdempotentLookup: boolean;
  publish(req: PublishRequest): Promise<PublishResult>;
  findByIdempotencyKey?(key: string): Promise<PublishResult | null>;
}
```

Registry (the only place adapter names appear):

```ts
const registry: Record<string, () => SocialPublisher> = {
  telegram: () => new TelegramPublisher(env),
  discord: () => new DiscordPublisher(env),
  mock_x: () => new MockPublisher('mock_x', db),
  mock_linkedin: () => new MockPublisher('mock_linkedin', db),
};
```

`config/platforms.json` maps each platform to an adapter key. Business code calls
`resolvePublisher(adapterKey)` and never branches on platform names.

## 6. Idempotency layers

| Layer | Mechanism | Prevents |
|---|---|---|
| L1 | `UNIQUE(idempotency_key)` on `slots`; one active slot per variant | duplicate slots from double-clicks or retried API calls |
| L2 | BullMQ `jobId = {slotId}_{attempt_count}` | enqueueing the same attempt twice |
| L3 | Atomic claim `UPDATE ... WHERE status IN ('scheduled','retry_wait')` + `claim_token` fencing | two workers processing the same slot |
| L4 | Partial unique index: one `succeeded` attempt per slot | recording a second success |
| L5 | `UNIQUE(idempotency_key)` on `mock_posts` | duplicate mock posts |

Every write after the claim is conditional on the `claim_token`. Zero rows affected means the
lease was lost: stop and never call the adapter.

## 7. Crash recovery

| Crash point | State left behind | Recovery |
|---|---|---|
| Before claim | slot `scheduled` | job redelivered → one post |
| After claim, before `request_sent` | slot `publishing`, attempt `started` | lease expires → reconciler resets to `retry_wait` → one post |
| After `request_sent`, before result | slot `publishing`, attempt `request_sent` | mocks: lookup by key → one post. Real adapters: `uncertain` → human resolve, never a duplicate |
| After result recorded | slot `published` | redelivery is a no-op (claim returns 0 rows) |
| Redis wiped | slots `scheduled` in Postgres | reconciler re-enqueues due slots |
| Duplicate job delivery | — | second claim returns 0 rows |

## 8. Layering

```
HTTP routes  →  services  →  repositories  →  PostgreSQL
                   │
                   └──►  SocialPublisher registry  ──►  adapters
worker  →  BullMQ (wake-ups only)  →  same services/repositories
```

Rules:

- Routes contain no business logic.
- Services never import concrete adapter implementations, only the interface and registry.
- Repositories hold all SQL.
- Every user-facing query filters by `owner_id`; cross-owner access returns `404`.
- PostgreSQL is the source of truth; Redis/BullMQ only provides wake-ups.

## 9. Deployment

```mermaid
flowchart LR
    web["web (Next.js)<br/>:3000"] --> api["api (Express)<br/>:4000"]
    api --> pg[("postgres:16<br/>:5432")]
    api --> redis[("redis:7<br/>:6379")]
    worker["worker"] --> pg
    worker --> redis
    worker --> adapters["Telegram / Discord / mocks"]
    api --> adapters
```

Docker Compose runs `postgres`, `redis`, `api`, `worker`, and `web`. The API applies
migrations on start; the seed script creates the demo user and sample content.
