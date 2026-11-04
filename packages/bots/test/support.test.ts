import { describe, expect, it } from 'vitest';
import { PROFILES, getProfile } from '@catan/rules';
import { BOT_RULE_MODULES, botsCanPlay } from '../src/index.ts';

describe('bot ruleset support', () => {
  it('plays the base profiles, including paired 5–6 player turns', () => {
    expect(botsCanPlay(getProfile('base-2025')!)).toBe(true);
    expect(botsCanPlay(getProfile('base-paired-2025')!)).toBe(true);
  });

  it('refuses every profile with a rules module the strategies do not know', () => {
    for (const profile of PROFILES) {
      const known = profile.ruleModules.every((module) => BOT_RULE_MODULES.includes(module));
      expect(botsCanPlay(profile)).toBe(known);
    }
    expect(botsCanPlay({ ruleModules: ['seafarers'] })).toBe(false);
  });
});
