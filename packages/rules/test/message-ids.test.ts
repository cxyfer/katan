/**
 * Message-id completeness: the localisation contract is only enforceable if the
 * engine's events and rejections are enumerable.
 */

import { describe, expect, it } from 'vitest';
import engineSource from '../src/engine.ts?raw';
import { COMMAND_ERROR_CODES, RULE_EVENT_TYPES } from '../src/types.ts';

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

  it('lists exactly the rejections the engine actually returns', () => {
    const raised = new Set<string>();
    for (const match of engineSource.matchAll(/fail\('([^']+)'/g)) raised.add(match[1]!);
    expect(raised.size).toBeGreaterThan(15);
    const missing = [...raised].filter(
      (code) => !(COMMAND_ERROR_CODES as readonly string[]).includes(code),
    );
    expect(missing).toEqual([]);
    // The converse: a listed code that nothing raises would make the client
    // carry a translation for an unreachable state.
    const unused = (COMMAND_ERROR_CODES as readonly string[]).filter((code) => !raised.has(code));
    expect(unused).toEqual([]);
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
