import { describe, expect, it } from 'vitest';
import { extractHashtags, PROFILES, validateVariant } from '@studio/shared';

const URL = 'https://example.com/blog/queues';
const rules = (text: string, platform: keyof typeof PROFILES, sourceUrl: string | null = URL) =>
  validateVariant(text, PROFILES[platform], { sourceUrl }).violations.map((v) => v.rule);

const okX = `Durable queues keep scheduled posts safe across restarts. ${URL} #backend`;

describe('validateVariant', () => {
  it('passes a well-formed variant', () => {
    expect(validateVariant(okX, PROFILES.x, { sourceUrl: URL })).toEqual({
      passed: true,
      violations: [],
    });
  });

  it('blocks empty text with a single rule', () => {
    expect(rules('   \n ', 'x')).toEqual(['empty_or_whitespace']);
  });

  it('names max_length with limit and actual', () => {
    const result = validateVariant(`${'a'.repeat(300)} ${URL}`, PROFILES.x, { sourceUrl: URL });
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toMatchObject({ rule: 'max_length', limit: 280 });
    expect(result.violations[0]!.message).toMatch(/maximum is 280/);
  });

  it('names min_length', () => {
    expect(rules(`Too short ${URL}`, 'linkedin')).toContain('min_length');
  });

  it('counts hashtags against the maximum and minimum', () => {
    expect(rules(`${okX} #one #two #three`, 'x')).toContain('hashtag_count');
    const noTags = `${'Insight sentence about queues. '.repeat(12)}${URL}`;
    expect(rules(noTags, 'linkedin')).toContain('hashtag_count');
  });

  it('requires LinkedIn hashtags on the last line only', () => {
    const body = 'Durable queues matter for every team that schedules work. '.repeat(6);
    expect(rules(`${body}\n\n${URL}\n\n#backend #queues`, 'linkedin')).toEqual([]);
    expect(rules(`#backend ${body}\n\n${URL}`, 'linkedin')).toContain('hashtag_position');
  });

  it('limits emoji, and blocks them where not allowed', () => {
    expect(rules(`${okX} 🚀🚀🚀`, 'x')).toContain('emoji_limit');
    const body = 'Durable queues matter for every team that schedules work. '.repeat(6);
    expect(rules(`${body} 🚀\n\n${URL}\n\n#backend`, 'linkedin')).toContain('emoji_limit');
  });

  it('limits all-caps words but ignores URLs and hashtags', () => {
    expect(rules(`HUGE NEWS about queues today. ${URL} #backend`, 'x')).toContain('all_caps');
    expect(rules(`Queues keep posts safe in production. ${URL} #BACKEND`, 'x')).toEqual([]);
  });

  it('blocks banned phrases case-insensitively', () => {
    const result = validateVariant(`This is a Game-Changer for queues. ${URL}`, PROFILES.x, {
      sourceUrl: URL,
    });
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: 'banned_phrase', actual: 'game-changer' }),
    );
  });

  it('requires the post link only when the post has one', () => {
    expect(rules('Durable queues keep scheduled posts safe across restarts.', 'x')).toContain(
      'link_required',
    );
    expect(rules('Durable queues keep scheduled posts safe across restarts.', 'x', null)).toEqual(
      [],
    );
  });

  it('blocks markdown where it is not allowed', () => {
    expect(rules(`Durable queues keep **scheduled** posts safe. ${URL}`, 'x')).toContain(
      'markdown_not_allowed',
    );
    expect(
      rules(`**Durable queues** keep scheduled posts safe across restarts. ${URL}`, 'discord'),
    ).toEqual([]);
  });

  it('reports every broken rule at once', () => {
    const text = `${'Huge launch. '.repeat(30)}#a #b #c #d #e`;
    expect(rules(text, 'x')).toEqual(
      expect.arrayContaining(['max_length', 'hashtag_count', 'link_required']),
    );
  });
});

describe('extractHashtags', () => {
  it('finds hashtags but not URL fragments or headings', () => {
    expect(extractHashtags('Read https://x.com/a#section and #one, #two_2\n# Heading')).toEqual([
      'one',
      'two_2',
    ]);
  });
});
