/**
 * Barbarian Attack board (TB25 p. 15): castle and desert at fixed corners,
 * the printed number discs, random terrain by coastal/inner area.
 */

import type { LayoutContext } from '../../../layout-registry.ts';
import { shuffle } from '../../../rng.ts';
import type { BoardTopology, HexCoord } from '../../../topology.ts';
import type { BoardLayout, Terrain } from '../../../types.ts';
import { hexIndex, ring, shuffledHarbors } from '../boardHelpers.ts';

export const BARBARIANS_LAYOUT_ID = 'tb-barbarian-attack';

export const CASTLE: HexCoord = { q: -2, r: 2 };
export const DESERT: HexCoord = { q: 2, r: -2 };

/** Number discs as printed (the 11 removed from the base set leaves one each 2–12 on the coast). */
export const PRINTED_NUMBERS: readonly (HexCoord & { number: number })[] = [
  { q: 0, r: -2, number: 3 }, { q: 1, r: -2, number: 8 },
  { q: -1, r: -1, number: 9 }, { q: 0, r: -1, number: 4 }, { q: 1, r: -1, number: 5 }, { q: 2, r: -1, number: 10 },
  { q: -2, r: 0, number: 12 }, { q: -1, r: 0, number: 6 }, { q: 0, r: 0, number: 10 }, { q: 1, r: 0, number: 8 }, { q: 2, r: 0, number: 11 },
  { q: -2, r: 1, number: 4 }, { q: -1, r: 1, number: 9 }, { q: 0, r: 1, number: 3 }, { q: 1, r: 1, number: 5 },
  { q: -1, r: 2, number: 6 }, { q: 0, r: 2, number: 2 },
];

export const COASTAL_TERRAIN: readonly Terrain[] = ['hills', 'hills', 'forest', 'forest', 'pasture', 'pasture', 'pasture', 'fields', 'fields', 'mountains'];
export const INNER_TERRAIN: readonly Terrain[] = ['hills', 'forest', 'pasture', 'fields', 'fields', 'mountains', 'mountains'];

/**
 * Coastal hexes in the order victories are checked: from the 4 next to the
 * castle, clockwise around the island (p. 18). Castle and desert excluded.
 */
export const COASTAL_ORDER: readonly HexCoord[] = [
  { q: -2, r: 1 }, { q: -2, r: 0 }, { q: -1, r: -1 }, { q: 0, r: -2 }, { q: 1, r: -2 },
  { q: 2, r: -1 }, { q: 2, r: 0 }, { q: 1, r: 1 }, { q: 0, r: 2 }, { q: -1, r: 2 },
];

export function coastalHexes(topology: BoardTopology): number[] {
  return COASTAL_ORDER.map((coord) => hexIndex(topology, coord));
}

export function barbariansLayout({ topology, rng }: LayoutContext): BoardLayout {
  const castle = hexIndex(topology, CASTLE);
  const desert = hexIndex(topology, DESERT);
  const coastal = shuffle(COASTAL_TERRAIN, rng);
  const inner = shuffle(INNER_TERRAIN, rng);
  let c = 0;
  let i = 0;
  const terrain: Terrain[] = topology.hexes.map((hex, index) => {
    if (index === castle) return 'castle';
    if (index === desert) return 'desert';
    return ring(hex) === 2 ? coastal[c++]! : inner[i++]!;
  });
  const numbers: (number | null)[] = topology.hexes.map(() => null);
  for (const printed of PRINTED_NUMBERS) numbers[hexIndex(topology, printed)] = printed.number;
  return {
    topologyId: topology.id,
    terrain,
    numbers,
    harbors: shuffledHarbors(topology, rng),
    islands: topology.hexes.map(() => 0),
    // There is no robber in this scenario.
    robber: -1,
    pirate: null,
  };
}
