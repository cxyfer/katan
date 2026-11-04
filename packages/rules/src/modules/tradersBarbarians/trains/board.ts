/**
 * Merchant Trains board (TB25 p. 13): the watering hole replaces the desert
 * in the centre; the other 18 hexes and the discs are placed as in the B25
 * variable setup.
 */

import { BASE_NUMBER_TOKENS, BASE_TERRAIN_MULTISET } from '../../../layout.ts';
import type { LayoutContext } from '../../../layout-registry.ts';
import { shuffle } from '../../../rng.ts';
import type { BoardTopology } from '../../../topology.ts';
import type { BoardLayout, Terrain } from '../../../types.ts';
import { hexIndex, shuffledHarbors, spiralNumbers } from '../boardHelpers.ts';

export const TRAINS_LAYOUT_ID = 'tb-merchant-trains';

/**
 * The three train starts, read from the start diagram (p. 14): the watering
 * hole's upper-left, upper-right and bottom corners (indices into the corner
 * order 30°, 90°, 150°, 210°, 270°, 330°).
 */
export const START_CORNERS: readonly number[] = [3, 5, 1];

export interface TrainStart {
  vertex: number;
  /** The edge leaving that corner away from the watering hole. */
  edge: number;
}

export function trainStarts(topology: BoardTopology, oasis: number): TrainStart[] {
  const hex = topology.hexes[oasis]!;
  return START_CORNERS.map((corner) => {
    const angle = [30, 90, 150, 210, 270, 330][corner]! * Math.PI / 180;
    const x = hex.x + Math.cos(angle);
    const y = hex.y + Math.sin(angle);
    const vertex = topology.vertices.findIndex((info) => Math.abs(info.x - x) < 1e-4 && Math.abs(info.y - y) < 1e-4);
    const edge = topology.vertices[vertex]!.edges.find((candidate) => !topology.edges[candidate]!.hexes.includes(oasis))!;
    return { vertex, edge };
  });
}

export function trainsLayout({ topology, rng }: LayoutContext): BoardLayout {
  const centre = hexIndex(topology, { q: 0, r: 0 });
  const lands = shuffle(BASE_TERRAIN_MULTISET.filter((terrain) => terrain !== 'desert'), rng);
  let next = 0;
  const terrain: Terrain[] = topology.hexes.map((_, hex) => (hex === centre ? 'oasis' : lands[next++]!));
  return {
    topologyId: topology.id,
    terrain,
    numbers: spiralNumbers(topology, BASE_NUMBER_TOKENS, (hex) => hex === centre, rng),
    harbors: shuffledHarbors(topology, rng),
    islands: topology.hexes.map(() => 0),
    robber: -1,
    pirate: null,
  };
}
