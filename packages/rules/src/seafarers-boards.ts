/**
 * Heading for New Shores boards (Seafarers 2025).
 *
 * Transcribed from the printed scenario maps:
 *   - 3 players: SF25 (CN3083, 2025) p. 4, component table p. 4;
 *   - 4 players: SF25 p. 5, component table p. 5;
 *   - 5–6 players: SF56-25 (CN3084, 2025) p. 4 (small islands fixed, main
 *     island built with the CATAN 5–6 variable setup, ports random on the
 *     marked positions).
 * Source hashes and the transcription method are recorded in
 * docs/aegis/work/2026-11-01-seafarers.md and docs/FIDELITY.md.
 *
 * Coordinates are axial (pointy-top, `r` grows downwards, see `topology.ts`).
 * Each topology lists exactly the cells that hold a hex tile (land or sea).
 * The frame is not a cell: its inner edges are the topology's boundary edges.
 * Both frame "protrusions" at the ends of the middle row (the corner frame
 * pieces with a hex-shaped bump) are frame, which is why the 3/4-player
 * component tables list 35/42 hexes for a 37/44-cell outline. The pirate
 * starts on the right-hand protrusion, i.e. on the frame (`pirate: null`).
 */

import type { LayoutContext } from './layout-registry.ts';
import { PAIRED_NUMBER_TOKENS, PAIRED_TERRAIN_MULTISET } from './layout.ts';
import { shuffle } from './rng.ts';
import type { BoardTopology, HarborSlotSpec, HexCoord, TopologyDefinition } from './topology.ts';
import type { BoardLayout, HarborType, Terrain } from './types.ts';

/** Island id of the main island; small islands are numbered from 2. */
export const MAIN_ISLAND = 1;

interface LandHex extends HexCoord {
  terrain: Terrain;
  number: number | null;
  island: number;
}

interface PortSpec extends HarborSlotSpec {
  type: HarborType;
}

function cells(rows: Record<number, [number, number]>, frame: readonly HexCoord[]): HexCoord[] {
  const out: HexCoord[] = [];
  for (const [rKey, [from, to]] of Object.entries(rows)) {
    const r = Number(rKey);
    for (let q = from; q <= to; q++) {
      if (frame.some((cell) => cell.q === q && cell.r === r)) continue;
      out.push({ q, r });
    }
  }
  return out;
}

const L = (q: number, r: number, terrain: Terrain, number: number | null, island = MAIN_ISLAND): LandHex =>
  ({ q, r, terrain, number, island });

// ---------------------------------------------------------------------------
// 3 players — SF25 p. 4
// ---------------------------------------------------------------------------

/** Radius-3 outline minus the two frame protrusions: rows 4-5-6-5-6-5-4. */
const NS3_CELLS = cells(
  { [-3]: [0, 3], [-2]: [-1, 3], [-1]: [-2, 3], 0: [-3, 3], 1: [-3, 2], 2: [-3, 1], 3: [-3, 0] },
  [{ q: -3, r: 0 }, { q: 3, r: 0 }],
);

const NS3_LAND: readonly LandHex[] = [
  // small island 2 (north-west)
  L(0, -3, 'hills', 12, 2), L(1, -3, 'gold', 5, 2),
  // small island 3 (north-east)
  L(2, -2, 'pasture', 4, 3), L(3, -2, 'mountains', 9, 3), L(2, -1, 'fields', 3, 3), L(2, 0, 'gold', 4, 3),
  // small island 4 (south-east)
  L(1, 2, 'mountains', 8, 4), L(0, 3, 'hills', 10, 4),
  // main island
  L(-1, -1, 'fields', 4), L(0, -1, 'pasture', 6),
  L(-2, 0, 'pasture', 2), L(-1, 0, 'mountains', 5), L(0, 0, 'forest', 10),
  L(-3, 1, 'hills', 8), L(-2, 1, 'pasture', 10), L(-1, 1, 'pasture', 9), L(0, 1, 'forest', 8),
  L(-3, 2, 'fields', 11), L(-2, 2, 'mountains', 3), L(-1, 2, 'hills', 11),
  L(-3, 3, 'fields', 6), L(-2, 3, 'forest', 5),
];

const NS3_PORTS: readonly PortSpec[] = [
  { q: -1, r: -1, side: 3, type: 'grain' },
  { q: 0, r: -1, side: 0, type: 'generic' },
  { q: -3, r: 1, side: 2, type: 'ore' },
  { q: 0, r: 1, side: 1, type: 'wool' },
  { q: -3, r: 1, side: 4, type: 'generic' },
  { q: -3, r: 3, side: 3, type: 'brick' },
  { q: -2, r: 3, side: 4, type: 'lumber' },
  { q: -2, r: 3, side: 0, type: 'generic' },
];

