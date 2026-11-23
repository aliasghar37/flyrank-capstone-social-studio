import { describe, expect, it } from 'vitest';
import { PLATFORMS, PROFILES, RULE_IDS } from '@studio/shared';

describe('shared domain foundation', () => {
  it('defines a constraint profile for every platform', () => {
    expect(Object.keys(PROFILES).sort()).toEqual([...PLATFORMS].sort());
  });

  it('keeps every length window sane', () => {
    for (const profile of Object.values(PROFILES)) {
      expect(profile.maxChars).toBeGreaterThan(profile.minChars);
      expect(profile.minChars).toBeGreaterThan(0);
      expect(profile.hashtags.max).toBeGreaterThanOrEqual(profile.hashtags.min);
    }
  });

  it('exposes the rule ids the validator will return', () => {
    expect(RULE_IDS).toContain('max_length');
    expect(RULE_IDS).toContain('hashtag_count');
    expect(RULE_IDS).toContain('link_required');
  });
});
