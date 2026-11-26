import type { ConstraintProfile, RuleId } from './profiles.js';

export interface Violation {
  rule: RuleId;
  limit?: number | string;
  actual?: number | string;
  message: string;
}

export interface ValidationResult {
  passed: boolean;
  violations: Violation[];
}

export interface ValidationContext {
  /** Canonical URL of the source post. The link rule only applies when it is set. */
  sourceUrl?: string | null;
}

const HASHTAG = /(?:^|\s)#([\p{L}\p{N}_]+)/gu;
const URL_PATTERN = /https?:\/\/\S+/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
const MARKDOWN = /\*\*|__|`|\[[^\]]*\]\([^)]*\)|^#{1,6}\s/m;

export function extractHashtags(text: string): string[] {
  return [...text.matchAll(HASHTAG)].map((match) => match[1]!);
}

export function countChars(text: string): number {
  return [...text].length;
}

export function validateVariant(
  text: string,
  profile: ConstraintProfile,
  context: ValidationContext = {},
): ValidationResult {
  if (text.trim() === '') {
    return {
      passed: false,
      violations: [{ rule: 'empty_or_whitespace', message: 'Text is empty' }],
    };
  }

  const violations: Violation[] = [];
  const length = countChars(text);

  if (length > profile.maxChars) {
    violations.push({
      rule: 'max_length',
      limit: profile.maxChars,
      actual: length,
      message: `Text is ${length} characters; maximum is ${profile.maxChars}`,
    });
  }
  if (length < profile.minChars) {
    violations.push({
      rule: 'min_length',
      limit: profile.minChars,
      actual: length,
      message: `Text is ${length} characters; minimum is ${profile.minChars}`,
    });
  }

  const hashtags = extractHashtags(text);
  if (hashtags.length > profile.hashtags.max) {
    violations.push({
      rule: 'hashtag_count',
      limit: profile.hashtags.max,
      actual: hashtags.length,
      message: `${hashtags.length} hashtags; maximum is ${profile.hashtags.max}`,
    });
  } else if (hashtags.length < profile.hashtags.min) {
    violations.push({
      rule: 'hashtag_count',
      limit: profile.hashtags.min,
      actual: hashtags.length,
      message: `${hashtags.length} hashtags; minimum is ${profile.hashtags.min}`,
    });
  }

  if (profile.hashtags.position === 'end' && hashtags.length > 0 && !hashtagsOnlyOnLastLine(text)) {
    violations.push({
      rule: 'hashtag_position',
      limit: 'end',
      message: 'Hashtags must be on the last line, and the last line must only contain hashtags',
    });
  }

  const emojiLimit = profile.tone.allowEmoji ? profile.tone.maxEmojis : 0;
  const emojis = text.match(EMOJI)?.length ?? 0;
  if (emojis > emojiLimit) {
    violations.push({
      rule: 'emoji_limit',
      limit: emojiLimit,
      actual: emojis,
      message: `${emojis} emoji; maximum is ${emojiLimit}`,
    });
  }

  const capsWords = allCapsWords(text);
  if (capsWords.length > profile.tone.maxAllCapsWords) {
    violations.push({
      rule: 'all_caps',
      limit: profile.tone.maxAllCapsWords,
      actual: capsWords.length,
      message: `${capsWords.length} all-caps words (${capsWords.slice(0, 3).join(', ')}); maximum is ${profile.tone.maxAllCapsWords}`,
    });
  }

  const lower = text.toLowerCase();
  for (const phrase of profile.tone.bannedPhrases) {
    if (lower.includes(phrase.toLowerCase())) {
      violations.push({
        rule: 'banned_phrase',
        actual: phrase,
        message: `Contains the banned phrase "${phrase}"`,
      });
    }
  }

  if (profile.tone.requireLink && context.sourceUrl && !text.includes(context.sourceUrl)) {
    violations.push({
      rule: 'link_required',
      limit: context.sourceUrl,
      message: `Text must include the post link ${context.sourceUrl}`,
    });
  }

  if (!profile.tone.allowMarkdown && MARKDOWN.test(text.replace(URL_PATTERN, ''))) {
    violations.push({
      rule: 'markdown_not_allowed',
      message: `Markdown formatting is not allowed on ${profile.platform}`,
    });
  }

  return { passed: violations.length === 0, violations };
}

function hashtagsOnlyOnLastLine(text: string): boolean {
  const lines = text.trim().split('\n');
  const last = lines.pop()!.trim();
  const lastIsTags = last.split(/\s+/).every((word) => /^#[\p{L}\p{N}_]+$/u.test(word));
  return lastIsTags && lines.every((line) => extractHashtags(line).length === 0);
}

function allCapsWords(text: string): string[] {
  const words =
    text
      .replace(URL_PATTERN, ' ')
      .replace(HASHTAG, ' ')
      .match(/\p{L}+/gu) ?? [];
  return words.filter((w) => w.length >= 4 && w === w.toUpperCase() && w !== w.toLowerCase());
}