// ---------------------------------------------------------------------------
// 4 players — SF25 p. 5
// ---------------------------------------------------------------------------

/** Rows 5-6-7-6-7-6-5 (the 44-cell outline minus both protrusions). */
const NS4_CELLS = cells(
  { [-3]: [0, 4], [-2]: [-1, 4], [-1]: [-2, 4], 0: [-3, 4], 1: [-3, 3], 2: [-3, 2], 3: [-3, 1] },
  [{ q: -3, r: 0 }, { q: 4, r: 0 }],
);

const NS4_LAND: readonly LandHex[] = [
  // small island 2 (north-west)
  L(0, -3, 'mountains', 8, 2), L(1, -3, 'pasture', 11, 2),
  // small island 3 (north-east)
  L(3, -3, 'gold', 4, 3), L(3, -2, 'hills', 5, 3), L(4, -2, 'mountains', 2, 3), L(3, -1, 'forest', 9, 3),
  L(3, 0, 'gold', 10, 3),
  // small island 4 (south-east)
  L(2, 2, 'hills', 3, 4), L(1, 3, 'fields', 6, 4),
  // main island
  L(-1, -1, 'pasture', 5), L(0, -1, 'forest', 6), L(1, -1, 'mountains', 4),
  L(-2, 0, 'fields', 12), L(-1, 0, 'hills', 11), L(0, 0, 'fields', 3), L(1, 0, 'pasture', 9),
  L(-3, 1, 'hills', 6), L(-2, 1, 'forest', 10), L(-1, 1, 'desert', null), L(0, 1, 'fields', 11),
  L(1, 1, 'forest', 5),
  L(-3, 2, 'mountains', 3), L(-2, 2, 'pasture', 4), L(-1, 2, 'hills', 9), L(0, 2, 'pasture', 8),
  L(-3, 3, 'fields', 8), L(-2, 3, 'forest', 2), L(-1, 3, 'mountains', 10),
];

const NS4_PORTS: readonly PortSpec[] = [
  { q: -1, r: -1, side: 3, type: 'generic' },
  { q: 1, r: -1, side: 2, type: 'ore' },
  { q: 1, r: 0, side: 1, type: 'generic' },
  { q: 1, r: 1, side: 5, type: 'grain' },
  { q: -1, r: 3, side: 0, type: 'generic' },
  { q: -2, r: 3, side: 4, type: 'lumber' },
  { q: -3, r: 3, side: 3, type: 'generic' },
  { q: -3, r: 1, side: 4, type: 'brick' },
  { q: -3, r: 1, side: 2, type: 'wool' },
];

// ---------------------------------------------------------------------------
// 5–6 players — SF56-25 p. 4
// ---------------------------------------------------------------------------

/** Rows 7-8-9-8-9-8-7 (the 58-cell outline minus both protrusions). */
const NS56_CELLS = cells(
  { [-3]: [-1, 5], [-2]: [-2, 5], [-1]: [-3, 5], 0: [-4, 5], 1: [-4, 4], 2: [-4, 3], 3: [-4, 2] },
  [{ q: -4, r: 0 }, { q: 5, r: 0 }],
);

/** The 30 "?" cells of the variable main island (rows 3-4-5-6-5-4-3). */
const NS56_MAIN: readonly HexCoord[] = cells(
  { [-3]: [1, 3], [-2]: [0, 3], [-1]: [-1, 3], 0: [-2, 3], 1: [-2, 2], 2: [-2, 1], 3: [-2, 0] },
  [],
);

/**
 * Fixed small islands. The printed dark-blue outlines group `6`+`12` and
 * `3`+`10` with the sea hex between them into one small island each, so
 * those pairs share an island id (SF25 p. 4: "Areas outlined in dark blue are
 * the small islands").
 */
const NS56_SMALL: readonly LandHex[] = [
  L(-1, -3, 'gold', 9, 2), L(-2, -2, 'mountains', 11, 2), L(-3, -1, 'pasture', 8, 2),
  L(-4, 1, 'hills', 4, 3), L(-4, 2, 'forest', 2, 3), L(-4, 3, 'gold', 5, 3),
  L(5, -3, 'mountains', 6, 4), L(5, -1, 'hills', 12, 4),
  L(4, 1, 'fields', 3, 5), L(2, 3, 'gold', 10, 5),
];

/** Marked port positions, clockwise from the top. */
const NS56_PORT_SLOTS: readonly HarborSlotSpec[] = [
  { q: 2, r: -3, side: 1 },
  { q: 3, r: -2, side: 1 },
  { q: 3, r: -1, side: 0 },
  { q: 3, r: 0, side: 5 },
  { q: 1, r: 2, side: 0 },
  { q: 0, r: 3, side: 5 },
  { q: -1, r: 3, side: 4 },
  { q: -2, r: 2, side: 4 },
  { q: -2, r: 0, side: 4 },
  { q: -1, r: -1, side: 3 },
  { q: 0, r: -2, side: 2 },
];

