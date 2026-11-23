import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { PLATFORMS, PROFILES, type ConstraintProfile, type Platform } from '@studio/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { repoRoot } from '../lib/repo-root.js';

const platformConfigSchema = z.object({
  enabled: z.array(z.enum(PLATFORMS)).min(1),
  adapters: z.record(z.enum(PLATFORMS), z.string().min(1)),
});

export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export function loadPlatformConfig(): PlatformConfig {
  const path = isAbsolute(env.PLATFORMS_CONFIG_PATH)
    ? env.PLATFORMS_CONFIG_PATH
    : join(repoRoot, env.PLATFORMS_CONFIG_PATH);

  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return platformConfigSchema.parse(raw);
}

export function enabledProfiles(config: PlatformConfig): ConstraintProfile[] {
  return config.enabled.map((platform: Platform) => PROFILES[platform]);
}
