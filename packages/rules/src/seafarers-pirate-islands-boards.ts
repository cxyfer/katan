/**
 * The Pirate Islands（海盜巢穴，SF25 pp. 16–17）的版圖與預置棋子位置。
 *
 * 3 人與 4 人共用同一張圖（SF25 只有一張，跨 pp. 16–17）；3 人局不使用白色的位置。外框 49 格，
 * rows 6-7-8-7-8-7-6，與世外部落（`FT_CELLS`）同形：中排兩端的突出部（WEST／EAST 標籤）是框，不是格。
 * 座標：轉錄原點是「最上排 r=0、該排最左 q=0」，這裡一次平移 (dq, dr) = (-1, -3)，與 S5 相同。
 * 逐格表、兩份獨立轉錄的比對與來源 sha256 見 docs/aegis/work/2026-11-24-seafarers-pirate-islands.md。
 *
 * 島編號：1 = 東島（開拓者的家，17 格）；2 = 西北海盜島；3 = 中央北小島（兩塊沙漠）；
 * 4 = 西中單格山島；5 = 西南海盜島；6 = 中央南小島（沙漠與草地）。其餘島都是海盜群島。
 * 6 格沒有圓片：(−1,1)、(−3,5) 兩塊小丘與 (2,1)、(1,2)、(0,4) 三塊沙漠和 (0,5) 草地（轉錄座標）。
 * 強盜不使用（`robber: -1`）；海盜起始在航道的起點海格。
 */

import type { LayoutContext } from './layout-registry.ts';
import { shuffle } from './rng.ts';
import { FT_CELLS } from './seafarers-scenario-boards.ts';
import { fixedLayout, L, type LandHex, type PortSpec } from './seafarers-boards.ts';
import { hexCenter, NEIGHBOR_DIRS, type BoardTopology, type HarborSlotSpec, type HexCoord, type TopologyDefinition } from './topology.ts';
import type { BoardLayout, HarborType } from './types.ts';

export const PIRATE_ISLANDS_TOPOLOGY_ID = 'sf-pirate-islands';

/** 轉錄座標平移到置中座標（與 S5 的 `FT_SHIFT` 相同）。 */
export const PI_SHIFT = { dq: -1, dr: -3 } as const;

/** 轉錄座標（原點在左上）轉成置中座標。 */
const pi = (q: number, r: number, terrain: LandHex['terrain'], number: number | null, island: number): LandHex =>
  L(q + PI_SHIFT.dq, r + PI_SHIFT.dr, terrain, number, island);

const PI_LAND: readonly LandHex[] = [
  // 島 2：西北海盜島（(-1,1) 小丘與 (0,0) 金礦等）
  pi(0, 0, 'gold', 11, 2), pi(1, 0, 'mountains', 6, 2), pi(-1, 1, 'hills', null, 2), pi(-2, 2, 'fields', 4, 2),
  // 島 3：中央北小島（兩塊沙漠）
  pi(2, 1, 'desert', null, 3), pi(1, 2, 'desert', null, 3),
  // 島 4：西中單格山島
  pi(-1, 3, 'mountains', 8, 4),
  // 島 5：西南海盜島
  pi(-3, 4, 'fields', 10, 5), pi(-3, 5, 'hills', null, 5), pi(-3, 6, 'gold', 3, 5), pi(-2, 6, 'mountains', 6, 5),
  // 島 6：中央南小島
  pi(0, 4, 'desert', null, 6), pi(0, 5, 'pasture', null, 6),
  // 島 1：東島（17 格）
  pi(4, 0, 'fields', 4, 1), pi(5, 0, 'hills', 5, 1),
  pi(4, 1, 'mountains', 9, 1), pi(5, 1, 'forest', 10, 1),
  pi(3, 2, 'forest', 3, 1), pi(4, 2, 'pasture', 8, 1), pi(5, 2, 'forest', 5, 1),
  pi(2, 3, 'fields', 6, 1), pi(3, 3, 'hills', 9, 1), pi(4, 3, 'pasture', 12, 1),
  pi(2, 4, 'pasture', 11, 1), pi(3, 4, 'forest', 8, 1), pi(4, 4, 'pasture', 9, 1),
  pi(2, 5, 'mountains', 5, 1), pi(3, 5, 'forest', 2, 1),
  pi(1, 6, 'fields', 10, 1), pi(2, 6, 'hills', 4, 1),
];

