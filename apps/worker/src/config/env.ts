import { join } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';
import { repoRoot } from '../lib/repo-root.js';

config({ path: join(repoRoot, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  PLATFORMS_CONFIG_PATH: z.string().default('./config/platforms.json'),
  FORCE_ADAPTER: z.string().default(''),
  PUBLISH_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_PUBLISH_ATTEMPTS: z.coerce.number().int().positive().default(5),
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  ENABLE_CRASH_HOOKS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  CRASH_AT: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid worker environment configuration:', parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
