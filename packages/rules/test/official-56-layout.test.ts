/** 官方 5–6 人版圖：形狀、A→BB 數字序、固定港口與大廳選項。 */

import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_56_HARBOR_TYPES,
  OFFICIAL_56_NUMBERS,
  OFFICIAL_56_SPIRAL,
  OFFICIAL_56_TOPOLOGY_ID,
  officialPairedLayout,
} from '../src/official-56-board.ts';
import { PAIRED_NUMBER_TOKENS, PAIRED_TERRAIN_MULTISET } from '../src/layout.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { seededRng } from '../src/rng.ts';
import { getTopology } from '../src/topology-registry.ts';
import { hexNeighbors } from '../src/topology.ts';
import { newGame } from './helpers.ts';
import { simulateGame } from './simulate.ts';

const topology = getTopology(OFFICIAL_56_TOPOLOGY_ID);
const sorted = <T>(values: readonly T[]) => [...values].sort();

describe('official 5–6 topology', () => {
  it('is the symmetric 3-4-5-6-5-4-3 board with 80 corners, 109 edges and 38 shore edges', () => {
    expect(topology.hexes).toHaveLength(30);
    expect(topology.vertices).toHaveLength(80);
    expect(topology.edges).toHaveLength(109);
    expect(topology.coastalEdges).toHaveLength(38);
    const rows = new Map<number, number[]>();
    for (const hex of topology.hexes) rows.set(hex.r, [...(rows.get(hex.r) ?? []), hex.x]);
    expect([...rows.keys()].sort((a, b) => a - b).map((r) => rows.get(r)!.length)).toEqual([3, 4, 5, 6, 5, 4, 3]);
    const centres = [...rows.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
    for (const centre of centres) expect(centre).toBeCloseTo(centres[0]!, 6);
    // 每塊至少 3 個鄰格，沒有只掛一角的突出格。
    for (let hex = 0; hex < topology.hexes.length; hex++) expect(hexNeighbors(topology, hex).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps hex-r56 untouched', () => {
    expect(getTopology('hex-r56').vertices).toHaveLength(83);
  });

  it('puts the 11 printed harbors on distinct shore edges', () => {
    expect(topology.harborSlots).toHaveLength(11);
    expect(new Set(topology.harborSlots).size).toBe(11);
    for (const edge of topology.harborSlots) expect(topology.edges[edge]!.hexes).toHaveLength(1);
    expect(sorted(OFFICIAL_56_HARBOR_TYPES)).toEqual(
      sorted(['generic', 'generic', 'generic', 'generic', 'generic', 'lumber', 'brick', 'ore', 'grain', 'wool', 'wool']),
    );
  });
});

describe('A→BB spiral', () => {
  const indexOf = (q: number, r: number) => topology.hexes.findIndex((hex) => hex.q === q && hex.r === r);

  it('visits every hex once, each step to a neighbour', () => {
    const path = OFFICIAL_56_SPIRAL.map(({ q, r }) => indexOf(q, r));
    expect(path.every((hex) => hex >= 0)).toBe(true);
    expect(new Set(path).size).toBe(30);
    for (let step = 1; step < path.length; step++) {
      expect(hexNeighbors(topology, path[step - 1]!)).toContain(path[step]);
    }
  });

  it('starts at the bottom-left corner and ends in the centre ring', () => {
    expect(OFFICIAL_56_SPIRAL[0]).toEqual({ q: -3, r: 3 });
    expect(OFFICIAL_56_SPIRAL[16]).toEqual({ q: -2, r: 2 });
    expect(OFFICIAL_56_SPIRAL.at(-1)).toEqual({ q: -1, r: 0 });
  });

  it('uses the standard 28-token inventory', () => {
    expect(sorted(OFFICIAL_56_NUMBERS)).toEqual(sorted(PAIRED_NUMBER_TOKENS));
  });
});

describe('official layout', () => {
  it('shuffles terrain only and lays the tokens in A→BB order, skipping deserts', () => {
    for (const seed of [1, 2, 3, 7, 99]) {
      const layout = officialPairedLayout(topology, seededRng(seed));
      expect(sorted(layout.terrain)).toEqual(sorted(PAIRED_TERRAIN_MULTISET));
      const along = OFFICIAL_56_SPIRAL
        .map(({ q, r }) => topology.hexes.findIndex((hex) => hex.q === q && hex.r === r))
        .map((hex) => layout.numbers[hex]);
      expect(along.filter((n) => n !== null)).toEqual([...OFFICIAL_56_NUMBERS]);
      layout.terrain.forEach((terrain, hex) => expect(layout.numbers[hex] === null).toBe(terrain === 'desert'));
      expect(layout.terrain[layout.robber]).toBe('desert');
      expect(layout.harbors.map((harbor) => harbor.type)).toEqual([...OFFICIAL_56_HARBOR_TYPES]);
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const a = officialPairedLayout(topology, seededRng(5));
    expect(officialPairedLayout(topology, seededRng(5))).toEqual(a);
    expect(officialPairedLayout(topology, seededRng(6)).terrain).not.toEqual(a.terrain);
  });
});

describe('official setup mode', () => {
  it('is offered by the paired base profile only', () => {
    expect(getProfile('base-paired-2025')!.setupModes).toEqual(['fixed', 'variable', 'official']);
    expect(getProfile('base-2025')!.setupModes).toEqual(['fixed', 'variable']);
    const request = { expansions: [], scenario: null, variants: [] };
    expect(resolveCombination({ ...request, playerCount: 5, setupMode: 'official' }).ok).toBe(true);
    expect(resolveCombination({ ...request, playerCount: 4, setupMode: 'official' })).toEqual({ ok: false, reason: 'bad-setup-mode' });
  });

  it('creates 5- and 6-player games on the official board', () => {
    for (const players of [5, 6]) {
      const { state } = newGame({ players, profileId: 'base-paired-2025', mode: 'official', seed: 11 });
      expect(state.board.layout.topologyId).toBe(OFFICIAL_56_TOPOLOGY_ID);
      expect(state.board.layout.harbors).toHaveLength(11);
      expect(state.board.buildings).toHaveLength(80);
      expect(state.board.roads).toHaveLength(109);
    }
  });

  it('rejects official setup on the 3–4 player base profile', () => {
    expect(() => newGame({ players: 4, profileId: 'base-2025', mode: 'official' })).toThrow(/does not support official/);
  });

  it('plays whole simulated 5- and 6-player games to a winner', () => {
    for (const players of [5, 6]) {
      const state = simulateGame(5, 6000, { players, profileId: 'base-paired-2025', mode: 'official' });
      expect(state.result?.reason).toBe('victory');
    }
  }, 60_000);
});
