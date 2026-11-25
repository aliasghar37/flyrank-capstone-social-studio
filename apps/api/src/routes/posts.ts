import { Router } from 'express';
import { z } from 'zod';
import { ownerId } from '../middleware/auth.js';
import { HttpError } from '../lib/http-error.js';
import type { PostsRepository } from '../repositories/posts.js';
import type { IngestInput, IngestService } from '../services/ingest-service.js';

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

const urlBody = z.strictObject({ url: httpUrl });
const markdownBody = z.strictObject({
  markdown: z.string().min(1).max(200_000),
  title: z.string().max(500).optional(),
  canonicalUrl: httpUrl.optional(),
});
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

function parseIngestBody(body: unknown): IngestInput {
  if (body && typeof body === 'object' && 'url' in body) {
    return { kind: 'url', ...urlBody.parse(body) };
  }
  if (body && typeof body === 'object' && 'markdown' in body) {
    return { kind: 'markdown', ...markdownBody.parse(body) };
  }
  throw new HttpError(400, 'VALIDATION_ERROR', 'Send either "url" or "markdown"');
}

export function createPostsRouter(deps: { posts: PostsRepository; ingest: IngestService }): Router {
  const router = Router();

  router.post('/posts', async (req, res) => {
    const input = parseIngestBody(req.body);
    const { post, created } = await deps.ingest.ingest(ownerId(res), input);
    res.status(created ? 201 : 200).json({ post, created });
  });

  router.get('/posts', async (req, res) => {
    const { limit } = listQuery.parse(req.query);
    res.json({ posts: await deps.posts.listByOwner(ownerId(res), limit) });
  });

  router.get('/posts/:id', async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    const post = id.success ? await deps.posts.findById(ownerId(res), id.data) : null;
    if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');
    res.json({ post });
  });

  return router;
}
