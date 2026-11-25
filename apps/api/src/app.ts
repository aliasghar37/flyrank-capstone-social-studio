import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { requireOwner } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createPostsRepository } from './repositories/posts.js';
import { healthRouter } from './routes/health.js';
import { platformsRouter } from './routes/platforms.js';
import { createPostsRouter } from './routes/posts.js';
import { createIngestService } from './services/ingest-service.js';

export const app: Express = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.WEB_URL }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

app.use(healthRouter);
app.use('/api', platformsRouter);

const posts = createPostsRepository(pool);
app.use('/api', requireOwner, createPostsRouter({ posts, ingest: createIngestService(posts) }));

app.use(notFoundHandler);
app.use(errorHandler);
