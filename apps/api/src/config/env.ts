import { join } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';
import { repoRoot } from '../lib/repo-root.js';

// Load the root .env for local development. Docker Compose supplies real
// environment variables, and dotenv never overrides values that already exist.
config({ path: join(repoRoot, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  AUTH_MODE: z.enum(['dev', 'clerk']).default('dev'),
  PLATFORMS_CONFIG_PATH: z.string().default('./config/platforms.json'),
  FORCE_ADAPTER: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
