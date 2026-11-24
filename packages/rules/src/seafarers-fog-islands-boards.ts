/**
 * The Fog Islands（未知海域）版圖（SF25 pp. 8–9，spec 2026-11-22-seafarers-scenarios.md §6.3）：
 *   - 3 人：SF25 p. 8；4 人：SF25 p. 9。
 * 兩張圖都是 42 格外框（rows 5-6-7-6-7-6-5，中排兩端的突出部是框不是格），沿用
 * `NS4_CELLS`；每張圖 30 格已知（面朝上）加 12 個空格（未知海域），空格兩個人數
 * 位置不同。兩座已知島編號 2（東北）、3（西南）；編號 1 是 New Shores 的主島，此處不用。
 *
 * layout 不含任何隱藏資訊：12 個空格存成沒有數字的海，翻開時才從 module state 的
 * 剩餘牌庫以 `ctx.rng` 抽出（做法同 `explorers-pirates-boards.ts`，見
 * `modules/seafarers/fog.ts`）。強盜起始在 12 號圓片格；海盜棋子兩張圖都在海框上
 * （`pirate: null`）。逐格轉錄表、兩份獨立轉錄的比對與來源 sha256 見
 * docs/aegis/work/2026-11-23-seafarers-fog-islands.md。
 */

import { variableFogKnownBoard } from './seafarers-variable-boards.ts';
import type { LayoutContext } from './layout-registry.ts';
import { fixedLayout, L, NS4_CELLS, type LandHex, type PortSpec } from './seafarers-boards.ts';
import type { BoardTopology, HexCoord, TopologyDefinition } from './topology.ts';
import type { BoardLayout, Terrain } from './types.ts';

// ---------------------------------------------------------------------------
// 3 人 — SF25 p. 8
// ---------------------------------------------------------------------------

const FOG3_LAND: readonly LandHex[] = [
  // 島 2（東北）
  L(3, -3, 'hills', 6, 2), L(4, -3, 'forest', 11, 2), L(3, -2, 'forest', 5, 2),
  L(4, -2, 'fields', 3, 2), L(3, -1, 'pasture', 8, 2), L(4, -1, 'pasture', 9, 2),
  L(3, 0, 'mountains', 4, 2),
  // 島 3（西南）
  L(-2, 0, 'forest', 6, 3), L(-1, 0, 'pasture', 5, 3),
  L(-2, 1, 'hills', 11, 3), L(-1, 1, 'forest', 9, 3), L(-2, 2, 'mountains', 8, 3),
  L(-1, 2, 'fields', 10, 3), L(-2, 3, 'pasture', 12, 3),
];

/** 港口依 `topology.ts` 的 side（0 E、1 NE、2 NW、3 W、4 SW、5 SE）；全部貼在已知陸地。 */
const FOG3_PORTS: readonly PortSpec[] = [
  { q: 3, r: -3, side: 1, type: 'generic' },
  { q: 4, r: -3, side: 0, type: 'wool' },
  { q: 4, r: -1, side: 1, type: 'grain' },
  { q: 3, r: 0, side: 0, type: 'generic' },
  { q: -2, r: 0, side: 4, type: 'ore' },
  { q: -2, r: 1, side: 4, type: 'lumber' },
  { q: -1, r: 2, side: 5, type: 'brick' },
  { q: -2, r: 3, side: 3, type: 'generic' },
];

/** 空格（未知海域），圖上留白。 */
const FOG3_HEXES: readonly HexCoord[] = [
  { q: 0, r: -3 }, { q: 1, r: -3 }, { q: -1, r: -2 }, { q: 0, r: -2 }, { q: 1, r: -2 }, { q: 1, r: -1 },
  { q: 1, r: 0 }, { q: 1, r: 1 }, { q: 1, r: 2 }, { q: 2, r: 2 }, { q: 0, r: 3 }, { q: 1, r: 3 },
];

// ---------------------------------------------------------------------------
// 4 人 — SF25 p. 9
// ---------------------------------------------------------------------------

const FOG4_LAND: readonly LandHex[] = [
  // 島 2（東北）
  L(2, -3, 'hills', 4, 2), L(3, -3, 'fields', 10, 2), L(4, -3, 'mountains', 3, 2),
  L(2, -2, 'pasture', 9, 2), L(3, -2, 'forest', 6, 2), L(4, -2, 'hills', 12, 2),
  L(3, -1, 'pasture', 10, 2), L(4, -1, 'mountains', 8, 2), L(3, 0, 'fields', 11, 2),
  L(3, 1, 'forest', 5, 2),
  // 島 3（西南）
  L(-2, 0, 'mountains', 3, 3), L(-3, 1, 'fields', 6, 3),
  L(-2, 1, 'forest', 4, 3), L(-3, 2, 'hills', 9, 3), L(-2, 2, 'pasture', 8, 3),
  L(-3, 3, 'pasture', 2, 3), L(-2, 3, 'forest', 5, 3),
];

