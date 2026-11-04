/**
 * Explorers & Pirates boards (CATAN – Explorers & Pirates, CN3085, 2025).
 *
 * Transcribed from the printed maps and hex tables:
 *   - Land Ho!: EP25-M (Mission Guide) p. 4;
 *   - Pirate Lairs: EP25-M p. 8;
 *   - Fish for Catan: EP25-M p. 14 (same grid as Pirate Lairs);
 *   - Spices for Catan: EP25-M p. 16;
 *   - Explorers & Pirates (all missions): EP25 (rulebook) pp. 6–7.
 * Source hashes and the transcription method are recorded in
 * docs/aegis/work/2026-11-02-explorers-pirates.md and docs/FIDELITY.md.
 *
 * Coordinates are axial (pointy-top, `r` grows downwards, see `topology.ts`);
 * `(0, 0)` is the hex east of the `8` at the east tip of the starting island.
 * Each topology lists the starting island, the faceup sea hexes, the Council
 * of Catan and both unexplored regions. The hex-shaped bump at the east end of
 * the middle row belongs to the frame and is not a cell.
 *
 * The layout holds no hidden information: an unexplored hex is stored as
 * `sea` with no number, and the tile under it is drawn from the region's
 * remaining tiles only when a ship explores it (see
 * `modules/explorersPirates/explore.ts`). That is distributionally the same as
 * a shuffled face-down region and leaves nothing to leak before the reveal.
 */

import type { LayoutContext } from './layout-registry.ts';
import { shuffle } from './rng.ts';
import { hexCenter, NEIGHBOR_DIRS, type BoardTopology, type HexCoord, type TopologyDefinition } from './topology.ts';
import type { BoardLayout, PlayerColor, Terrain } from './types.ts';

export type EpScenarioId = 'land-ho' | 'pirate-lairs' | 'fish' | 'spices' | 'explorers-pirates';
export type EpRegion = 'parrot' | 'goose';
/** Tiles of an unexplored region: CATAN terrain or an E&P special hex. */
export type EpTile = 'sea' | 'hills' | 'forest' | 'pasture' | 'fields' | 'mountains' | 'gold' | 'shoal' | 'spice';
export type EpMission = 'lairs' | 'fish' | 'spices';

interface StartHex extends HexCoord {
  number: number;
}

/** Starting-island cells and their fixed discs (every map). */
const START_ISLAND: readonly StartHex[] = [
  { q: 0, r: -3, number: 11 }, { q: 1, r: -3, number: 9 },
  { q: -1, r: -2, number: 3 }, { q: 0, r: -2, number: 8 },
  { q: -2, r: -1, number: 4 }, { q: -1, r: -1, number: 10 },
  { q: -3, r: 0, number: 6 }, { q: -2, r: 0, number: 12 }, { q: -1, r: 0, number: 8 },
  { q: -3, r: 1, number: 10 }, { q: -2, r: 1, number: 4 },
  { q: -3, r: 2, number: 11 }, { q: -2, r: 2, number: 6 },
  { q: -3, r: 3, number: 3 }, { q: -2, r: 3, number: 5 },
];

/** The pasture printed on a sea frame piece (EP25 p. 5): fixed in every map. */
const FRAME_PASTURE: HexCoord = { q: -3, r: 0 };

/** The 14 CATAN terrain hexes kept for E&P (EP25-M p. 2). */
const CATAN_TERRAIN: readonly Terrain[] = [
  'hills', 'hills',
  'forest', 'forest', 'forest', 'forest',
  'pasture', 'pasture', 'pasture',
  'fields', 'fields',
  'mountains', 'mountains', 'mountains',
];

type Grid = Record<number, readonly number[]>;

