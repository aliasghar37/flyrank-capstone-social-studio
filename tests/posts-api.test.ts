import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Needs a migrated database: TEST_DATABASE_URL=postgresql://... pnpm test
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('posts API', () => {
  let app: Express;
  let pool: Pool;
  let site: Server;
  let siteUrl: string;
  const unique = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const { pool: dbPool } = await import('../apps/api/src/db/pool.js');
    const { requireOwner } = await import('../apps/api/src/middleware/auth.js');
    const { errorHandler } = await import('../apps/api/src/middleware/error-handler.js');
    const { createPostsRepository } = await import('../apps/api/src/repositories/posts.js');
    const { createPostsRouter } = await import('../apps/api/src/routes/posts.js');
    const { createIngestService } = await import('../apps/api/src/services/ingest-service.js');

    pool = dbPool;
    const posts = createPostsRepository(pool);
    const ingest = createIngestService(posts, { allowPrivateHosts: true });
    app = express();
    app.use(express.json());
    app.use('/api', requireOwner, createPostsRouter({ posts, ingest }));
    app.use(errorHandler);

    site = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<html><head><title>Run ${unique}</title></head><body>
        <article><h1>Scheduling notes ${unique}</h1>
        <p>A scheduler that keeps its only copy of the schedule in memory is one restart away from losing work.</p>
        <p>Keeping every slot as a database row means a restart only delays the next publish, it never drops it.</p>
        <p>The queue is there to wake workers up on time, nothing more.</p></article></body></html>`);
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/notes`;
  });

  afterAll(async () => {
    site?.close();
    await pool?.end();
  });

  it('stores pasted markdown and returns it by id', async () => {
    const markdown = `# Launch notes ${unique}\n\nWe shipped the scheduler today.\r\n`;
    const created = await request(app).post('/api/posts').send({ markdown });

    expect(created.status).toBe(201);
    expect(created.body.created).toBe(true);
    expect(created.body.post).toMatchObject({
      ownerId: 'dev_user',
      sourceType: 'markdown',
      sourceUrl: null,
      title: `Launch notes ${unique}`,
      contentMarkdown: `# Launch notes ${unique}\n\nWe shipped the scheduler today.`,
    });

    const fetched = await request(app).get(`/api/posts/${created.body.post.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.post.contentHash).toBe(created.body.post.contentHash);
  });

  it('returns the existing post when the same content is sent again', async () => {
    const markdown = `Repeat me ${unique}`;
    const first = await request(app).post('/api/posts').send({ markdown });
    const second = await request(app)
      .post('/api/posts')
      .send({ markdown: `${markdown}\n\n`, title: 'Other' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.post.id).toBe(first.body.post.id);
  });

  it('ingests a URL and stores the extracted article', async () => {
    const res = await request(app).post('/api/posts').send({ url: siteUrl });

    expect(res.status).toBe(201);
    expect(res.body.post.sourceType).toBe('url');
    expect(res.body.post.sourceUrl).toBe(siteUrl);
    expect(res.body.post.title).toContain(unique);
    expect(res.body.post.contentMarkdown).toContain('one restart away from losing work');
  });

  it('lists posts without their full content', async () => {
    const res = await request(app).get('/api/posts?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.posts.length).toBeGreaterThan(0);
    expect(res.body.posts[0]).not.toHaveProperty('contentMarkdown');
    expect(res.body.posts[0]).toHaveProperty('contentLength');
  });

  it.each([
    [{}, 'VALIDATION_ERROR'],
    [{ markdown: '' }, 'VALIDATION_ERROR'],
    [{ url: 'ftp://example.com/post' }, 'VALIDATION_ERROR'],
    [{ markdown: 'hi', extra: true }, 'VALIDATION_ERROR'],
    [{ markdown: '  \n\t ' }, 'EMPTY_CONTENT'],
  ])('rejects %j with %s', async (body, code) => {
    const res = await request(app).post('/api/posts').send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.code).toBe(code);
  });

  it('returns 404 for unknown or malformed ids', async () => {
    expect((await request(app).get(`/api/posts/${randomUUID()}`)).status).toBe(404);
    expect((await request(app).get('/api/posts/not-a-uuid')).status).toBe(404);
  });
});
