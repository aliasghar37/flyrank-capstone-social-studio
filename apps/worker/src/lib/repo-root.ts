import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
