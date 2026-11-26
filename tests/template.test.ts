import { describe, expect, it } from 'vitest';
import { PLATFORMS, PROFILES, validateVariant } from '@studio/shared';
import { generateTemplate } from '../apps/api/src/generation/template.js';

const post = {
  title: 'Why durable queues matter',
  sourceUrl: 'https://example.com/blog/why-durable-queues-matter',
  contentMarkdown: `# Why durable queues matter

In 2025 our team lost 14 scheduled posts when a single Redis node restarted.
We moved the job store into PostgreSQL and kept Redis only for wake-ups.
Since then, worker restarts have caused zero missed or duplicate posts.`,
};

const longPost = {
  title: 'Notes on scheduling',
  sourceUrl: null,
  contentMarkdown: Array.from(
    { length: 40 },
    (_, i) =>
      `Paragraph ${i + 1} explains how the scheduler keeps every slot safe during restarts and retries.`,
  ).join('\n\n'),
};

describe('generateTemplate', () => {
  it.each(PLATFORMS)('produces a valid %s variant for the sample post', (platform) => {
    const text = generateTemplate(post, PROFILES[platform]);
    expect(validateVariant(text, PROFILES[platform], { sourceUrl: post.sourceUrl })).toEqual({
      passed: true,
      violations: [],
    });
    expect(text).toContain(post.sourceUrl);
  });

  it('makes different text for different platforms', () => {
    const texts = new Set(PLATFORMS.map((p) => generateTemplate(post, PROFILES[p])));
    expect(texts.size).toBe(PLATFORMS.length);
  });

  it.each(PLATFORMS)('keeps a long %s variant within its limit', (platform) => {
    const text = generateTemplate(longPost, PROFILES[platform]);
    expect(validateVariant(text, PROFILES[platform]).passed).toBe(true);
  });

  it('skips sentences that would break a tone rule', () => {
    const text = generateTemplate(
      {
        ...post,
        contentMarkdown: `${post.contentMarkdown}\n\nThis queue design is a game-changer for everyone.\n\nIt is VERY VERY FAST NOW.`,
      },
      PROFILES.linkedin,
    );
    expect(text).not.toMatch(/game-changer/i);
    expect(text).not.toContain('VERY');
  });

  it('strips markdown and emoji from the source', () => {
    const text = generateTemplate(
      {
        ...post,
        contentMarkdown:
          'We **really** like [durable queues](https://q.dev) 🚀 for scheduled posts and retries.',
      },
      PROFILES.telegram,
    );
    expect(text).toContain('We really like durable queues for scheduled posts and retries.');
    expect(text).not.toContain('**');
    expect(text).not.toContain('🚀');
  });

  it('cannot reach the minimum length for a tiny post, so validation blocks it', () => {
    const text = generateTemplate(
      { title: 'Short', sourceUrl: null, contentMarkdown: 'Tiny.' },
      PROFILES.linkedin,
    );
    expect(validateVariant(text, PROFILES.linkedin).violations.map((v) => v.rule)).toContain(
      'min_length',
    );
  });
});

describe('plain', () => {
  it('removes nested emphasis but keeps snake_case words', async () => {
    const { plain } = await import('../apps/api/src/generation/template.js');
    expect(plain('**Store config in _environment variables_** like MAX_RETRIES.')).toBe(
      'Store config in environment variables like MAX_RETRIES.',
    );
  });

  it('keeps dots inside file names in the same sentence', () => {
    const text = generateTemplate(
      {
        title: 'Config',
        sourceUrl: null,
        contentMarkdown:
          'Internal config such as `config/routes.rb` in Rails is not deploy config. It can live in the code safely and that is fine.',
      },
      PROFILES.telegram,
    );
    expect(text).toContain(
      'Internal config such as config/routes.rb in Rails is not deploy config.',
    );
  });
});
