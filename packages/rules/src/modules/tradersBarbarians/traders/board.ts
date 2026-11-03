/**
 * Traders & Barbarians board (TB25 pp. 20–21): three commodity hexes on
 * alternate corners with interior paths to a centre plaza, X markers on their
 * coastal sides, three barbarians on edges, numbers without 2 and 12.
 */

import { BASE_NUMBER_TOKENS, BASE_TERRAIN_MULTISET } from '../../../layout.ts';
import type { LayoutContext } from '../../../layout-registry.ts';
import { shuffle } from '../../../rng.ts';
import type { BoardTopology, HexCoord, TopologyDefinition } from '../../../topology.ts';
import type { BoardLayout, Terrain } from '../../../types.ts';
import { hexIndex, sharedEdge, shuffledHarbors, sideEdge, spiralNumbers } from '../boardHelpers.ts';
import { TB_FRAME_TOPOLOGY } from '../frame.ts';

export const TRADERS_LAYOUT_ID = 'tb-traders-barbarians';
export const TRADERS_TOPOLOGY_ID = 'tb-traders-r2';

export type SiteId = 'quarry' | 'glassworks' | 'castle';
export type Commodity = 'marble' | 'sand' | 'glass' | 'tools';

export interface SiteSpec {
  id: SiteId;
  terrain: Terrain;
  coord: HexCoord;
  /** The three path-less sides against the frame (each with an X marker). */
  coastalSides: readonly number[];
  /** Corners with an interior path (index into 30°, 90°, …, 330°). */
  pathCorners: readonly number[];
  /** Commodities this site needs, and its face-down stack (p. 3). */
  needs: readonly Commodity[];
  stack: Readonly<Record<string, number>>;
}

/**
 * Sites as placed on the printed map. A side `s` joins corners (5 - s) and
 * (6 - s) mod 6; paths go to every corner except the two in the middle of the
 * coastal run (p. 21 path diagram).
 */
export const SITES: readonly SiteSpec[] = [
  { id: 'quarry', terrain: 'quarry', coord: { q: 2, r: -2 }, coastalSides: [0, 1, 2], pathCorners: [0, 1, 2, 3], needs: ['tools'], stack: { marble: 6, sand: 6 } },
  { id: 'castle', terrain: 'keep', coord: { q: -2, r: 0 }, coastalSides: [2, 3, 4], pathCorners: [0, 1, 4, 5], needs: ['marble', 'glass'], stack: { sand: 6, tools: 6 } },
  { id: 'glassworks', terrain: 'glassworks', coord: { q: 0, r: 2 }, coastalSides: [4, 5, 0], pathCorners: [2, 3, 4, 5], needs: ['sand'], stack: { glass: 6, tools: 6 } },
];

/** The three barbarians' starting edges, read from the setup map. */
export const BARBARIAN_EDGES: readonly [HexCoord, HexCoord][] = [
  [{ q: 1, r: -2 }, { q: 1, r: -1 }],
  [{ q: -1, r: 0 }, { q: -2, r: 1 }],
  [{ q: 0, r: 1 }, { q: 1, r: 1 }],
];

export const TRADERS_TOPOLOGY: TopologyDefinition = {
  id: TRADERS_TOPOLOGY_ID,
  hexes: TB_FRAME_TOPOLOGY.hexes,
  harborSlots: TB_FRAME_TOPOLOGY.harborSlots,
  interiorPaths: SITES.map((site) => ({ ...site.coord, corners: site.pathCorners })),
};

export interface SiteGeometry {
  id: SiteId;
  hex: number;
  plaza: number;
}

export function siteGeometry(topology: BoardTopology): SiteGeometry[] {
  return SITES.map((site) => {
    const hex = hexIndex(topology, site.coord);
    const plaza = topology.vertices.findIndex((info) => info.interior && info.hexes[0] === hex);
    return { id: site.id, hex, plaza };
  });
}

export function xEdges(topology: BoardTopology): number[] {
  return SITES.flatMap((site) => site.coastalSides.map((side) => sideEdge(topology, site.coord, side)));
}

export function barbarianEdges(topology: BoardTopology): number[] {
  return BARBARIAN_EDGES.map(([a, b]) => sharedEdge(topology, a, b));
}

/** B25 hexes without 1 pasture, 1 field and the desert. */
export const TRADERS_RANDOM_TERRAIN: readonly Terrain[] = (() => {
  const pool = BASE_TERRAIN_MULTISET.filter((terrain) => terrain !== 'desert');
  pool.splice(pool.indexOf('pasture'), 1);
  pool.splice(pool.indexOf('fields'), 1);
  return pool;
})();

export function tradersLayout({ rng, topology: fallback }: LayoutContext): BoardLayout {
  const topology = fallback;
  const sites = new Map(SITES.map((site) => [hexIndex(topology, site.coord), site.terrain]));
  const random = shuffle(TRADERS_RANDOM_TERRAIN, rng);
  let next = 0;
  const terrain: Terrain[] = topology.hexes.map((_, hex) => sites.get(hex) ?? random[next++]!);
  const tokens = BASE_NUMBER_TOKENS.filter((value) => value !== 2 && value !== 12);
  return {
    topologyId: topology.id,
    terrain,
    numbers: spiralNumbers(topology, tokens, (hex) => sites.has(hex), rng),
    harbors: shuffledHarbors(topology, rng),
    islands: topology.hexes.map(() => 0),
    robber: -1,
    pirate: null,
  };
}
