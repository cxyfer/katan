/** Board helpers shared by the T&B scenario layouts (TB25 maps). */

import { BASE_HARBOR_TOKENS, spiralOrder } from '../../layout.ts';
import { shuffle, type Rng } from '../../rng.ts';
import type { BoardTopology, HexCoord } from '../../topology.ts';
import type { Harbor } from '../../types.ts';

export function hexIndex(topology: BoardTopology, coord: HexCoord): number {
  const index = topology.hexes.findIndex((hex) => hex.q === coord.q && hex.r === coord.r);
  if (index < 0) throw new Error(`no hex ${coord.q},${coord.r} on ${topology.id}`);
  return index;
}

export function ring(coord: HexCoord): number {
  return Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(coord.q + coord.r));
}

/** Hex indices of the centre and its first ring (the "inner area"). */
export function innerHexes(topology: BoardTopology): number[] {
  return topology.hexes.map((hex, index) => ({ hex, index })).filter(({ hex }) => ring(hex) <= 1).map(({ index }) => index);
}

/** The edge shared by two adjacent hexes. */
export function sharedEdge(topology: BoardTopology, a: HexCoord, b: HexCoord): number {
  const ia = hexIndex(topology, a);
  const ib = hexIndex(topology, b);
  const edge = topology.edges.findIndex((info) => info.hexes.includes(ia) && info.hexes.includes(ib));
  if (edge < 0) throw new Error(`hexes ${a.q},${a.r} and ${b.q},${b.r} share no edge`);
  return edge;
}

/** The edge on one side (`NEIGHBOR_DIRS` index) of a hex. */
export function sideEdge(topology: BoardTopology, coord: HexCoord, side: number): number {
  const hex = topology.hexes[hexIndex(topology, coord)]!;
  const angle = (-60 * side) * (Math.PI / 180);
  // The side's midpoint lies √3/2 from the centre towards the neighbour.
  const x = hex.x + Math.cos(angle) * Math.sqrt(3) / 2;
  const y = hex.y + Math.sin(angle) * Math.sqrt(3) / 2;
  const index = hexIndex(topology, coord);
  const edge = topology.edges.findIndex((info) =>
    info.hexes.includes(index) && !info.interior && Math.abs(info.x - x) < 1e-3 && Math.abs(info.y - y) < 1e-3);
  if (edge < 0) throw new Error(`no side ${side} on ${coord.q},${coord.r}`);
  return edge;
}

/**
 * B25 variable number placement: shuffled discs laid along the spiral from a
 * corner, skipping hexes that take no disc.
 */
export function spiralNumbers(topology: BoardTopology, tokens: readonly number[], skip: (hex: number) => boolean, rng: Rng): (number | null)[] {
  const numbers: (number | null)[] = topology.hexes.map(() => null);
  const shuffled = shuffle(tokens, rng);
  let cursor = 0;
  for (const hex of spiralOrder(topology)) {
    if (skip(hex)) continue;
    numbers[hex] = shuffled[cursor++] ?? null;
  }
  return numbers;
}

/** B25 variable harbours: the nine tokens shuffled over the marked slots. */
export function shuffledHarbors(topology: BoardTopology, rng: Rng): Harbor[] {
  const tokens = shuffle(BASE_HARBOR_TOKENS, rng);
  return topology.harborSlots.map((edge, index) => ({ edge, type: tokens[index]! }));
}
