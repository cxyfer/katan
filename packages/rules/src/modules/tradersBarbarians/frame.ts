/**
 * The base-board frame as printed on every TB25 scenario map (pp. 9, 11, 13,
 * 15, 21): the 19 hexes of `hex-r2` with the nine harbours where the map
 * draws their piers. Hex corners and edges keep `hex-r2`'s indices; only the
 * harbour slots differ from the base board's approximated positions (FIDELITY
 * gap 1), which would collide with the Fishing grounds.
 */

import type { HexCoord, TopologyDefinition } from '../../topology.ts';

function radiusTwo(): HexCoord[] {
  const out: HexCoord[] = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = -2; q <= 2; q++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2) out.push({ q, r });
  }
  return out;
}

/** Harbour sides read from the printed frame, clockwise from the top left. */
export const TB_FRAME_HARBORS = [
  { q: 0, r: -2, side: 2 },
  { q: 1, r: -2, side: 1 },
  { q: 2, r: -1, side: 1 },
  { q: 2, r: 0, side: 0 },
  { q: 1, r: 1, side: 5 },
  { q: -1, r: 2, side: 5 },
  { q: -2, r: 2, side: 4 },
  { q: -2, r: 1, side: 3 },
  { q: -1, r: -1, side: 3 },
] as const;

export const TB_FRAME_TOPOLOGY: TopologyDefinition = {
  id: 'tb-r2',
  hexes: radiusTwo(),
  harborSlots: TB_FRAME_HARBORS,
};
