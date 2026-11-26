import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Needs a migrated database: TEST_DATABASE_URL=postgresql://... pnpm test
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('variants API', () => {
  let app: Express;
  let pool: Pool;
  const unique = randomUUID();
  const sourceUrl = `https://example.com/blog/${unique}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const { pool: dbPool } = await import('../apps/api/src/db/pool.js');
    const { requireOwner } = await import('../apps/api/src/middleware/auth.js');
    const { errorHandler } = await import('../apps/api/src/middleware/error-handler.js');
    const { createPostsRepository } = await import('../apps/api/src/repositories/posts.js');
    const { createVariantsRepository } = await import('../apps/api/src/repositories/variants.js');
    const { createPostsRouter } = await import('../apps/api/src/routes/posts.js');
    const { createVariantsRouter } = await import('../apps/api/src/routes/variants.js');
    const { createIngestService } = await import('../apps/api/src/services/ingest-service.js');
    const { createGenerationService } =
      await import('../apps/api/src/services/generation-service.js');

    pool = dbPool;
    const posts = createPostsRepository(pool);
    const generation = createGenerationService({
      posts,
      variants: createVariantsRepository(pool),
      enabledPlatforms: ['telegram', 'discord', 'x', 'linkedin'],
    });
    app = express();
    app.use(express.json());
    app.use('/api', requireOwner, createPostsRouter({ posts, ingest: createIngestService(posts) }));
    app.use('/api', requireOwner, createVariantsRouter({ generation }));
    app.use(errorHandler);
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createPost(markdown: string, canonicalUrl?: string): Promise<string> {
    const res = await request(app).post('/api/posts').send({ markdown, canonicalUrl });
    expect(res.status).toBe(201);
    return res.body.post.id;
  }

  const article = `# Durable scheduling ${unique}

A scheduler that keeps its only copy of the schedule in memory is one restart away from losing work.
Keeping every slot as a database row means a restart only delays the next publish.
The queue is there to wake workers up on time, and nothing more.`;

  it('generates one valid variant per enabled platform, then skips on a repeat call', async () => {
    const postId = await createPost(article, sourceUrl);

    const first = await request(app).post(`/api/posts/${postId}/generate`).send();
    expect(first.status).toBe(201);
    expect(first.body.blocked).toEqual([]);
    expect(first.body.variants.map((v: { platform: string }) => v.platform).sort()).toEqual([
      'discord',
      'linkedin',
      'telegram',
      'x',
    ]);
    for (const variant of first.body.variants) {
      expect(variant.status).toBe('draft');
      expect(variant.origin).toBe('template');
      expect(variant.validationReport).toEqual({ passed: true, violations: [] });
      expect(variant.body).toContain(sourceUrl);
    }
    expect(new Set(first.body.variants.map((v: { body: string }) => v.body)).size).toBe(4);

    const second = await request(app).post(`/api/posts/${postId}/generate`).send();
    expect(second.status).toBe(200);
    expect(second.body.variants).toEqual([]);
    expect(second.body.skipped).toHaveLength(4);

    const list = await request(app).get(`/api/posts/${postId}/variants`);
    expect(list.body.variants).toHaveLength(4);
  });

  it('can generate for selected platforms only', async () => {
    const postId = await createPost(`${article}\n\nSelected run.`, sourceUrl);
    const res = await request(app)
      .post(`/api/posts/${postId}/generate`)
      .send({ platforms: ['x', 'telegram'] });
    expect(res.body.variants.map((v: { platform: string }) => v.platform).sort()).toEqual([
      'telegram',
      'x',
    ]);
  });

  it('blocks a variant that breaks a rule, logs it, and never stores it', async () => {
    const postId = await createPost(`Tiny note ${unique}.`);

    const res = await request(app)
      .post(`/api/posts/${postId}/generate`)
      .send({ platforms: ['linkedin'] });
    expect(res.status).toBe(200);
    expect(res.body.variants).toEqual([]);
    expect(res.body.blocked[0].platform).toBe('linkedin');
    expect(res.body.blocked[0].violations.map((v: { rule: string }) => v.rule)).toContain(
      'min_length',
    );

    const runs = await request(app).get(`/api/posts/${postId}/generation-runs`);
    expect(runs.body.runs[0]).toMatchObject({
      platform: 'linkedin',
      outcome: 'blocked',
      variantId: null,
    });
    expect((await request(app).get(`/api/posts/${postId}/variants`)).body.variants).toEqual([]);
  });

  it('rejects a hand-written variant that breaks rules with 422 naming each rule', async () => {
    const postId = await createPost(`${article}\n\nManual run.`, sourceUrl);
    const body = `${'This launch changes how we ship. '.repeat(12)}#a #b #c #d #e`;

    const res = await request(app)
      .post(`/api/posts/${postId}/variants`)
      .send({ platform: 'x', body });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CONSTRAINT_VIOLATION');
    expect(res.body.error.message).toMatch(/max_length/);
    const rules = res.body.error.details.map((d: { rule: string }) => d.rule);
    expect(rules).toEqual(expect.arrayContaining(['max_length', 'hashtag_count', 'link_required']));
    expect((await request(app).get(`/api/posts/${postId}/variants`)).body.variants).toEqual([]);
  });

  it('stores a valid hand-written variant, and refuses a second live one', async () => {
    const postId = await createPost(`${article}\n\nManual valid run.`, sourceUrl);
    const body = `Keep the schedule in the database, not in memory. ${sourceUrl} #backend`;

    const created = await request(app)
      .post(`/api/posts/${postId}/variants`)
      .send({ platform: 'x', body });
    expect(created.status).toBe(201);
    expect(created.body.variant).toMatchObject({
      platform: 'x',
      origin: 'manual',
      hashtags: ['backend'],
    });

    const again = await request(app)
      .post(`/api/posts/${postId}/variants`)
      .send({ platform: 'x', body });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LIVE_VARIANT_EXISTS');
  });

  it('rejects unknown platforms and unknown posts', async () => {
    const postId = await createPost(`${article}\n\nPlatform check.`, sourceUrl);
    const bad = await request(app)
      .post(`/api/posts/${postId}/generate`)
      .send({ platforms: ['instagram'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('PLATFORM_NOT_ENABLED');

    expect((await request(app).post(`/api/posts/${randomUUID()}/generate`).send()).status).toBe(
      404,
    );
    expect((await request(app).get('/api/posts/nope/variants')).status).toBe(404);
  });
});
