# Generation

Phase 2 adds variant generation here.

Planned pieces:

- `engines/template.ts` — deterministic, no key required.
- `engines/groq.ts` — optional free-tier LLM with a template fallback.
- `prompt.ts` — compose prompts from the shared profile object, never copy-paste rules.
- `generate-service.ts` — load the stored post by id, generate per enabled platform,
  validate, log blocked output to `generation_runs`.

Generation must read only the stored `posts` row.