/** 東島的島編號。 */
export const PI_MAIN_ISLAND = 1;

const slot = (q: number, r: number, side: number): HarborSlotSpec => ({ q: q + PI_SHIFT.dq, r: r + PI_SHIFT.dr, side });

/**
 * 8 個港口位置（全部貼在東島陸地格朝向框的邊上，圖上都是「?」）。順序即 topology 的 `harborSlots`；
 * 種類是 5 個 2:1（各一種資源）+ 3 個 3:1，由 layout builder 以 game rng 洗牌。
 */
const PI_PORT_SLOTS: readonly HarborSlotSpec[] = [
  slot(4, 0, 2), slot(5, 0, 2), slot(5, 0, 0), slot(5, 1, 0),
  slot(4, 3, 0), slot(4, 4, 5), slot(3, 5, 5), slot(1, 6, 5),
];

export const PI_PORT_TOKENS: readonly HarborType[] = ['lumber', 'brick', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic'];

/** 預置位置用「格 + 角」表示：角 0 右下、1 下、2 左下、3 左上、4 上、5 右上（同 `seafarers-helpers.corner`）。 */
export interface CornerSpec extends HexCoord {
  corner: number;
}

/** 預置位置用「格 + 邊」表示：邊 0 E、1 NE、2 NW、3 W、4 SW、5 SE。 */
export interface SideSpec extends HexCoord {
  side: number;
}

const cn = (q: number, r: number, corner: number): CornerSpec => ({ q: q + PI_SHIFT.dq, r: r + PI_SHIFT.dr, corner });
const sd = (q: number, r: number, side: number): SideSpec => ({ q: q + PI_SHIFT.dq, r: r + PI_SHIFT.dr, side });

/** 一組顏色的預置棋子（SF25 p. 16 的圖）。 */
export interface PiecesSpec {
  /** 開局放在東島海岸的村落與船。 */
  settlement: CornerSpec;
  ship: SideSpec;
  /** 西邊島上的堡壘（3 枚 pirate lair 疊在 1 個村落上）。 */
  fortress: CornerSpec;
  /** beachhead marker：船線到達後可在那裡蓋村落。 */
  beachhead: CornerSpec;
}

/**
 * 四組預置棋子，依圖上顏色排列：紅、藍、橙、白。3 人局不使用白色的位置（`PI_PIECES.slice(0, 3)`）；
 * 玩家與組別的對應見 `modules/seafarers/pirateIslands.ts`。
 */
export const PI_PIECES: readonly { color: 'red' | 'blue' | 'orange' | 'white'; pieces: PiecesSpec }[] = [
  { color: 'red', pieces: { settlement: cn(4, 0, 1), ship: sd(4, 0, 4), fortress: cn(0, 0, 4), beachhead: cn(1, 0, 5) } },
  { color: 'blue', pieces: { settlement: cn(2, 3, 1), ship: sd(2, 3, 4), fortress: cn(-3, 5, 4), beachhead: cn(-1, 3, 1) } },
  { color: 'orange', pieces: { settlement: cn(1, 6, 4), ship: sd(1, 6, 2), fortress: cn(-3, 6, 1), beachhead: cn(-2, 6, 0) } },
  { color: 'white', pieces: { settlement: cn(2, 3, 4), ship: sd(2, 3, 2), fortress: cn(-1, 1, 1), beachhead: cn(-1, 3, 4) } },
];

/** 海盜航道：14 個海格的封閉單圈，順時針（先北側往東、東側往南、南側往西、西側往北）；第一格是海盜起點。 */
export const PI_ROUTE: readonly HexCoord[] = [
  [0, 6], [-1, 6], [-1, 5], [-1, 4], [0, 3], [0, 2], [1, 1], [2, 0], [3, 0], [3, 1], [2, 2], [1, 3], [1, 4], [1, 5],
].map(([q, r]) => ({ q: q! + PI_SHIFT.dq, r: r! + PI_SHIFT.dr }));

/** 海盜起點（航道的第一格；圖上畫在最下排、東島 (1,6) 田 10 的西鄰）。 */
export const PI_PIRATE_START: HexCoord = PI_ROUTE[0]!;

/** 配件：每座堡壘的 pirate lair 數。 */
export const PI_LAIRS_PER_FORTRESS = 3;

export const PI_TOPOLOGIES: readonly TopologyDefinition[] = [
  { id: PIRATE_ISLANDS_TOPOLOGY_ID, hexes: FT_CELLS, harborSlots: PI_PORT_SLOTS },
];

function checkedTopology(topologyFor: (id: string) => BoardTopology): BoardTopology {
  const topology = topologyFor(PIRATE_ISLANDS_TOPOLOGY_ID);
  if (topology.hexes.length !== 49) throw new Error(`topology ${PIRATE_ISLANDS_TOPOLOGY_ID} has ${topology.hexes.length} hexes, expected 49`);
  return topology;
}

/** Layout builder，登記為 `sf-pirate-islands`：3 人與 4 人同一張圖；港口種類以 game rng 洗牌；強盜不使用。 */
export function pirateIslandsLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = checkedTopology(topologyFor);
  const tokens = shuffle(PI_PORT_TOKENS, context.rng);
  const ports: PortSpec[] = PI_PORT_SLOTS.map((entry, index) => ({ ...entry, type: tokens[index]! }));
  const layout = fixedLayout(topology, PI_LAND, ports, PI_PIRATE_START);
  // 強盜放回盒子；海盜在航道起點的海格。
  layout.robber = -1;
  layout.pirate = topology.hexes.findIndex((hex) => hex.q === PI_PIRATE_START.q && hex.r === PI_PIRATE_START.r);
  return layout;
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 16–17）。 */
export const PIRATE_ISLANDS_SOURCE = {
  land: PI_LAND, portSlots: PI_PORT_SLOTS, pieces: PI_PIECES, route: PI_ROUTE, pirate: PI_PIRATE_START,
  cells: FT_CELLS.length, shift: PI_SHIFT,
} as const;

/** 「格 + 角」對應的 topology 頂點索引。 */
export function cornerVertex(topology: BoardTopology, spec: CornerSpec): number {
  const centre = hexCenter(spec);
  const angle = ((30 + 60 * spec.corner) * Math.PI) / 180;
  const x = centre.x + Math.cos(angle);
  const y = centre.y + Math.sin(angle);
  const index = topology.vertices.findIndex((vertex) => Math.abs(vertex.x - x) < 1e-4 && Math.abs(vertex.y - y) < 1e-4);
  if (index < 0) throw new Error(`pirate islands: no corner ${spec.corner} on ${spec.q},${spec.r}`);
  return index;
}

/** 「格 + 邊」對應的 topology 邊索引（邊在框上時也找得到）。 */
export function sideEdge(topology: BoardTopology, spec: SideSpec): number {
  const dir = NEIGHBOR_DIRS[spec.side]!;
  const a = hexCenter(spec);
  const b = hexCenter({ q: spec.q + dir.q, r: spec.r + dir.r });
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  const index = topology.edges.findIndex((edge) => Math.abs(edge.x - x) < 1e-4 && Math.abs(edge.y - y) < 1e-4);
  if (index < 0) throw new Error(`pirate islands: no side ${spec.side} on ${spec.q},${spec.r}`);
  return index;
}

/** 航道的海格索引（依順序）。 */
export function routeHexes(topology: BoardTopology): number[] {
  return PI_ROUTE.map((cell) => {
    const index = topology.hexes.findIndex((hex) => hex.q === cell.q && hex.r === cell.r);
    if (index < 0) throw new Error(`pirate islands: route hex ${cell.q},${cell.r} is not on the board`);
    return index;
  });
}
