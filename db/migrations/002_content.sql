-- Content side: posts (source of truth), variants, generation runs.
-- Status/enum-like columns use CHECK instead of ENUM types so values can change without ALTER TYPE.
-- Platform and adapter keys are format-checked, not listed, so a new adapter needs no migration.

CREATE TABLE posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         text NOT NULL CHECK (owner_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  source_type      text NOT NULL CHECK (source_type IN ('url', 'markdown')),
  source_url       text CHECK (source_url ~* '^https?://' AND char_length(source_url) <= 2048),
  title            text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  content_markdown text NOT NULL CHECK (char_length(content_markdown) BETWEEN 1 AND 200000),
  content_hash     char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT posts_url_source_has_url CHECK (source_type <> 'url' OR source_url IS NOT NULL),
  CONSTRAINT posts_owner_hash_uq      UNIQUE (owner_id, content_hash),
  -- Target for composite FKs so child rows can never belong to a different owner.
  CONSTRAINT posts_id_owner_uq        UNIQUE (id, owner_id)
);

CREATE INDEX posts_owner_created_idx ON posts (owner_id, created_at DESC);


CREATE TABLE variants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           uuid NOT NULL,
  owner_id          text NOT NULL,
  platform          text NOT NULL CHECK (platform ~ '^[a-z][a-z0-9_]{0,31}$'),
  body              text NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 10000),
  hashtags          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(hashtags) <= 30),
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'approved', 'rejected', 'published')),
  origin            text NOT NULL CHECK (origin IN ('ai', 'template', 'manual')),
  -- Only variants that passed their constraint profile are ever stored.
  validation_report jsonb NOT NULL
                    CHECK (jsonb_typeof(validation_report) = 'object'
                           AND validation_report->>'passed' = 'true'),
  grounding_report  jsonb CHECK (grounding_report IS NULL OR jsonb_typeof(grounding_report) = 'object'),
  rejection_reason  text CHECK (char_length(rejection_reason) <= 1000),
  reviewed_by       text,
  reviewed_at       timestamptz,
  version           integer NOT NULL DEFAULT 1,  -- bumped on every body edit (optimistic locking)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT variants_post_fk FOREIGN KEY (post_id, owner_id)
    REFERENCES posts (id, owner_id) ON DELETE RESTRICT,
  CONSTRAINT variants_id_owner_uq UNIQUE (id, owner_id),
  CONSTRAINT variants_review_coherent CHECK (
    (status = 'draft') = (reviewed_at IS NULL) AND (reviewed_at IS NULL) = (reviewed_by IS NULL)
  ),
  CONSTRAINT variants_reason_only_rejected CHECK (rejection_reason IS NULL OR status = 'rejected')
);

-- One live (non-rejected) variant per platform per post.
CREATE UNIQUE INDEX variants_live_platform_uq ON variants (post_id, platform) WHERE status <> 'rejected';
CREATE INDEX variants_post_idx         ON variants (post_id);
CREATE INDEX variants_owner_status_idx ON variants (owner_id, status, created_at DESC);

CREATE TRIGGER variants_set_updated_at BEFORE UPDATE ON variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Every generation attempt per platform, including blocked output and token cost.
CREATE TABLE generation_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           uuid NOT NULL,
  owner_id          text NOT NULL,
  platform          text NOT NULL CHECK (platform ~ '^[a-z][a-z0-9_]{0,31}$'),
  engine            text NOT NULL CHECK (engine ~ '^[a-z][a-z0-9_]{0,31}$'),  -- 'groq' | 'template'
  model             text CHECK (char_length(model) <= 128),
  attempts          smallint NOT NULL CHECK (attempts BETWEEN 1 AND 10),
  outcome           text NOT NULL CHECK (outcome IN ('stored', 'blocked')),
  variant_id        uuid REFERENCES variants (id) ON DELETE RESTRICT,
  violations        jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(violations) = 'array'),
  prompt_tokens     integer CHECK (prompt_tokens >= 0),
  completion_tokens integer CHECK (completion_tokens >= 0),
  latency_ms        integer NOT NULL CHECK (latency_ms >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generation_runs_post_fk FOREIGN KEY (post_id, owner_id)
    REFERENCES posts (id, owner_id) ON DELETE RESTRICT,
  CONSTRAINT generation_runs_outcome_coherent CHECK ((outcome = 'stored') = (variant_id IS NOT NULL))
);

CREATE INDEX generation_runs_post_idx  ON generation_runs (post_id, created_at DESC);
CREATE INDEX generation_runs_owner_idx ON generation_runs (owner_id, created_at DESC);
