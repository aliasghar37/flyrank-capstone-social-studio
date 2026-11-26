import { countChars, validateVariant } from '@studio/shared';
import type { ConstraintProfile, Platform } from '@studio/shared';

export interface SourcePost {
  title: string;
  contentMarkdown: string;
  sourceUrl: string | null;
}

interface Layout {
  /** Hashtags to add, clamped to the profile's range. */
  hashtags: number;
  /** Rough target length, kept well under maxChars. */
  target: number;
  render: (parts: {
    title: string | null;
    sentences: string[];
    link: string | null;
    tags: string[];
  }) => string;
}

const LAYOUTS: Record<Platform, Layout> = {
  x: {
    hashtags: 1,
    target: 260,
    render: ({ title, sentences, link, tags }) =>
      joinLine([title ? `${title}:` : null, ...sentences, link, ...tags.map((t) => `#${t}`)]),
  },
  linkedin: {
    hashtags: 3,
    target: 1300,
    render: ({ title, sentences, link, tags }) =>
      joinBlocks([
        title,
        ...paragraphs(sentences, 2),
        link ? `Read the full post: ${link}` : null,
        tags.map((t) => `#${t}`).join(' ') || null,
      ]),
  },
  telegram: {
    hashtags: 2,
    target: 900,
    render: ({ title, sentences, link, tags }) =>
      joinBlocks([
        title,
        sentences.join(' ') || null,
        link,
        tags.map((t) => `#${t}`).join(' ') || null,
      ]),
  },
  discord: {
    hashtags: 1,
    target: 900,
    render: ({ title, sentences, link, tags }) =>
      joinBlocks([
        title ? `**${title}**` : null,
        sentences.join(' ') || null,
        link,
        tags.map((t) => `#${t}`).join(' ') || null,
      ]),
  },
};

const STOPWORDS = new Set(
  (
    'about above after again against also because been before being below between both cannot could ' +
    'does doing down during each every from further have having here into itself just more most much ' +
    'must only other ours over same should some such than that their theirs them then there these they ' +
    'this those through under until very what when where which while with would your yours will were ' +
    'like make made many need even still really thing things today post posts blog using used uses'
  ).split(' '),
);

/**
 * Builds a variant from the stored post only. Sentences that would break a
 * tone rule are skipped, so the result is valid whenever the post allows it.
 */
export function generateTemplate(post: SourcePost, profile: ConstraintProfile): string {
  const layout = LAYOUTS[profile.platform];
  const target = Math.min(layout.target, profile.maxChars);
  const context = { sourceUrl: post.sourceUrl };
  const tagCount = clamp(layout.hashtags, profile.hashtags.min, profile.hashtags.max);
  const tags = keywords(`${post.title}\n${post.contentMarkdown}`, tagCount);

  const render = (title: string | null, sentences: string[]) =>
    layout.render({ title, sentences, link: post.sourceUrl, tags });
  const acceptable = (text: string) =>
    validateVariant(text, profile, context).violations.every((v) => v.rule === 'min_length');

  const cleanTitle = plain(post.title);
  const title = cleanTitle && acceptable(render(cleanTitle, [])) ? cleanTitle : null;

  const chosen: string[] = [];
  for (const sentence of sentences(post.contentMarkdown)) {
    if (sentence === cleanTitle) continue;
    const candidate = render(title, [...chosen, sentence]);
    if (countChars(candidate) > target) {
      if (chosen.length === 0) {
        const room = target - countChars(render(title, ['…']));
        const shortened = shorten(sentence, room);
        if (shortened && acceptable(render(title, [shortened]))) chosen.push(shortened);
      }
      break;
    }
    if (acceptable(candidate)) chosen.push(sentence);
  }

  return render(title, chosen);
}

export function plain(markdown: string): string {
  return stripEmphasis(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/(^|\s)#(?=[\p{L}\p{N}_])/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripEmphasis(text: string): string {
  let result = text;
  for (let i = 0; i < 3; i++) {
    const next = result
      .replace(/(\*\*|__|~~)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
      .replace(/(^|[^\p{L}\p{N}*_])([*_])(\S(?:[^\n]*?\S)?)\2(?![\p{L}\p{N}])/gu, '$1$3');
    if (next === result) break;
    result = next;
  }
  return result;
}

function sentences(markdown: string): string[] {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map(plain)
    .filter(Boolean);
  return blocks
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"“'(])/u))
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && /[.!?]$/.test(s));
}

function keywords(text: string, count: number): string[] {
  if (count <= 0) return [];
  const frequency = new Map<string, number>();
  for (const word of plain(text)
    .toLowerCase()
    .match(/\p{L}[\p{L}\p{N}]*/gu) ?? []) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([word]) => word);
}

function shorten(text: string, maxChars: number): string | null {
  if (maxChars < 20) return null;
  const words = text.split(' ');
  let result = '';
  for (const word of words) {
    if (countChars(`${result} ${word}…`) > maxChars) break;
    result = result ? `${result} ${word}` : word;
  }
  return result ? `${result.replace(/[,;:]$/, '')}…` : null;
}

function paragraphs(items: string[], size: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size).join(' '));
  return result;
}

function joinLine(parts: (string | null)[]): string {
  return parts.filter(Boolean).join(' ');
}

function joinBlocks(parts: (string | null)[]): string {
  return parts.filter(Boolean).join('\n\n');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
