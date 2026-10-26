/**
 * Board layouts. Terrain/number/harbor assignment is separate from topology so
 * that scenario data can be transcribed and reviewed independently.
 *
 * Variable setup follows B25: terrain tiles are shuffled freely, then the
 * shuffled number tokens are laid out in the printed spiral order starting from
 * a corner, and the harbor tokens are shuffled across the marked positions.
 */

import type { Rng } from './rng.ts';
import { shuffle } from './rng.ts';
import { buildTopology, type BoardTopology } from './topology.ts';
import type { BoardLayout, HarborType, Terrain } from './types.ts';

export const BASE_TERRAIN_MULTISET: readonly Terrain[] = [
  'forest',
  'forest',
  'forest',
  'forest',
  'pasture',
  'pasture',
  'pasture',
  'pasture',
  'fields',
  'fields',
  'fields',
  'fields',
  'hills',
  'hills',
  'hills',
  'mountains',
  'mountains',
  'mountains',
  'desert',
];

export const BASE_NUMBER_TOKENS: readonly number[] = [
  2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
];

export const BASE_HARBOR_TOKENS: readonly HarborType[] = [
  'generic',
  'grain',
  'generic',
  'ore',
  'wool',
  'generic',
  'brick',
  'lumber',
  'generic',
];

/**
 * Fixed (first-game) base board, transcribed in row order where rows are the
 * hexes with equal axial `r` sorted by `q` (r = -2 is the top row).
 */
export const FIXED_BASE_TERRAIN: readonly Terrain[] = [
  'mountains', 'pasture', 'forest',
  'fields', 'pasture', 'hills', 'fields',
  'fields', 'forest', 'desert', 'mountains', 'forest',
  'mountains', 'hills', 'pasture', 'pasture',
  'forest', 'fields', 'hills',
];

export const FIXED_BASE_NUMBERS: readonly (number | null)[] = [
  10, 2, 9,
  12, 6, 4, 10,
  9, 11, null, 3, 8,
  8, 3, 4, 5,
  5, 6, 11,
];

/**
 * Spiral order used to lay number tokens down: outer ring first, starting from
 * the top-left corner and proceeding clockwise.
 */
export function spiralOrder(topo: BoardTopology): number[] {
  const byRing = new Map<number, { hex: number; angle: number }[]>();
  topo.hexes.forEach((hex, index) => {
    const ring = Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
    const angle = Math.atan2(hex.y, hex.x);
    const list = byRing.get(ring) ?? [];
    list.push({ hex: index, angle });
    byRing.set(ring, list);
  });
  const rings = [...byRing.keys()].sort((a, b) => b - a);
  const out: number[] = [];
  for (const ring of rings) {
    const list = byRing.get(ring)!;
    // Screen coordinates have y growing downwards; -135deg is the top-left.
    const start = (-3 * Math.PI) / 4;
    list.sort((a, b) => norm(a.angle - start) - norm(b.angle - start));
    out.push(...list.map((entry) => entry.hex));
  }
  return out;
}

function norm(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

export interface BaseLayoutOptions {
  topology?: BoardTopology;
  mode: 'fixed' | 'variable';
  rng: Rng;
  /** Robber placement for the fixed layout (desert). */
  robber?: number;
}

export function buildBaseLayout(options: BaseLayoutOptions): BoardLayout {
  const topo = options.topology ?? buildTopology(2);
  if (topo.hexes.length !== 19) {
    throw new Error(`base layout requires a 19-hex board, got ${topo.hexes.length}`);
  }
  if (options.mode === 'fixed') {
    return {
      topologyId: topo.id,
      terrain: FIXED_BASE_TERRAIN.slice(),
      numbers: FIXED_BASE_NUMBERS.slice(),
      harbors: topo.harborSlots.map((edge, i) => ({
        edge,
        type: BASE_HARBOR_TOKENS[i % BASE_HARBOR_TOKENS.length]!,
      })),
      islands: topo.hexes.map(() => 0),
      robber: FIXED_BASE_TERRAIN.indexOf('desert'),
      pirate: null,
    };
  }

  const terrain = shuffle(BASE_TERRAIN_MULTISET, options.rng);
  const order = spiralOrder(topo);
  const numbers: (number | null)[] = topo.hexes.map(() => null);
  const tokens = shuffle(BASE_NUMBER_TOKENS, options.rng);
  let cursor = 0;
  for (const hex of order) {
    if (terrain[hex] === 'desert') continue;
    numbers[hex] = tokens[cursor++] ?? null;
  }
  const harborTokens = shuffle(BASE_HARBOR_TOKENS, options.rng);
  return {
    topologyId: topo.id,
    terrain,
    numbers,
    harbors: topo.harborSlots.map((edge, i) => ({ edge, type: harborTokens[i]! })),
    islands: topo.hexes.map(() => 0),
    robber: terrain.indexOf('desert'),
    pirate: null,
  };
}

/** Harbors usable by a player given their buildings (harbor edge endpoints). */
export function harborTypeForEdge(layout: BoardLayout, edge: number): HarborType | null {
  const harbor = layout.harbors.find((h) => h.edge === edge);
  return harbor ? harbor.type : null;
}
