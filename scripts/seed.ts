import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
config({ path: join(repoRoot, '.env') });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const sql = readFileSync(join(repoRoot, 'db/seed/seed.sql'), 'utf8');
  await client.query(sql);
  console.log('Seed applied: dev_user demo post and variants.');
} finally {
  await client.end();
}
