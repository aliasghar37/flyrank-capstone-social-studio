import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/http-error.js';
import { ownerId } from '../middleware/auth.js';
import type { GenerationService } from '../services/generation-service.js';

const generateBody = z
  .strictObject({ platforms: z.array(z.string()).min(1).optional() })
  .optional();
const manualBody = z.strictObject({
  platform: z.string().min(1),
  body: z.string().max(10_000),
});

function postId(raw: string | string[] | undefined): string {
  const id = z.uuid().safeParse(raw);
  if (!id.success) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');
  return id.data;
}

export function createVariantsRouter(deps: { generation: GenerationService }): Router {
  const router = Router();

  router.post('/posts/:id/generate', async (req, res) => {
    const body = generateBody.parse(req.body ?? undefined);
    const result = await deps.generation.generate(
      ownerId(res),
      postId(req.params.id),
      body?.platforms,
    );
    res.status(result.variants.length > 0 ? 201 : 200).json(result);
  });

  router.get('/posts/:id/variants', async (req, res) => {
    res.json({ variants: await deps.generation.listVariants(ownerId(res), postId(req.params.id)) });
  });

  router.post('/posts/:id/variants', async (req, res) => {
    const input = manualBody.parse(req.body);
    const variant = await deps.generation.createManual(ownerId(res), postId(req.params.id), input);
    res.status(201).json({ variant });
  });

  router.get('/posts/:id/generation-runs', async (req, res) => {
    res.json({ runs: await deps.generation.listRuns(ownerId(res), postId(req.params.id)) });
  });

  return router;
}
