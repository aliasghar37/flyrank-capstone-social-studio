import type { Platform } from './types.js';

export interface ConstraintProfile {
  platform: Platform;
  maxChars: number;
  minChars: number;
  hashtags: {
    min: number;
    max: number;
    position: 'any' | 'end';
  };
  tone: {
    label: string;
    allowEmoji: boolean;
    maxEmojis: number;
    maxAllCapsWords: number;
    bannedPhrases: string[];
    requireLink: boolean;
    allowMarkdown: boolean;
  };
}

// Rule ids reported by the validator for each violation.
export const RULE_IDS = [
  'max_length',
  'min_length',
  'hashtag_count',
  'hashtag_position',
  'emoji_limit',
  'all_caps',
  'banned_phrase',
  'link_required',
  'markdown_not_allowed',
  'empty_or_whitespace',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

const BANNED_PHRASES = ['game-changer', 'revolutionary', 'click here', "you won't believe"];

// Limits are kept at or below each platform's own maximum.
export const PROFILES: Record<Platform, ConstraintProfile> = {
  x: {
    platform: 'x',
    maxChars: 280,
    minChars: 40,
    hashtags: { min: 0, max: 2, position: 'any' },
    tone: {
      label: 'punchy, direct, one idea',
      allowEmoji: true,
      maxEmojis: 2,
      maxAllCapsWords: 1,
      bannedPhrases: BANNED_PHRASES,
      requireLink: true,
      allowMarkdown: false,
    },
  },
  linkedin: {
    platform: 'linkedin',
    maxChars: 1500,
    minChars: 300,
    hashtags: { min: 1, max: 5, position: 'end' },
    tone: {
      label: 'professional, insight-led, first-person plural allowed',
      allowEmoji: false,
      maxEmojis: 0,
      maxAllCapsWords: 0,
      bannedPhrases: BANNED_PHRASES,
      requireLink: true,
      allowMarkdown: false,
    },
  },
  telegram: {
    platform: 'telegram',
    maxChars: 1200,
    minChars: 100,
    hashtags: { min: 0, max: 3, position: 'any' },
    tone: {
      label: 'friendly, conversational, plain text',
      allowEmoji: true,
      maxEmojis: 5,
      maxAllCapsWords: 2,
      bannedPhrases: BANNED_PHRASES,
      requireLink: true,
      allowMarkdown: false,
    },
  },
  discord: {
    platform: 'discord',
    maxChars: 1200,
    minChars: 80,
    hashtags: { min: 0, max: 2, position: 'any' },
    tone: {
      label: 'casual, community-style, markdown allowed',
      allowEmoji: true,
      maxEmojis: 5,
      maxAllCapsWords: 3,
      bannedPhrases: BANNED_PHRASES,
      requireLink: true,
      allowMarkdown: true,
    },
  },
};
