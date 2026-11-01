/**
 * Synthetic sample boards for the platform's own tests and the renderer
 * preview (`?preview=archipelago`). They are not a scenario of any rulebook
 * and no profile uses them; they only exercise what scenario maps need: a sea
 * frame, several separate islands, gold, and explicitly marked harbours.
 */

import type { BoardTopology, HexCoord, TopologyDefinition } from './topology.ts';
import type { BoardLayout, HarborType, Terrain } from './types.ts';

interface SampleHex extends HexCoord {
  terrain: Terrain;
  number?: number;
  island: number;
}

/** Land hexes; every other hex within distance 4 of the origin is sea. */
const ARCHIPELAGO_LAND: readonly SampleHex[] = [
  // Main island (1): a centre hex and its six neighbours.
  { q: -1, r: 0, terrain: 'mountains', number: 8, island: 1 },
  { q: 0, r: 0, terrain: 'fields', number: 5, island: 1 },
  { q: 0, r: -1, terrain: 'forest', number: 10, island: 1 },
  { q: -1, r: -1, terrain: 'hills', number: 4, island: 1 },
  { q: -2, r: 0, terrain: 'pasture', number: 9, island: 1 },
  { q: -2, r: 1, terrain: 'forest', number: 6, island: 1 },
  { q: -1, r: 1, terrain: 'desert', island: 1 },
  // North-east islet (2) with a gold field.
  { q: 2, r: -3, terrain: 'gold', number: 3, island: 2 },
  { q: 3, r: -3, terrain: 'pasture', number: 11, island: 2 },
  { q: 2, r: -2, terrain: 'hills', number: 6, island: 2 },
  // South-east islet (3).
  { q: 2, r: 1, terrain: 'fields', number: 9, island: 3 },
  { q: 2, r: 2, terrain: 'mountains', number: 4, island: 3 },
  // A lone gold rock (4) in the south-west.
  { q: -3, r: 3, terrain: 'gold', number: 12, island: 4 },
];

const ARCHIPELAGO_HARBORS: readonly { q: number; r: number; side: number; type: HarborType }[] = [
  { q: 0, r: 0, side: 0, type: 'generic' },
  { q: -2, r: 0, side: 3, type: 'wool' },
  { q: 0, r: -1, side: 2, type: 'lumber' },
  { q: 2, r: -2, side: 5, type: 'brick' },
  { q: 2, r: 1, side: 3, type: 'generic' },
];

const FRAME_RADIUS = 4;

function frameHexes(): HexCoord[] {
  const out: HexCoord[] = [];
  for (let r = -FRAME_RADIUS; r <= FRAME_RADIUS; r++) {
    for (let q = -FRAME_RADIUS; q <= FRAME_RADIUS; q++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= FRAME_RADIUS) out.push({ q, r });
    }
  }
  return out;
}

export const ARCHIPELAGO_TOPOLOGY: TopologyDefinition = {
  id: 'sample-archipelago',
  hexes: frameHexes(),
  harborSlots: ARCHIPELAGO_HARBORS.map(({ q, r, side }) => ({ q, r, side })),
};

/** The sample archipelago's layout, keyed to the topology's hex indices. */
export function archipelagoLayout(topology: BoardTopology): BoardLayout {
  if (topology.id !== ARCHIPELAGO_TOPOLOGY.id) throw new Error(`not the sample archipelago: ${topology.id}`);
  const land = new Map(ARCHIPELAGO_LAND.map((hex) => [`${hex.q},${hex.r}`, hex]));
  const terrain: Terrain[] = [];
  const numbers: (number | null)[] = [];
  const islands: number[] = [];
  for (const hex of topology.hexes) {
    const sample = land.get(`${hex.q},${hex.r}`);
    terrain.push(sample?.terrain ?? 'sea');
    numbers.push(sample?.number ?? null);
    islands.push(sample?.island ?? 0);
  }
  const pirate = topology.hexes.findIndex((hex) => hex.q === 1 && hex.r === -1);
  return {
    topologyId: topology.id,
    terrain,
    numbers,
    harbors: topology.harborSlots.map((edge, index) => ({ edge, type: ARCHIPELAGO_HARBORS[index]!.type })),
    islands,
    robber: terrain.indexOf('desert'),
    pirate,
  };
}
