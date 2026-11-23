import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Find the monorepo root by walking up to the pnpm workspace file.
 * Keeps config paths stable whether a process starts from the repo root,
 * an app directory, or a compiled dist directory.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let current = start;

  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

export const repoRoot = findRepoRoot();
