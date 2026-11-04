/**
 * Fishing on Catan board (TB25 p. 9): B25 variable setup with the lake in
 * place of the desert, the lake plus six random hexes in the inner seven
 * positions, and six fishing grounds on the frame.
 */

import { BASE_NUMBER_TOKENS, BASE_TERRAIN_MULTISET } from '../../../layout.ts';
import type { LayoutContext } from '../../../layout-registry.ts';
import { shuffle } from '../../../rng.ts';
import type { BoardTopology, HexCoord } from '../../../topology.ts';
import type { BoardLayout, Terrain } from '../../../types.ts';
import { hexIndex, innerHexes, shuffledHarbors, spiralNumbers } from '../boardHelpers.ts';

export const FISHING_LAYOUT_ID = 'tb-fishing';

/** The lake hex's four printed numbers. */
export const LAKE_NUMBERS: readonly number[] = [2, 3, 11, 12];
/** The six fishing ground tiles' numbers. */
export const GROUND_NUMBERS: readonly number[] = [4, 5, 6, 8, 9, 10];

/**
 * The six marked frame positions, read from the printed setup map: each sits
 * in the coastal valley between two outer hexes (listed clockwise from the
 * top) and covers the two coastal edges meeting there.
 */
export const GROUND_VALLEYS: readonly [HexCoord, HexCoord][] = [
  [{ q: 0, r: -2 }, { q: 1, r: -2 }],
  [{ q: 2, r: -1 }, { q: 2, r: 0 }],
  [{ q: 2, r: 0 }, { q: 1, r: 1 }],
  [{ q: -1, r: 2 }, { q: -2, r: 2 }],
  [{ q: -2, r: 2 }, { q: -2, r: 1 }],
  [{ q: -1, r: -1 }, { q: 0, r: -2 }],
];

export interface GroundGeometry {
  /** The valley intersection the ground points at. */
  valley: number;
  /** The two coastal edges it covers. */
  edges: [number, number];
  /** The three intersections it touches (valley first). */
  vertices: [number, number, number];
}

/** Locates each fishing ground on the topology. */
export function groundGeometry(topology: BoardTopology): GroundGeometry[] {
  return GROUND_VALLEYS.map(([a, b]) => {
    const ia = hexIndex(topology, a);
    const ib = hexIndex(topology, b);
    const valley = topology.vertices.findIndex((info) =>
      !info.interior && info.hexes.length === 2 && info.hexes.includes(ia) && info.hexes.includes(ib));
    if (valley < 0) throw new Error(`no coastal valley between ${a.q},${a.r} and ${b.q},${b.r}`);
    const coastal = topology.vertices[valley]!.edges.filter((edge) => topology.edges[edge]!.hexes.length === 1 && !topology.edges[edge]!.interior);
    if (coastal.length !== 2) throw new Error('a coastal valley has two coastal edges');
    const others = coastal.map((edge) => {
      const [x, y] = topology.edges[edge]!.vertices;
      return x === valley ? y : x;
    });
    return { valley, edges: [coastal[0]!, coastal[1]!], vertices: [valley, others[0]!, others[1]!] };
  });
}

export function fishingLayout({ topology, rng }: LayoutContext): BoardLayout {
  const lands = shuffle(BASE_TERRAIN_MULTISET.filter((terrain) => terrain !== 'desert'), rng);
  const inner = innerHexes(topology);
  const lake = inner[rng.int(inner.length)]!;
  let next = 0;
  const terrain: Terrain[] = topology.hexes.map((_, hex) => (hex === lake ? 'lake' : lands[next++]!));
  return {
    topologyId: topology.id,
    terrain,
    numbers: spiralNumbers(topology, BASE_NUMBER_TOKENS, (hex) => hex === lake, rng),
    harbors: shuffledHarbors(topology, rng),
    islands: topology.hexes.map(() => 0),
    // The robber waits beside the board until a 7 or a Knight.
    robber: -1,
    pirate: null,
  };
}