function gridCells(grid: Grid): HexCoord[] {
  return Object.entries(grid).flatMap(([r, qs]) => qs.map((q) => ({ q, r: Number(r) })));
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// ---------------------------------------------------------------------------
// maps
// ---------------------------------------------------------------------------

interface MapSpec {
  topologyId: string;
  seas: Grid;
  parrot: Grid;
  goose: Grid;
  council: HexCoord | null;
}

/** Land Ho! — EP25-M p. 4: 19 seas, 8 + 8 unexplored. */
const LAND_HO_MAP: MapSpec = {
  topologyId: 'ep-land-ho',
  seas: { [-3]: [2, 3], [-2]: [1, 2], [-1]: [0, 1, 3], 0: range(0, 4), 1: [-1, 0, 2], 2: [-1, 0], 3: [-1, 0] },
  parrot: { [-3]: [4, 5], [-2]: [3, 4, 5], [-1]: [2, 4, 5] },
  goose: { 1: [1, 3, 4], 2: [1, 2, 3], 3: [1, 2] },
  council: null,
};

/** Pirate Lairs — EP25-M p. 8: 20 seas, 11 + 11 unexplored. */
const LAIRS_MAP: MapSpec = {
  topologyId: 'ep-pirate-lairs',
  seas: { [-3]: [2, 3], [-2]: [1, 2], [-1]: [0, 1, 4], 0: range(0, 5), 1: [-1, 0, 3], 2: [-1, 0], 3: [-1, 0] },
  parrot: { [-3]: [4, 5, 6], [-2]: [3, 4, 5, 6], [-1]: [2, 3, 5, 6] },
  goose: { 1: [1, 2, 4, 5], 2: [1, 2, 3, 4], 3: [1, 2, 3] },
  council: null,
};

/**
 * Fish for Catan — EP25-M p. 14: the Pirate Lairs grid with 19 seas. The map
 * omits the Council although the mission delivers to it and the table has one
 * sea fewer; it goes on `(0, 0)` as in the Spices and full-game maps (open
 * fixture, FIDELITY).
 */
const FISH_MAP: MapSpec = {
  topologyId: 'ep-pirate-lairs',
  seas: { [-3]: [2, 3], [-2]: [1, 2], [-1]: [0, 1, 4], 0: range(1, 5), 1: [-1, 0, 3], 2: [-1, 0], 3: [-1, 0] },
  parrot: LAIRS_MAP.parrot,
  goose: LAIRS_MAP.goose,
  council: { q: 0, r: 0 },
};

/** Spices for Catan — EP25-M p. 16: 22 seas, 13 + 13 unexplored. */
const SPICES_MAP: MapSpec = {
  topologyId: 'ep-spices',
  seas: { [-3]: [2, 3], [-2]: [1, 2], [-1]: [0, 1, 4, 6], 0: range(1, 6), 1: [-1, 0, 3, 5], 2: [-1, 0], 3: [-1, 0] },
  parrot: { [-3]: range(4, 7), [-2]: range(3, 7), [-1]: [2, 3, 5, 7] },
  goose: { 1: [1, 2, 4, 6], 2: range(1, 5), 3: range(1, 4) },
  council: { q: 0, r: 0 },
};

/** Explorers & Pirates — EP25 pp. 6–7: 23 seas, 16 + 16 unexplored. */
const FULL_MAP: MapSpec = {
  topologyId: 'ep-full',
  seas: { [-3]: [2, 3], [-2]: [1, 2], [-1]: [0, 1, 4, 6], 0: range(1, 7), 1: [-1, 0, 3, 5], 2: [-1, 0], 3: [-1, 0] },
  parrot: { [-3]: range(4, 8), [-2]: range(3, 8), [-1]: [2, 3, 5, 7, 8] },
  goose: { 1: [1, 2, 4, 6, 7], 2: range(1, 6), 3: range(1, 5) },
  council: { q: 0, r: 0 },
};

function mapCells(spec: MapSpec): HexCoord[] {
  return [
    ...START_ISLAND.map(({ q, r }) => ({ q, r })),
    ...gridCells(spec.seas),
    ...(spec.council ? [spec.council] : []),
    ...gridCells(spec.parrot),
    ...gridCells(spec.goose),
  ];
}

export const EXPLORERS_PIRATES_TOPOLOGIES: readonly TopologyDefinition[] = [
  { id: LAND_HO_MAP.topologyId, hexes: mapCells(LAND_HO_MAP) },
  { id: LAIRS_MAP.topologyId, hexes: mapCells(LAIRS_MAP) },
  { id: SPICES_MAP.topologyId, hexes: mapCells(SPICES_MAP) },
  { id: FULL_MAP.topologyId, hexes: mapCells(FULL_MAP) },
];

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

const count = (entries: [EpTile, number][]): Partial<Record<EpTile, number>> => Object.fromEntries(entries);

export interface EpRegionSpec {
  /** Tiles in the region's face-down pool. */
  tiles: Partial<Record<EpTile, number>>;
  /** Number discs for its standard land hexes. */
  discs: readonly number[];
  /** Fish shoal numbers the region's shoals are drawn from. */
  shoals: readonly number[];
  /** Pirate Bonus number of the region's spice farm (EP25 p. 3). */
  pirateBonus: number;
}

export interface EpScenario {
  id: EpScenarioId;
  map: MapSpec;
  /** Starting-island terrain; `null` deals the 14 CATAN hexes at random. */
  startTerrain: Readonly<Record<string, Terrain>> | null;
  /** Fixed starting pieces (Land Ho!) instead of the variable setup. */
  fixedStart: boolean;
  regions: Record<EpRegion, EpRegionSpec>;
  /** Crews, pirate ships, tribute, chase (Pirate Lairs onwards). */
  pirates: boolean;
  missions: readonly EpMission[];
  victoryTarget: number;
}

const PARROT_DISCS = [3, 4, 5, 6, 9, 10] as const;
const GOOSE_DISCS = [4, 5, 8, 9, 10, 11] as const;

const LAND_HO_PARROT = count([['sea', 2], ['hills', 1], ['forest', 1], ['pasture', 1], ['fields', 1], ['mountains', 2]]);
const LAND_HO_GOOSE = count([['sea', 2], ['hills', 1], ['forest', 1], ['pasture', 1], ['fields', 2], ['mountains', 1]]);

const region = (tiles: Partial<Record<EpTile, number>>, discs: readonly number[], shoals: readonly number[], pirateBonus: number): EpRegionSpec =>
  ({ tiles, discs, shoals, pirateBonus });

const T = (entries: Record<string, Terrain>) => entries;

export const EP_SCENARIOS: Readonly<Record<EpScenarioId, EpScenario>> = {
  'land-ho': {
    id: 'land-ho',
    map: LAND_HO_MAP,
    startTerrain: T({
      '0,-3': 'mountains', '1,-3': 'forest', '-1,-2': 'fields', '0,-2': 'pasture', '-2,-1': 'hills',
      '-1,-1': 'pasture', '-3,0': 'pasture', '-2,0': 'mountains', '-1,0': 'forest', '-3,1': 'fields',
      '-2,1': 'pasture', '-3,2': 'forest', '-2,2': 'hills', '-3,3': 'mountains', '-2,3': 'forest',
    }),
    fixedStart: true,
    regions: {
      parrot: region(LAND_HO_PARROT, PARROT_DISCS, [], 5),
      goose: region(LAND_HO_GOOSE, GOOSE_DISCS, [], 4),
    },
    pirates: false,
    missions: [],
    victoryTarget: 8,
  },
  'pirate-lairs': {
    id: 'pirate-lairs',
    map: LAIRS_MAP,
    startTerrain: T({
      '0,-3': 'pasture', '1,-3': 'forest', '-1,-2': 'fields', '0,-2': 'pasture', '-2,-1': 'hills',
      '-1,-1': 'mountains', '-3,0': 'pasture', '-2,0': 'mountains', '-1,0': 'forest', '-3,1': 'fields',
      '-2,1': 'pasture', '-3,2': 'forest', '-2,2': 'mountains', '-3,3': 'hills', '-2,3': 'forest',
    }),
    fixedStart: false,
    regions: {
      parrot: region({ ...LAND_HO_PARROT, gold: 3 }, PARROT_DISCS, [], 5),
      goose: region({ ...LAND_HO_GOOSE, gold: 3 }, GOOSE_DISCS, [], 4),
    },
    pirates: true,
    missions: ['lairs'],
    victoryTarget: 12,
  },
  fish: {
    id: 'fish',
    map: FISH_MAP,
    startTerrain: null,
    fixedStart: false,
    regions: {
      // "Select 2 fish shoals randomly from the 3 parrot fish shoals" (p. 14):
      // the shoal numbers are drawn from 1–3 when a shoal is explored.
      parrot: region(count([['hills', 1], ['forest', 1], ['pasture', 1], ['fields', 1], ['mountains', 2], ['gold', 3], ['shoal', 2]]), PARROT_DISCS, [1, 2, 3], 5),
      goose: region(count([['hills', 1], ['forest', 1], ['pasture', 1], ['fields', 2], ['mountains', 1], ['gold', 2], ['shoal', 3]]), GOOSE_DISCS, [4, 5, 6], 4),
    },
    pirates: true,
    missions: ['lairs', 'fish'],
    victoryTarget: 15,
  },
  spices: {
    id: 'spices',
    map: SPICES_MAP,
    startTerrain: null,
    fixedStart: false,
    regions: {
      parrot: region(count([['sea', 1], ['hills', 1], ['forest', 1], ['pasture', 1], ['fields', 1], ['mountains', 2], ['shoal', 3], ['spice', 3]]), PARROT_DISCS, [1, 2, 3], 5),
      goose: region(count([['sea', 1], ['hills', 1], ['forest', 1], ['pasture', 1], ['fields', 2], ['mountains', 1], ['shoal', 3], ['spice', 3]]), GOOSE_DISCS, [4, 5, 6], 4),
    },
    pirates: true,
    missions: ['fish', 'spices'],
    victoryTarget: 15,
  },
  'explorers-pirates': {
    id: 'explorers-pirates',
    map: FULL_MAP,
    startTerrain: null,
    fixedStart: false,
    regions: {
      parrot: region(count([['sea', 1], ['hills', 1], ['forest', 1], ['pasture', 1], ['fields', 1], ['mountains', 2], ['gold', 3], ['shoal', 3], ['spice', 3]]), PARROT_DISCS, [1, 2, 3], 5),
      goose: region(count([['sea', 1], ['hills', 1], ['forest', 1], ['pasture', 1], ['fields', 2], ['mountains', 1], ['gold', 3], ['shoal', 3], ['spice', 3]]), GOOSE_DISCS, [4, 5, 6], 4),
    },
    pirates: true,
    missions: ['lairs', 'fish', 'spices'],
    victoryTarget: 17,
  },
};

export function epScenario(id: string | null): EpScenario {
  const scenario = id ? EP_SCENARIOS[id as EpScenarioId] : undefined;
  if (!scenario) throw new Error(`unknown Explorers & Pirates scenario: ${id}`);
  return scenario;
}

/**
 * Harbour-settlement start marks (EP25 p. 7, EP25-M p. 9): corners 5 and 0 of
 * the hexes along the starting island's east coast.
 */
export const HARBOR_MARK_CORNERS: readonly { q: number; r: number; corner: number }[] = [
  [1, -3], [0, -2], [-1, -1], [-1, 0], [-2, 1], [-2, 2], [-2, 3],
].flatMap(([q, r]) => [{ q: q!, r: r!, corner: 5 }, { q: q!, r: r!, corner: 0 }]);

/** Land Ho! fixed pieces (EP25-M p. 4); every ship carries a settler. */
export interface FixedStart {
  color: PlayerColor;
  settlement: { q: number; r: number; corner: number };
  road: { q: number; r: number; side: number };
  harbor: { q: number; r: number; corner: number };
  ship: { q: number; r: number; side: number };
}

export const LAND_HO_START: readonly FixedStart[] = [
  { color: 'blue', settlement: { q: 0, r: -3, corner: 1 }, road: { q: 0, r: -3, side: 5 }, harbor: { q: -2, r: 2, corner: 0 }, ship: { q: -2, r: 3, side: 1 } },
  { color: 'red', settlement: { q: -3, r: 2, corner: 0 }, road: { q: -2, r: 2, side: 4 }, harbor: { q: 1, r: -3, corner: 1 }, ship: { q: 1, r: -3, side: 5 } },
  { color: 'white', settlement: { q: -3, r: 0, corner: 0 }, road: { q: -2, r: 0, side: 4 }, harbor: { q: -1, r: 0, corner: 1 }, ship: { q: -1, r: 0, side: 5 } },
  { color: 'orange', settlement: { q: -2, r: -1, corner: 2 }, road: { q: -2, r: -1, side: 4 }, harbor: { q: -1, r: -1, corner: 0 }, ship: { q: -1, r: 0, side: 1 } },
];

// ---------------------------------------------------------------------------
// coordinates → indices
// ---------------------------------------------------------------------------

export function hexIndexAt(topology: BoardTopology, q: number, r: number): number {
  return topology.hexes.findIndex((cell) => cell.q === q && cell.r === r);
}

/** Corner `k` of a hex at angle 30° + 60°·k (y down): 0 lower right … 4 top, 5 upper right. */
export function cornerVertex(topology: BoardTopology, q: number, r: number, k: number): number {
  const centre = hexCenter({ q, r });
  const angle = ((30 + 60 * k) * Math.PI) / 180;
  const x = centre.x + Math.cos(angle);
  const y = centre.y + Math.sin(angle);
  return topology.vertices.findIndex((vertex) => Math.abs(vertex.x - x) < 1e-4 && Math.abs(vertex.y - y) < 1e-4);
}

/** The edge of a hex facing `NEIGHBOR_DIRS[side]` (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE). */
export function sideEdge(topology: BoardTopology, q: number, r: number, side: number): number {
  const dir = NEIGHBOR_DIRS[side]!;
  const a = hexCenter({ q, r });
  const b = hexCenter({ q: q + dir.q, r: r + dir.r });
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  return topology.edges.findIndex((edge) => Math.abs(edge.x - x) < 1e-4 && Math.abs(edge.y - y) < 1e-4);
}

/** Per-hex scenario data derived from the map: start island, regions, Council. */
export interface EpBoardIndex {
  startIsland: number[];
  fog: { hex: number; region: EpRegion }[];
  council: number | null;
  harborMarks: number[];
}

export function epBoardIndex(topology: BoardTopology, scenario: EpScenario): EpBoardIndex {
  const at = (cell: HexCoord) => {
    const index = hexIndexAt(topology, cell.q, cell.r);
    if (index < 0) throw new Error(`${topology.id}: no hex ${cell.q},${cell.r}`);
    return index;
  };
  const fog = [
    ...gridCells(scenario.map.parrot).map((cell) => ({ hex: at(cell), region: 'parrot' as const })),
    ...gridCells(scenario.map.goose).map((cell) => ({ hex: at(cell), region: 'goose' as const })),
  ].sort((a, b) => a.hex - b.hex);
  return {
    startIsland: START_ISLAND.map(at).sort((a, b) => a - b),
    fog,
    council: scenario.map.council ? at(scenario.map.council) : null,
    harborMarks: [...new Set(HARBOR_MARK_CORNERS.map(({ q, r, corner }) => cornerVertex(topology, q, r, corner)))].sort((a, b) => a - b),
  };
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

const key = (q: number, r: number): string => `${q},${r}`;

/** The starting-island terrain: printed (Land Ho!, Pirate Lairs) or dealt at random. */
function startTerrain(scenario: EpScenario, rng: LayoutContext['rng']): Map<string, Terrain> {
  if (scenario.startTerrain) return new Map(Object.entries(scenario.startTerrain));
  const cream = START_ISLAND.filter((cell) => !(cell.q === FRAME_PASTURE.q && cell.r === FRAME_PASTURE.r));
  const dealt = shuffle(CATAN_TERRAIN, rng);
  const out = new Map<string, Terrain>([[key(FRAME_PASTURE.q, FRAME_PASTURE.r), 'pasture']]);
  cream.forEach((cell, index) => out.set(key(cell.q, cell.r), dealt[index]!));
  return out;
}

/**
 * Layout builder registered as `explorers-pirates`. The scenario id is the
 * profile's `scenario`; there is no robber (`-1`, off the board).
 */
export function explorersPiratesLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const scenario = epScenario(context.profile.scenario);
  const topology = topologyFor(scenario.map.topologyId);
  const terrain = startTerrain(scenario, context.rng);
  const numbers = new Map(START_ISLAND.map((cell) => [key(cell.q, cell.r), cell.number]));
  const layout: BoardLayout = {
    topologyId: topology.id,
    terrain: [],
    numbers: [],
    harbors: [],
    islands: [],
    robber: -1,
    pirate: null,
  };
  for (const hex of topology.hexes) {
    const k = key(hex.q, hex.r);
    layout.terrain.push(terrain.get(k) ?? 'sea');
    layout.numbers.push(numbers.get(k) ?? null);
    layout.islands.push(terrain.has(k) ? 1 : 0);
  }
  return layout;
}

/** Transcribed inventories, for the fixture tests. */
export const EXPLORERS_PIRATES_SOURCE = {
  startIsland: START_ISLAND,
  catanTerrain: CATAN_TERRAIN,
  maps: { 'land-ho': LAND_HO_MAP, 'pirate-lairs': LAIRS_MAP, fish: FISH_MAP, spices: SPICES_MAP, 'explorers-pirates': FULL_MAP },
  cellCount: (spec: MapSpec) => mapCells(spec).length,
} as const;
