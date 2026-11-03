/**
 * Rivers of Catan board (TB25 p. 11): two river tiles at fixed positions, the
 * other twelve hexes random, the 2 disc sharing the 12 hex, the robber on a
 * swamp.
 */

import { BASE_NUMBER_TOKENS } from '../../../layout.ts';
import type { LayoutContext } from '../../../layout-registry.ts';
import { shuffle } from '../../../rng.ts';
import { edgesOfHex, verticesOfHex, type BoardTopology, type HexCoord } from '../../../topology.ts';
import type { BoardLayout, Terrain } from '../../../types.ts';
import { hexIndex, sharedEdge, shuffledHarbors, sideEdge, spiralNumbers } from '../boardHelpers.ts';

export const RIVERS_LAYOUT_ID = 'tb-rivers';

/** The river tiles as printed on the setup map, source first. */
export const RIVERS: readonly { hexes: readonly (HexCoord & { terrain: Terrain })[]; mouthSide: number }[] = [
  {
    // Four-hex river: mountains, hills, pasture, swamp; it meets the coast on the swamp's lower-left side.
    hexes: [
      { q: -1, r: -1, terrain: 'mountains' },
      { q: -1, r: 0, terrain: 'hills' },
      { q: -1, r: 1, terrain: 'pasture' },
      { q: -1, r: 2, terrain: 'swamp' },
    ],
    mouthSide: 4,
  },
  {
    // Three-hex river: mountains, hills, swamp; its mouth is the swamp's right side.
    hexes: [
      { q: 1, r: -1, terrain: 'mountains' },
      { q: 1, r: 0, terrain: 'hills' },
      { q: 1, r: 1, terrain: 'swamp' },
    ],
    mouthSide: 0,
  },
];

/** B25 hexes minus 2 hills, 2 pastures, 2 mountains and the desert, minus the river hexes' terrains. */
export const RIVERS_RANDOM_TERRAIN: readonly Terrain[] = [
  ...Array<Terrain>(4).fill('forest'),
  ...Array<Terrain>(2).fill('pasture'),
  ...Array<Terrain>(4).fill('fields'),
  'hills',
  'mountains',
];

export interface RiverGeometry {
  /** River hex indices (both rivers). */
  hexes: number[];
  /** Bridge sites: where a river crosses or meets an edge. */
  bridgeSites: number[];
  /** Every edge and intersection of a river tile (gold for building there). */
  edges: number[];
  vertices: number[];
  /** Each river's path for drawing: hex indices and its bridge sites in order. */
  paths: { hexes: number[]; sites: number[] }[];
}

export function riverGeometry(topology: BoardTopology): RiverGeometry {
  const paths = RIVERS.map((river) => {
    const sites: number[] = [];
    for (let index = 1; index < river.hexes.length; index++) sites.push(sharedEdge(topology, river.hexes[index - 1]!, river.hexes[index]!));
    sites.push(sideEdge(topology, river.hexes.at(-1)!, river.mouthSide));
    return { hexes: river.hexes.map((hex) => hexIndex(topology, hex)), sites };
  });
  const hexes = paths.flatMap((path) => path.hexes);
  const edges = new Set<number>();
  const vertices = new Set<number>();
  for (const hex of hexes) {
    for (const edge of edgesOfHex(topology, hex)) edges.add(edge);
    for (const vertex of verticesOfHex(topology, hex)) vertices.add(vertex);
  }
  return {
    hexes,
    bridgeSites: paths.flatMap((path) => path.sites),
    edges: [...edges].sort((a, b) => a - b),
    vertices: [...vertices].sort((a, b) => a - b),
    paths,
  };
}

export function riversLayout({ topology, rng }: LayoutContext): BoardLayout {
  const fixed = new Map<number, Terrain>();
  for (const river of RIVERS) for (const hex of river.hexes) fixed.set(hexIndex(topology, hex), hex.terrain);
  const random = shuffle(RIVERS_RANDOM_TERRAIN, rng);
  let next = 0;
  const terrain: Terrain[] = topology.hexes.map((_, hex) => fixed.get(hex) ?? random[next++]!);
  // The 2 disc is set aside, then shares the hex of the 12 (p. 11).
  const tokens = BASE_NUMBER_TOKENS.filter((value, index) => !(value === 2 && BASE_NUMBER_TOKENS.indexOf(2) === index));
  const numbers = spiralNumbers(topology, tokens, (hex) => terrain[hex] === 'swamp', rng);
  const twelve = numbers.indexOf(12);
  const swamps = terrain.map((kind, hex) => (kind === 'swamp' ? hex : -1)).filter((hex) => hex >= 0);
  return {
    topologyId: topology.id,
    terrain,
    numbers,
    harbors: shuffledHarbors(topology, rng),
    islands: topology.hexes.map(() => 0),
    // "Either of the 2 swamps": the setup draw picks one.
    robber: swamps[rng.int(swamps.length)]!,
    pirate: null,
    extraNumbers: [{ hex: twelve, number: 2 }],
  };
}