/** SF25's 5×2:1 + 5×3:1 port tokens plus SF56-25's extra 2:1 wool port. */
export const NS56_PORT_TOKENS: readonly HarborType[] = [
  'lumber', 'brick', 'wool', 'wool', 'grain', 'ore',
  'generic', 'generic', 'generic', 'generic', 'generic',
];

// ---------------------------------------------------------------------------
// topologies and layouts
// ---------------------------------------------------------------------------

export const NEW_SHORES_TOPOLOGIES: readonly TopologyDefinition[] = [
  { id: 'sf-new-shores-3', hexes: NS3_CELLS, harborSlots: NS3_PORTS.map(({ q, r, side }) => ({ q, r, side })) },
  { id: 'sf-new-shores-4', hexes: NS4_CELLS, harborSlots: NS4_PORTS.map(({ q, r, side }) => ({ q, r, side })) },
  { id: 'sf-new-shores-56', hexes: NS56_CELLS, harborSlots: NS56_PORT_SLOTS },
];

export function newShoresTopologyId(playerCount: number): string {
  if (playerCount === 3) return 'sf-new-shores-3';
  if (playerCount === 4) return 'sf-new-shores-4';
  if (playerCount === 5 || playerCount === 6) return 'sf-new-shores-56';
  throw new Error(`Heading for New Shores has no ${playerCount}-player map`);
}

const key = (q: number, r: number): string => `${q},${r}`;

function fixedLayout(topology: BoardTopology, land: readonly LandHex[], ports: readonly PortSpec[], robber: HexCoord): BoardLayout {
  const byKey = new Map(land.map((hex) => [key(hex.q, hex.r), hex]));
  const layout: BoardLayout = {
    topologyId: topology.id,
    terrain: [],
    numbers: [],
    harbors: topology.harborSlots.map((edge, index) => ({ edge, type: ports[index]!.type })),
    islands: [],
    robber: topology.hexes.findIndex((hex) => hex.q === robber.q && hex.r === robber.r),
    pirate: null,
  };
  for (const hex of topology.hexes) {
    const tile = byKey.get(key(hex.q, hex.r));
    layout.terrain.push(tile?.terrain ?? 'sea');
    layout.numbers.push(tile?.number ?? null);
    layout.islands.push(tile?.island ?? 0);
  }
  return layout;
}

/**
 * 5–6 players: the small islands are fixed; the main island takes the
 * CATAN 5–6 terrain and number inventories at random (the same procedure the
 * engine uses for the base 5–6 variable board: shuffled terrain, shuffled
 * number discs dealt to the non-desert hexes) and the port tokens are
 * shuffled over the marked positions. The robber starts on the first desert.
 */
function pairedLayout(topology: BoardTopology, rng: LayoutContext['rng']): BoardLayout {
  const terrain = shuffle(PAIRED_TERRAIN_MULTISET, rng);
  const numbers = shuffle(PAIRED_NUMBER_TOKENS, rng);
  const ports = shuffle(NS56_PORT_TOKENS, rng);
  const main = NS56_MAIN.slice().sort((a, b) => (a.r - b.r) || (a.q - b.q));
  let cursor = 0;
  const mainLand: LandHex[] = main.map((cell, index) => {
    const tile = terrain[index]!;
    return L(cell.q, cell.r, tile, tile === 'desert' ? null : numbers[cursor++]!);
  });
  const land = [...mainLand, ...NS56_SMALL];
  const desert = mainLand.find((hex) => hex.terrain === 'desert')!;
  const portSpecs = NS56_PORT_SLOTS.map((slot, index) => ({ ...slot, type: ports[index]! }));
  return fixedLayout(topology, land, portSpecs, desert);
}

/** Layout builder registered as `sf-new-shores`. */
export function newShoresLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = topologyFor(newShoresTopologyId(context.playerCount));
  switch (topology.id) {
    case 'sf-new-shores-3':
      return fixedLayout(topology, NS3_LAND, NS3_PORTS, { q: 0, r: -3 });
    case 'sf-new-shores-4':
      return fixedLayout(topology, NS4_LAND, NS4_PORTS, { q: -1, r: 1 });
    default:
      return pairedLayout(topology, context.rng);
  }
}

/** Transcribed inventories, for the fixture tests (SF25 pp. 4–5, SF56-25 p. 4). */
export const NEW_SHORES_SOURCE = {
  3: { land: NS3_LAND, ports: NS3_PORTS, cells: NS3_CELLS.length },
  4: { land: NS4_LAND, ports: NS4_PORTS, cells: NS4_CELLS.length },
  56: { small: NS56_SMALL, main: NS56_MAIN, portSlots: NS56_PORT_SLOTS, cells: NS56_CELLS.length },
} as const;
