import { createHash } from 'node:crypto';

export const MAX_CONTENT_CHARS = 200_000;
const MAX_TITLE_CHARS = 500;
const DERIVED_TITLE_CHARS = 120;

export function normalizeMarkdown(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function deriveTitle(markdown: string, explicit?: string | null): string {
  const given = explicit?.trim();
  if (given) return given.slice(0, MAX_TITLE_CHARS);

  const heading = /^#{1,6}\s+(.+)$/m.exec(markdown)?.[1];
  if (heading) return clean(heading).slice(0, MAX_TITLE_CHARS);

  const firstLine = markdown.split('\n').find((line) => line.trim() !== '') ?? '';
  const text = clean(firstLine);
  if (text.length <= DERIVED_TITLE_CHARS) return text || 'Untitled post';
  return `${text.slice(0, DERIVED_TITLE_CHARS - 1).trimEnd()}…`;
}

function clean(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
