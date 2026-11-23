import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { platformsRouter } from './routes/platforms.js';

export const app: Express = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.WEB_URL }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

app.use(healthRouter);
app.use('/api', platformsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
