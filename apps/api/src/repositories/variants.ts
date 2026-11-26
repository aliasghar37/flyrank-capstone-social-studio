import type { Violation } from '@studio/shared';
import type { Pool, PoolClient } from 'pg';

export interface VariantRecord {
  id: string;
  postId: string;
  ownerId: string;
  platform: string;
  body: string;
  hashtags: string[];
  status: string;
  origin: string;
  validationReport: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerationRunRecord {
  id: string;
  postId: string;
  platform: string;
  engine: string;
  outcome: 'stored' | 'blocked';
  variantId: string | null;
  violations: Violation[];
  latencyMs: number;
  createdAt: Date;
}

export interface NewVariant {
  postId: string;
  ownerId: string;
  platform: string;
  body: string;
  hashtags: string[];
  origin: 'template' | 'manual' | 'ai';
  validationReport: object;
}

export interface NewGenerationRun {
  postId: string;
  ownerId: string;
  platform: string;
  engine: string;
  latencyMs: number;
}

const VARIANT_COLUMNS = `id, post_id, owner_id, platform, body, hashtags, status, origin,
  validation_report, version, created_at, updated_at`;

interface VariantRow {
  id: string;
  post_id: string;
  owner_id: string;
  platform: string;
  body: string;
  hashtags: string[];
  status: string;
  origin: string;
  validation_report: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function toVariant(row: VariantRow): VariantRecord {
  return {
    id: row.id,
    postId: row.post_id,
    ownerId: row.owner_id,
    platform: row.platform,
    body: row.body,
    hashtags: row.hashtags,
    status: row.status,
    origin: row.origin,
    validationReport: row.validation_report,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Thrown when the post already has a live (non-rejected) variant for the platform. */
export class LiveVariantExistsError extends Error {
  constructor(readonly platform: string) {
    super(`A live variant already exists for ${platform}`);
  }
}

async function insertVariant(client: PoolClient, variant: NewVariant): Promise<VariantRecord> {
  try {
    const result = await client.query<VariantRow>(
      `INSERT INTO variants (post_id, owner_id, platform, body, hashtags, origin, validation_report)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${VARIANT_COLUMNS}`,
      [
        variant.postId,
        variant.ownerId,
        variant.platform,
        variant.body,
        variant.hashtags,
        variant.origin,
        variant.validationReport,
      ],
    );
    return toVariant(result.rows[0]!);
  } catch (error) {
    if (isUniqueViolation(error, 'variants_live_platform_uq')) {
      throw new LiveVariantExistsError(variant.platform);
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === constraint;
}

export function createVariantsRepository(db: Pool) {
  async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    /** Stores a generated variant and its generation run together. */
    storeGenerated(variant: NewVariant, run: NewGenerationRun): Promise<VariantRecord> {
      return inTransaction(async (client) => {
        const stored = await insertVariant(client, variant);
        await client.query(
          `INSERT INTO generation_runs (post_id, owner_id, platform, engine, attempts, outcome, variant_id, latency_ms)
           VALUES ($1, $2, $3, $4, 1, 'stored', $5, $6)`,
          [run.postId, run.ownerId, run.platform, run.engine, stored.id, run.latencyMs],
        );
        return stored;
      });
    },

    async logBlocked(run: NewGenerationRun, violations: Violation[]): Promise<void> {
      await db.query(
        `INSERT INTO generation_runs (post_id, owner_id, platform, engine, attempts, outcome, violations, latency_ms)
         VALUES ($1, $2, $3, $4, 1, 'blocked', $5, $6)`,
        [
          run.postId,
          run.ownerId,
          run.platform,
          run.engine,
          JSON.stringify(violations),
          run.latencyMs,
        ],
      );
    },

    storeManual(variant: NewVariant): Promise<VariantRecord> {
      return inTransaction((client) => insertVariant(client, variant));
    },

    async listByPost(ownerId: string, postId: string): Promise<VariantRecord[]> {
      const result = await db.query<VariantRow>(
        `SELECT ${VARIANT_COLUMNS} FROM variants
         WHERE owner_id = $1 AND post_id = $2
         ORDER BY created_at, platform`,
        [ownerId, postId],
      );
      return result.rows.map(toVariant);
    },

    async listRuns(ownerId: string, postId: string): Promise<GenerationRunRecord[]> {
      const result = await db.query<{
        id: string;
        post_id: string;
        platform: string;
        engine: string;
        outcome: 'stored' | 'blocked';
        variant_id: string | null;
        violations: Violation[];
        latency_ms: number;
        created_at: Date;
      }>(
        `SELECT id, post_id, platform, engine, outcome, variant_id, violations, latency_ms, created_at
         FROM generation_runs
         WHERE owner_id = $1 AND post_id = $2
         ORDER BY created_at DESC, id`,
        [ownerId, postId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        postId: row.post_id,
        platform: row.platform,
        engine: row.engine,
        outcome: row.outcome,
        variantId: row.variant_id,
        violations: row.violations,
        latencyMs: row.latency_ms,
        createdAt: row.created_at,
      }));
    },
  };
}

export type VariantsRepository = ReturnType<typeof createVariantsRepository>;
