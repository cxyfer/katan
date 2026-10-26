/**
 * Message-id completeness: the localisation contract is only enforceable if the
 * engine's events and rejections are enumerable.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMAND_ERROR_CODES, RULE_EVENT_TYPES } from '../src/types.ts';

const engineSource = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8');

describe('message ids', () => {
  it('lists every event type the engine actually emits', () => {
    const emitted = new Set<string>();
    for (const match of engineSource.matchAll(/emit\(\s*\n?\s*[a-zA-Z]+,\s*'([^']+)'/g)) {
      emitted.add(match[1]!);
    }
    expect(emitted.size).toBeGreaterThan(20);
    const missing = [...emitted].filter((type) => !(RULE_EVENT_TYPES as readonly string[]).includes(type));
    expect(missing).toEqual([]);
    const unused = (RULE_EVENT_TYPES as readonly string[]).filter((type) => !emitted.has(type));
    expect(unused).toEqual([]);
  });

  it('lists every rejection the engine actually returns', () => {
    const raised = new Set<string>();
    for (const match of engineSource.matchAll(/fail\('([^']+)'/g)) raised.add(match[1]!);
    const missing = [...raised].filter(
      (code) => !(COMMAND_ERROR_CODES as readonly string[]).includes(code),
    );
    expect(missing).toEqual([]);
  });

  it('has no duplicate ids', () => {
    expect(new Set(COMMAND_ERROR_CODES).size).toBe(COMMAND_ERROR_CODES.length);
    expect(new Set(RULE_EVENT_TYPES).size).toBe(RULE_EVENT_TYPES.length);
  });

  it('namespaces every id for a stable protocol', () => {
    for (const code of COMMAND_ERROR_CODES) expect(code).toMatch(/^E_[A-Z_]+$/);
    for (const type of RULE_EVENT_TYPES) expect(type).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
  });
});