const FOG4_PORTS: readonly PortSpec[] = [
  { q: 2, r: -3, side: 1, type: 'wool' },
  { q: 4, r: -3, side: 2, type: 'grain' },
  { q: 4, r: -3, side: 0, type: 'generic' },
  { q: 4, r: -1, side: 1, type: 'brick' },
  { q: 3, r: 1, side: 1, type: 'generic' },
  { q: -2, r: 0, side: 3, type: 'lumber' },
  { q: -3, r: 1, side: 4, type: 'ore' },
  { q: -3, r: 3, side: 3, type: 'generic' },
  { q: -3, r: 3, side: 5, type: 'generic' },
];

const FOG4_HEXES: readonly HexCoord[] = [
  { q: 0, r: -3 }, { q: -1, r: -2 }, { q: 0, r: -2 }, { q: 0, r: -1 }, { q: 0, r: 0 }, { q: 1, r: 0 },
  { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 0, r: 2 }, { q: 1, r: 2 }, { q: 0, r: 3 }, { q: 1, r: 3 },
];

// ---------------------------------------------------------------------------
// 未知牌庫（兩個人數相同的板塊；圓片依人數）
// ---------------------------------------------------------------------------

/** 未知板塊（SF25 pp. 8–9 配件表 Facedown 列）：海 2、金 2、田 2、丘 2、山 2、草 1、林 1。 */
export type FogTile = Extract<Terrain, 'sea' | 'gold' | 'fields' | 'hills' | 'mountains' | 'pasture' | 'forest'>;

export const FOG_TILES: Readonly<Record<FogTile, number>> = {
  sea: 2, gold: 2, fields: 2, hills: 2, mountains: 2, pasture: 1, forest: 1,
};

/** 未知圓片（升冪；每枚一個元素）。 */
const FOG3_DISCS: readonly number[] = [3, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const FOG4_DISCS: readonly number[] = [3, 4, 5, 6, 8, 9, 10, 11, 11, 12];

export interface FogIslandsMap {
  land: readonly LandHex[];
  ports: readonly PortSpec[];
  fog: readonly HexCoord[];
  discs: readonly number[];
}

export function fogIslandsMap(playerCount: number): FogIslandsMap {
  if (playerCount === 3) return { land: FOG3_LAND, ports: FOG3_PORTS, fog: FOG3_HEXES, discs: FOG3_DISCS };
  if (playerCount === 4) return { land: FOG4_LAND, ports: FOG4_PORTS, fog: FOG4_HEXES, discs: FOG4_DISCS };
  throw new Error(`The Fog Islands has no ${playerCount}-player map`);
}

// ---------------------------------------------------------------------------
// topology 與 layout
// ---------------------------------------------------------------------------

const slots = (ports: readonly PortSpec[]) => ports.map(({ q, r, side }) => ({ q, r, side }));

export const FOG_ISLANDS_TOPOLOGIES: readonly TopologyDefinition[] = [
  { id: 'sf-fog-islands-3', hexes: NS4_CELLS, harborSlots: slots(FOG3_PORTS) },
  { id: 'sf-fog-islands-4', hexes: NS4_CELLS, harborSlots: slots(FOG4_PORTS) },
];

/** 未知海域：3、4 人都是 42 格外框，依人數選港口位置不同的 topology。 */
export function fogIslandsTopologyId(playerCount: number): string {
  if (playerCount === 3) return 'sf-fog-islands-3';
  if (playerCount === 4) return 'sf-fog-islands-4';
  throw new Error(`The Fog Islands has no ${playerCount}-player map`);
}

/** Layout builder，登記為 `sf-fog-islands`；空格存成沒有數字的海。 */
export function fogIslandsLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = topologyFor(fogIslandsTopologyId(context.playerCount));
  if (topology.hexes.length !== 42) throw new Error(`topology ${topology.id} has ${topology.hexes.length} hexes, expected 42`);
  const map = fogIslandsMap(context.playerCount);
  if (context.mode === 'variable') {
    // SF25 p. 9 variable setup：已知陸地與圓片在兩座島區內隨機（紅色圓片可相鄰）；港口位置不變、種類洗牌。
    // 空格仍是無數字的海，迷霧牌庫與圓片由 module state 照舊處理。
    const board = variableFogKnownBoard(map.land, map.ports, context.rng);
    const twelve = board.land.find((hex) => hex.number === 12)!;
    return fixedLayout(topology, board.land, board.ports, twelve);
  }
  return fixedLayout(topology, map.land, map.ports, context.playerCount === 3 ? { q: -2, r: 3 } : { q: 4, r: -2 });
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 8–9）。 */
export const FOG_ISLANDS_SOURCE = {
  3: { ...fogIslandsMap(3), cells: NS4_CELLS.length },
  4: { ...fogIslandsMap(4), cells: NS4_CELLS.length },
} as const;
