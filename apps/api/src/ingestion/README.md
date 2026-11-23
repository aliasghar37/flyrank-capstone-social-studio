# Ingestion

Phase 2 adds URL fetching and Markdown storage here.

Planned pieces:

- `url-fetcher.ts` — HTTP(S) only, DNS/private-range blocking, 10 s timeout, 2 MB cap,
  limited redirects, content-type checks.
- `extract.ts` — readability-style extraction to Markdown.
- `ingest-service.ts` — normalize, hash (SHA-256 hex), store once per `(owner_id, content_hash)`.

The stored `posts` row is the only input to generation.
