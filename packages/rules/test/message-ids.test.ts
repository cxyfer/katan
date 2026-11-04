/**
 * Message-id completeness: the localisation contract is only enforceable if the
 * engine's and every rules module's events and rejections are enumerable.
 */

import { describe, expect, it } from 'vitest';
import engineSource from '../src/engine.ts?raw';
import {
  BASE_COMMAND_ERROR_CODES,
  BASE_RULE_EVENT_TYPES,
  COMMAND_ERROR_CODES,
  RULE_EVENT_TYPES,
} from '../src/messages.ts';
import { BUILT_IN_MODULES } from '../src/modules/builtins.ts';
import { MODULE_MESSAGES } from '../src/modules/messages.ts';

// Include each module's nested implementation files as well as its entry point.
const moduleSources = import.meta.glob<string>('../src/modules/*/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function sourcesOf(moduleId: string): string {
  return Object.entries(moduleSources)
    .filter(([path]) => path.startsWith(`../src/modules/${moduleId}/`))
    .map(([, source]) => source)
    .join('\n');
}

function emitted(source: string): Set<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(/emit\(\s*\n?\s*[a-zA-Z]+,\s*'([^']+)'/g)) out.add(match[1]!);
  return out;
}

function raised(source: string): Set<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(/fail\('([^']+)'/g)) out.add(match[1]!);
  return out;
}

function diff(listed: readonly string[], used: Set<string>) {
  return {
    missing: [...used].filter((id) => !listed.includes(id)),
    unused: listed.filter((id) => !used.has(id)),
  };
}

describe('message ids', () => {
  it('lists every event type the base engine actually emits', () => {
    const used = emitted(engineSource);
    expect(used.size).toBeGreaterThan(20);
    expect(diff(BASE_RULE_EVENT_TYPES, used)).toEqual({ missing: [], unused: [] });
  });

  it('lists exactly the rejections the base engine actually returns', () => {
    const used = raised(engineSource);
    expect(used.size).toBeGreaterThan(15);
    // The converse matters too: a listed code that nothing raises would make
    // the client carry a translation for an unreachable state.
    expect(diff(BASE_COMMAND_ERROR_CODES, used)).toEqual({ missing: [], unused: [] });
  });

  it('keeps every rules module list in step with that module\'s sources', () => {
    expect(Object.keys(MODULE_MESSAGES).sort()).toEqual(BUILT_IN_MODULES.map((module) => module.id).sort());
    for (const [id, messages] of Object.entries(MODULE_MESSAGES)) {
      const source = sourcesOf(id);
      expect(source.length, id).toBeGreaterThan(0);
      expect(diff(messages.eventTypes, emitted(source)), `${id} events`).toEqual({ missing: [], unused: [] });
      // Modules may also raise base codes through `kit.fail`; only their own
      // list must be fully used.
      const own = [...raised(source)].filter((code) => !(BASE_COMMAND_ERROR_CODES as readonly string[]).includes(code));
      expect(diff(messages.errorCodes, new Set(own)), `${id} errors`).toEqual({ missing: [], unused: [] });
    }
  });

  it('merges base and module lists without duplicates', () => {
    expect(new Set(COMMAND_ERROR_CODES).size).toBe(COMMAND_ERROR_CODES.length);
    expect(new Set(RULE_EVENT_TYPES).size).toBe(RULE_EVENT_TYPES.length);
    const moduleErrors = Object.values(MODULE_MESSAGES).flatMap((messages) => messages.errorCodes);
    const moduleEvents = Object.values(MODULE_MESSAGES).flatMap((messages) => messages.eventTypes);
    expect(COMMAND_ERROR_CODES).toEqual([...BASE_COMMAND_ERROR_CODES, ...moduleErrors]);
    expect(RULE_EVENT_TYPES).toEqual([...BASE_RULE_EVENT_TYPES, ...moduleEvents]);
  });

  it('namespaces every id for a stable protocol', () => {
    for (const code of COMMAND_ERROR_CODES) expect(code).toMatch(/^E_[A-Z_]+$/);
    for (const type of RULE_EVENT_TYPES) expect(type).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
  });
});
