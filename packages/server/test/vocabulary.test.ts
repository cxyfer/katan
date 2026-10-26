/**
 * Localisation vocabulary guard.
 *
 * The service authors its own notice and rejection ids (`blocker.*`,
 * `error.E_*`). Nothing in the type system stops a new literal from being added
 * there while the client catalogs stay silent, which is how raw ids such as
 * `blocker.seats` reached players. This test scans the service source and fails
 * when a literal is missing from the protocol vocabulary.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ERROR_MESSAGE_IDS,
  REQUIRED_MESSAGE_IDS,
  ROOM_NOTICE_IDS,
  SERVER_ERROR_IDS,
} from '@catan/protocol';

function serviceSources(dir = new URL('../src', import.meta.url).pathname): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...serviceSources(path));
    } else if (path.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

function literalIds(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of serviceSources()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/'((?:error|blocker)\.[A-Za-z_.]+)'/g)) {
      const id = match[1]!;
      const list = found.get(id) ?? [];
      list.push(file.replace(/^.*packages\/server\//, ''));
      found.set(id, list);
    }
  }
  return found;
}

describe('service localisation vocabulary', () => {
  it('declares every message id the service can send', () => {
    const vocabulary = new Set(REQUIRED_MESSAGE_IDS);
    const undeclared = [...literalIds().entries()]
      .filter(([id]) => !vocabulary.has(id))
      .map(([id, files]) => `${id} (${files.join(', ')})`);
    expect(undeclared).toEqual([]);
  });

  it('does not declare a service id that nothing sends', () => {
    const sent = new Set(literalIds().keys());
    const unused = [...SERVER_ERROR_IDS, ...ROOM_NOTICE_IDS].filter((id) => !sent.has(id));
    expect(unused).toEqual([]);
  });

  it('keeps the service vocabulary disjoint from the engine vocabulary', () => {
    // A rejection raised by the engine must not also be declared as a service
    // rejection, or the two owners would drift apart.
    const overlap = SERVER_ERROR_IDS.filter((id) => ERROR_MESSAGE_IDS.includes(id));
    expect(overlap).toEqual([]);
  });

  it('scans a plausible number of sources', () => {
    expect(serviceSources().length).toBeGreaterThanOrEqual(8);
    expect(literalIds().size).toBeGreaterThanOrEqual(30);
  });
});
