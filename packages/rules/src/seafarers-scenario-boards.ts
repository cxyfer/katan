/**
 * Seafarers 其餘劇本的版圖（SF25 pp. 6–20，spec 2026-11-22-seafarers-scenarios.md §7.3）。
 *
 * 目前有 The Four Islands（四島群島）、Through the Desert（穿越荒漠，SF25 pp. 10–11，
 * 外框依人數不同，見該節）、The Forgotten Tribe（世外部落，SF25 pp. 12–13，49 格寬版外框）
 * Cloth for Catan（布匹產地，SF25 pp. 14–15，42 格）與 The Wonders of Catan（卡坦奇觀，SF25 pp. 18–19，
 * 與世外部落同一個 49 格外框）。四島群島：
 *   - 3 人：SF25 p. 6 的版圖與配件表；
 *   - 4 人：SF25 p. 7 的版圖與配件表。
 * 兩張圖都是 35 格外框，與 New Shores 3 人圖相同（rows 4-5-6-5-6-5-4，中排兩端的
 * 突出部是框，不是格），所以直接沿用 `NS3_CELLS`；但港口位置不同，故各登記
 * 自己的 topology id（`sf-four-islands-3`／`-4`）。
 *
 * 沒有主島：四座島編號 2（左上）、3（右上）、4（左下）、5（右下）。強盜起始在
 * 12 號圓片格；海盜棋子在海框上（`pirate: null`，與 New Shores 相同）。
 * 逐格轉錄表、兩份獨立轉錄的比對與來源 sha256 見
 * docs/aegis/work/2026-11-22-seafarers-four-islands.md。
 */

import type { LayoutContext } from './layout-registry.ts';
import { fixedLayout, L, NS3_CELLS, NS4_CELLS, type LandHex, type PortSpec } from './seafarers-boards.ts';
import { shuffle } from './rng.ts';
import { variableDesertBoard, variableFourIslandsBoard } from './seafarers-variable-boards.ts';
import { hexCenter, NEIGHBOR_DIRS, type BoardTopology, type HarborSlotSpec, type HexCoord, type TopologyDefinition } from './topology.ts';
import type { BoardLayout, HarborType } from './types.ts';

// ---------------------------------------------------------------------------
// 3 人 — SF25 p. 6
// ---------------------------------------------------------------------------

const FI3_LAND: readonly LandHex[] = [
  // 島 2（左上）
  L(-1, -2, 'mountains', 4, 2), L(0, -2, 'forest', 9, 2), L(-2, -1, 'pasture', 6, 2), L(-1, -1, 'mountains', 10, 2),
  // 島 3（右上）
  L(2, -3, 'fields', 4, 3), L(3, -3, 'pasture', 3, 3), L(2, -2, 'fields', 9, 3), L(3, -2, 'hills', 5, 3),
  L(1, -1, 'forest', 8, 3), L(2, -1, 'hills', 11, 3),
  // 島 4（左下）
  L(-3, 1, 'fields', 11, 4), L(-2, 1, 'mountains', 8, 4), L(-1, 1, 'forest', 3, 4), L(-3, 2, 'forest', 5, 4),
  L(-2, 2, 'pasture', 9, 4), L(-3, 3, 'pasture', 12, 4),
  // 島 5（右下）
  L(1, 1, 'hills', 10, 5), L(2, 1, 'hills', 6, 5), L(0, 2, 'mountains', 2, 5), L(1, 2, 'fields', 5, 5),
];

/** 港口依 `topology.ts` 的 side（0 E、1 NE、2 NW、3 W、4 SW、5 SE）；有些朝向框而不是海格。 */
const FI3_PORTS: readonly PortSpec[] = [
  { q: -2, r: -1, side: 2, type: 'generic' },
  { q: 0, r: -2, side: 5, type: 'ore' },
  { q: 3, r: -2, side: 1, type: 'generic' },
  { q: 2, r: -1, side: 4, type: 'brick' },
  { q: -3, r: 1, side: 1, type: 'lumber' },
  { q: -3, r: 1, side: 4, type: 'generic' },
  { q: -2, r: 2, side: 5, type: 'wool' },
  { q: 0, r: 2, side: 2, type: 'generic' },
  { q: 2, r: 1, side: 5, type: 'grain' },
];

// ---------------------------------------------------------------------------
// 4 人 — SF25 p. 7
// ---------------------------------------------------------------------------

const FI4_LAND: readonly LandHex[] = [
  // 島 2（左上）
  L(0, -3, 'pasture', 8, 2), L(-1, -2, 'hills', 10, 2), L(-2, -1, 'fields', 5, 2), L(-1, -1, 'forest', 3, 2),
  // 島 3（右上；(0,0) 與 (1,-1) 共邊，所以是 8 格）
  L(2, -3, 'forest', 9, 3), L(3, -3, 'forest', 11, 3), L(1, -2, 'mountains', 3, 3), L(2, -2, 'fields', 12, 3),
  L(3, -2, 'pasture', 5, 3), L(1, -1, 'hills', 5, 3), L(2, -1, 'mountains', 10, 3), L(0, 0, 'forest', 6, 3),
  // 島 4（左下）
  L(-3, 1, 'hills', 4, 4), L(-2, 1, 'pasture', 9, 4), L(-3, 2, 'fields', 6, 4), L(-2, 2, 'mountains', 4, 4),
  L(-1, 2, 'hills', 2, 4), L(-3, 3, 'pasture', 10, 4), L(-2, 3, 'fields', 11, 4),
  // 島 5（右下）
  L(1, 1, 'forest', 9, 5), L(2, 1, 'pasture', 11, 5), L(1, 2, 'mountains', 8, 5), L(0, 3, 'fields', 4, 5),
];

const FI4_PORTS: readonly PortSpec[] = [
  { q: -1, r: -2, side: 3, type: 'grain' },
  { q: -2, r: -1, side: 5, type: 'generic' },
  { q: 0, r: 0, side: 2, type: 'generic' },
  { q: 3, r: -2, side: 5, type: 'lumber' },
  { q: 2, r: 1, side: 2, type: 'ore' },
  { q: 2, r: 1, side: 5, type: 'generic' },
  { q: -2, r: 2, side: 1, type: 'generic' },
  { q: -3, r: 1, side: 4, type: 'brick' },
  { q: -3, r: 3, side: 3, type: 'wool' },
];

// ---------------------------------------------------------------------------
// Through the Desert（穿越荒漠）— SF25 pp. 10–11
// ---------------------------------------------------------------------------
//
// 島編號：1 = 主島（含三塊沙漠 (1,-3)、(0,-2)、(-1,-1)，沙漠歸主島）；2 = 被沙漠隔出的
// 陸地帶（綠框 (0,-3)、(-1,-2)、(-2,-1)）；3、4、5 = 東北、東、東南小島（深藍框）。
// 島 2–5 是四處 unexplored region。強盜起始在沙漠 (0,-2)；海盜棋子兩圖都在上方框上。
// 兩份獨立轉錄的格、港口逐項一致，見 docs/aegis/work/2026-11-23-seafarers-through-the-desert.md。

/** 3 人（p. 10）：35 格外框（`NS3_CELLS`），25 格陸地。 */
const TD3_LAND: readonly LandHex[] = [
  // 主島（含三塊沙漠）
  L(1, -3, 'desert', null, 1), L(0, -2, 'desert', null, 1), L(1, -2, 'forest', 4, 1),
  L(-1, -1, 'desert', null, 1), L(0, -1, 'hills', 5, 1), L(1, -1, 'pasture', 6, 1),
  L(-1, 0, 'mountains', 3, 1), L(0, 0, 'forest', 10, 1), L(-3, 1, 'forest', 11, 1),
  L(-2, 1, 'hills', 6, 1), L(-1, 1, 'fields', 2, 1), L(0, 1, 'hills', 9, 1),
  L(-3, 2, 'mountains', 10, 1), L(-2, 2, 'fields', 9, 1), L(-1, 2, 'forest', 8, 1),
  L(-3, 3, 'pasture', 8, 1), L(-2, 3, 'pasture', 4, 1),
  // 島 2：被沙漠隔出的陸地帶（綠框，unexplored region）
  L(0, -3, 'gold', 4, 2), L(-1, -2, 'forest', 3, 2), L(-2, -1, 'fields', 6, 2),
  // 島 3（東北小島）
  L(3, -3, 'mountains', 8, 3), L(3, -2, 'pasture', 12, 3),
  // 島 4（東側小島）
  L(2, 0, 'gold', 5, 4),
  // 島 5（東南小島）
  L(1, 2, 'fields', 9, 5), L(0, 3, 'mountains', 5, 5),
];

/** 港口依 side（0 E … 5 SE）；(0,1) 一格有兩個港口，(-3,3) 的兩個與 (-3,1) 的朝向框。 */
const TD3_PORTS: readonly PortSpec[] = [
  { q: 1, r: -2, side: 1, type: 'lumber' },
  { q: 0, r: 1, side: 1, type: 'generic' },
  { q: 0, r: 1, side: 5, type: 'generic' },
  { q: -2, r: 3, side: 0, type: 'generic' },
  { q: -3, r: 3, side: 5, type: 'brick' },
  { q: -3, r: 3, side: 3, type: 'ore' },
  { q: -3, r: 1, side: 4, type: 'wool' },
  { q: -2, r: 1, side: 2, type: 'grain' },
];

/** 4 人（p. 11）：42 格外框（`NS4_CELLS`），30 格陸地。 */
const TD4_LAND: readonly LandHex[] = [
  // 主島（含三塊沙漠）
  L(1, -3, 'desert', null, 1), L(2, -3, 'forest', 5, 1), L(0, -2, 'desert', null, 1),
  L(1, -2, 'hills', 3, 1), L(2, -2, 'pasture', 6, 1), L(-1, -1, 'desert', null, 1),
  L(0, -1, 'mountains', 8, 1), L(1, -1, 'fields', 10, 1), L(2, -1, 'forest', 4, 1),
  L(-1, 0, 'forest', 10, 1), L(0, 0, 'hills', 11, 1), L(1, 0, 'pasture', 9, 1),
  L(-3, 1, 'hills', 12, 1), L(-2, 1, 'hills', 6, 1), L(-1, 1, 'fields', 5, 1),
  L(0, 1, 'forest', 8, 1), L(-3, 2, 'pasture', 3, 1), L(-2, 2, 'pasture', 11, 1),
  L(-1, 2, 'mountains', 4, 1), L(-2, 3, 'forest', 9, 1),
  // 島 2：被沙漠隔出的陸地帶（綠框，unexplored region）
  L(0, -3, 'gold', 10, 2), L(-1, -2, 'mountains', 11, 2), L(-2, -1, 'fields', 8, 2),
  // 島 3（東北小島）
  L(4, -3, 'mountains', 9, 3), L(4, -2, 'fields', 4, 3), L(4, -1, 'hills', 2, 3),
  // 島 4（東側小島）
  L(2, 1, 'gold', 5, 4), L(3, 1, 'pasture', 3, 4),
  // 島 5（東南小島）
  L(0, 3, 'mountains', 6, 5), L(1, 3, 'fields', 12, 5),
];

const TD4_PORTS: readonly PortSpec[] = [
  { q: 2, r: -3, side: 0, type: 'brick' },
  { q: 2, r: -1, side: 1, type: 'generic' },
  { q: 2, r: -1, side: 5, type: 'generic' },
  { q: 0, r: 1, side: 5, type: 'generic' },
  { q: -2, r: 3, side: 0, type: 'lumber' },
  { q: -2, r: 3, side: 4, type: 'generic' },
  { q: -3, r: 2, side: 5, type: 'ore' },
  { q: -3, r: 2, side: 3, type: 'grain' },
  { q: -1, r: 0, side: 3, type: 'wool' },
];

/** 穿越荒漠的 topology：外框依人數不同（3 人 35 格、4 人 42 格），不是依劇本。 */
export const DESERT_TOPOLOGY_CELLS = { 3: 35, 4: 42 } as const;

export function throughTheDesertTopologyId(playerCount: number): string {
  if (playerCount === 3) return 'sf-through-the-desert-3';
  if (playerCount === 4) return 'sf-through-the-desert-4';
  throw new Error(`Through the Desert has no ${playerCount}-player map`);
}

/** Layout builder，登記為 `sf-through-the-desert`；以格數檢查選到的外框。 */
export function throughTheDesertLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = checkedTopology(topologyFor, throughTheDesertTopologyId(context.playerCount), context.playerCount === 3 ? DESERT_TOPOLOGY_CELLS[3] : DESERT_TOPOLOGY_CELLS[4]);
  const [land, ports] = context.playerCount === 3 ? [TD3_LAND, TD3_PORTS] : [TD4_LAND, TD4_PORTS];
  // 強盜在沙漠 (0,-2)；海盜在框上（`pirate: null`）。
  if (context.mode === 'variable') {
    // SF25 p. 11 variable setup：沙漠固定，主島與外地隨機，紅色圓片不相鄰、不在金礦上。
    const board = variableDesertBoard(topology.hexes, land, ports, context.rng);
    return fixedLayout(topology, board.land, board.ports, { q: 0, r: -2 });
  }
  return fixedLayout(topology, land, ports, { q: 0, r: -2 });
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 10–11）。 */
export const THROUGH_THE_DESERT_SOURCE = {
  3: { land: TD3_LAND, ports: TD3_PORTS, cells: NS3_CELLS.length },
  4: { land: TD4_LAND, ports: TD4_PORTS, cells: NS4_CELLS.length },
} as const;

// ---------------------------------------------------------------------------
// The Forgotten Tribe（世外部落）— SF25 pp. 12–13
// ---------------------------------------------------------------------------
//
// 3 人與 4 人共用同一張圖（SF25 只有一張）。外框 49 格，rows 6-7-8-7-8-7-6；中排兩端的
// 突出部是框，不是格（與 New Shores 同慣例，故配件表是 49 格而不是 51）。
// 座標：轉錄原點是「最上排 r=0、該排最左 q=0」，這裡一次平移 (dq, dr) = (-1, -3)，
// 讓中排中央附近為 (0,0)（與 NS3／NS4 的置中慣例一致）。逐格表與雙人轉錄比對見
// docs/aegis/work/2026-11-23-seafarers-forgotten-tribe.md。
//
// 島編號：1 = 大島（中間三排共 18 格，全有圓片）；2、3 = 上排左右小島；4、5 = 右側兩個單格；
// 6、7 = 下排左右小島。小島 12 格全無圓片（含三塊沙漠與兩塊金礦）。
// 強盜放在任一沙漠（layout builder 以 `rng` 決定並寫進 layout）；海盜在海格 (1,-3)。

/** 轉錄座標平移到置中座標。 */
const FT_SHIFT = { dq: -1, dr: -3 } as const;

/** 49 格外框：每排 [q 起, q 迄]（置中座標，中排兩端的框突出部不是格）。 */
const FT_ROWS: Readonly<Record<number, readonly [number, number]>> = {
  [-3]: [-1, 4], [-2]: [-2, 4], [-1]: [-3, 4], 0: [-3, 3], 1: [-4, 3], 2: [-4, 2], 3: [-4, 1],
};

export const FT_CELLS: readonly HexCoord[] = Object.entries(FT_ROWS).flatMap(([r, [from, to]]) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ q: from + index, r: Number(r) })));

/** 轉錄座標（原點在左上）轉成置中座標。 */
const ft = (q: number, r: number, terrain: LandHex['terrain'], number: number | null, island: number): LandHex =>
  L(q + FT_SHIFT.dq, r + FT_SHIFT.dr, terrain, number, island);

const FT_LAND: readonly LandHex[] = [
  // 島 2、3（上排小島）
  ft(0, 0, 'gold', null, 2), ft(1, 0, 'mountains', null, 2),
  ft(3, 0, 'desert', null, 3), ft(4, 0, 'mountains', null, 3), ft(5, 0, 'fields', null, 3),
  // 大島（島 1）：r=2..4 共 18 格，全有圓片
  ft(-2, 2, 'fields', 6, 1), ft(-1, 2, 'forest', 9, 1), ft(0, 2, 'mountains', 11, 1),
  ft(1, 2, 'hills', 5, 1), ft(2, 2, 'forest', 6, 1), ft(3, 2, 'mountains', 4, 1),
  ft(-2, 3, 'pasture', 10, 1), ft(-1, 3, 'hills', 8, 1), ft(0, 3, 'pasture', 4, 1),
  ft(1, 3, 'fields', 12, 1), ft(2, 3, 'forest', 5, 1), ft(3, 3, 'pasture', 2, 1),
  ft(-3, 4, 'forest', 11, 1), ft(-2, 4, 'fields', 9, 1), ft(-1, 4, 'mountains', 3, 1),
  ft(0, 4, 'pasture', 8, 1), ft(1, 4, 'hills', 10, 1), ft(2, 4, 'fields', 3, 1),
  // 島 4、5（右側單格）
  ft(5, 2, 'pasture', null, 4), ft(4, 4, 'forest', null, 5),
  // 島 6、7（下排小島）
  ft(-3, 6, 'desert', null, 6), ft(-2, 6, 'hills', null, 6),
  ft(0, 6, 'hills', null, 7), ft(1, 6, 'desert', null, 7), ft(2, 6, 'gold', null, 7),
];

/** 海盜起始的海格（轉錄 (2,0)，圖上畫在上排兩小島之間）。 */
const FT_PIRATE: HexCoord = { q: 2 + FT_SHIFT.dq, r: 0 + FT_SHIFT.dr };

export type GiftKind = 'vp' | 'devcard' | 'port';

/** 禮物位置：陸地格與框之間的邊（`side` 依 topology 的 0 E … 5 SE，朝向框）。 */
export interface GiftSpec extends HexCoord {
  kind: GiftKind;
  side: number;
}

const gift = (kind: GiftKind, q: number, r: number, side: number): GiftSpec =>
  ({ kind, q: q + FT_SHIFT.dq, r: r + FT_SHIFT.dr, side });

/** 18 個禮物位置：8 VP 標記、4 發展牌、6 港口（港口順序即 topology 的 harborSlots 順序）。 */
export const FT_GIFTS: readonly GiftSpec[] = [
  gift('vp', 0, 0, 1), gift('vp', 3, 0, 1), gift('vp', 5, 0, 1), gift('vp', 5, 2, 0),
  gift('vp', 4, 4, 0), gift('vp', -3, 6, 5), gift('vp', 0, 6, 4), gift('vp', 2, 6, 5),
  gift('devcard', 0, 0, 3), gift('devcard', 5, 0, 0), gift('devcard', -3, 6, 3), gift('devcard', 2, 6, 0),
  gift('port', 0, 0, 2), gift('port', 3, 0, 2), gift('port', 5, 2, 1),
  gift('port', 4, 4, 5), gift('port', -3, 6, 4), gift('port', 0, 6, 5),
];

const FT_PORT_SLOTS = FT_GIFTS.filter((spec) => spec.kind === 'port').map(({ q, r, side }) => ({ q, r, side }));

/** 禮物位置的邊索引（陸地格與框之間的邊）。 */
export function giftEdges(topology: BoardTopology): { edge: number; kind: GiftKind }[] {
  return FT_GIFTS.map((spec) => {
    const hex = topology.hexes.findIndex((candidate) => candidate.q === spec.q && candidate.r === spec.r);
    const dir = NEIGHBOR_DIRS[spec.side];
    if (hex < 0 || !dir) throw new Error(`forgotten tribe: bad gift ${spec.kind} ${spec.q},${spec.r}/${spec.side}`);
    const a = hexCenter(spec);
    const b = hexCenter({ q: spec.q + dir.q, r: spec.r + dir.r });
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const edge = topology.edges.findIndex((candidate) =>
      candidate.hexes.includes(hex) && Math.abs(candidate.x - mx) < 1e-4 && Math.abs(candidate.y - my) < 1e-4);
    if (edge < 0) throw new Error(`forgotten tribe: gift ${spec.kind} ${spec.q},${spec.r}/${spec.side} has no edge`);
    return { edge, kind: spec.kind };
  });
}

export const FORGOTTEN_TRIBE_TOPOLOGY_ID = 'sf-forgotten-tribe';

/** 2:1 港口 5 個（各一種資源）加 3:1 港口 1 個（SF25 p. 12 配件表）。 */
export const FT_PORT_TOKENS: readonly HarborType[] = ['lumber', 'brick', 'wool', 'grain', 'ore', 'generic'];

/** Layout builder，登記為 `sf-forgotten-tribe`：3 人與 4 人同一張圖；強盜隨機放在三塊沙漠之一。 */
export function forgottenTribeLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = checkedTopology(topologyFor, FORGOTTEN_TRIBE_TOPOLOGY_ID, 49);
  const deserts = FT_LAND.filter((hex) => hex.terrain === 'desert');
  const robber = deserts[context.rng.int(deserts.length)]!;
  const layout = fixedLayout(topology, FT_LAND, [], robber);
  layout.pirate = topology.hexes.findIndex((hex) => hex.q === FT_PIRATE.q && hex.r === FT_PIRATE.r);
  return layout;
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 12–13）。 */
export const FORGOTTEN_TRIBE_SOURCE = {
  land: FT_LAND, gifts: FT_GIFTS, cells: FT_CELLS.length, pirate: FT_PIRATE, shift: FT_SHIFT,
} as const;

// ---------------------------------------------------------------------------
// Cloth for Catan（布匹產地）— SF25 pp. 14–15
// ---------------------------------------------------------------------------
//
// 3 人與 4 人共用同一張圖（SF25 只有一張，跨 pp. 14–15）。外框 42 格，rows 5-6-7-6-7-6-5，
// 與 `NS4_CELLS` 完全同形（中排兩端的突出部是框，不是格），所以沿用 `NS4_CELLS`，只是港口位置不同。
// 座標：轉錄原點是「最上排 r=0、該排最左 q=0」，這裡一次平移 (dq, dr) = (0, -3)：
// 轉錄各排的 q 範圍（0..4、-1..4、-2..4、-2..3、-3..3、-3..2、-3..1）與 `NS4_CELLS` 逐排一致，
// 所以 q 不變、r 減 3。逐格表與雙人轉錄比對見 docs/aegis/work/2026-11-24-seafarers-cloth-for-catan.md。
//
// 島編號：1 = 北大島（10 格）；2、3、4、5 = 四座單格小島（金礦、沙漠、沙漠、金礦，格上沒有圓片）；
// 6 = 南大島（10 格）。強盜起始在 12 號圓片格 (-2,-1)（轉錄 (-2,2)）；海盜棋子在右側框突出部上
//（`pirate: null`，與 S1 相同）。

/** 轉錄座標平移到 `NS4_CELLS` 座標。 */
const CFC_SHIFT = { dq: 0, dr: -3 } as const;

export const CLOTH_FOR_CATAN_TOPOLOGY_ID = 'sf-cloth-for-catan';

/** 轉錄座標（原點在左上）轉成 repo 座標。 */
const cf = (q: number, r: number, terrain: LandHex['terrain'], number: number | null, island: number): LandHex =>
  L(q + CFC_SHIFT.dq, r + CFC_SHIFT.dr, terrain, number, island);

const CFC_LAND: readonly LandHex[] = [
  // 島 1：北大島（沿外框北緣呈弧形）
  cf(0, 0, 'forest', 4, 1), cf(1, 0, 'pasture', 6, 1), cf(2, 0, 'hills', 5, 1), cf(3, 0, 'pasture', 11, 1),
  cf(4, 0, 'fields', 8, 1), cf(-1, 1, 'fields', 3, 1), cf(0, 1, 'forest', 12, 1), cf(3, 1, 'forest', 3, 1),
  cf(4, 1, 'mountains', 9, 1), cf(-2, 2, 'fields', 12, 1),
  // 島 2–5：四座單格小島（無圓片）
  cf(1, 2, 'gold', null, 2), cf(-1, 3, 'desert', null, 3), cf(2, 3, 'desert', null, 4), cf(0, 4, 'gold', null, 5),
  // 島 6：南大島
  cf(3, 4, 'mountains', 2, 6), cf(-3, 5, 'hills', 9, 6), cf(-2, 5, 'fields', 2, 6), cf(1, 5, 'pasture', 11, 6),
  cf(2, 5, 'mountains', 4, 6), cf(-3, 6, 'pasture', 10, 6), cf(-2, 6, 'forest', 6, 6), cf(-1, 6, 'mountains', 5, 6),
  cf(0, 6, 'fields', 10, 6), cf(1, 6, 'hills', 8, 6),
];

/** 小島的島編號（不得蓋村落、強盜不可進入）。 */
export const CFC_SMALL_ISLANDS: readonly number[] = [2, 3, 4, 5];

/**
 * 9 個港口位置（全部貼在陸地格朝向框的邊上，type 都是「?」）。順序即 topology 的 `harborSlots`；
 * 種類是 5 個 2:1（各一種資源）+ 4 個 3:1，由 layout builder 以 game rng 洗牌。
 */
const CFC_PORT_SLOTS: readonly HarborSlotSpec[] = [
  { q: 0, r: -3, side: 1 }, { q: 3, r: -3, side: 2 }, { q: -1, r: -2, side: 3 },
  { q: 4, r: -2, side: 0 }, { q: 3, r: 1, side: 0 }, { q: -3, r: 2, side: 3 },
  { q: 2, r: 2, side: 5 }, { q: 0, r: 3, side: 5 }, { q: -2, r: 3, side: 4 },
];

export const CFC_PORT_TOKENS: readonly HarborType[] = ['lumber', 'brick', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic'];

/**
 * 8 個部落（村落）圓片：印在小島格正上與正下的頂點。`hexes` 是共用該頂點的三格（轉錄座標已平移）；
 * 順序固定（索引即 module state 的部落編號）。數字對 (11,8)、(10,9)、(4,5)、(6,3)。
 */
export interface TribeSpec {
  number: number;
  /** 共用該頂點的三格（含小島格與兩個海格）。 */
  hexes: readonly HexCoord[];
}

const tribe = (number: number, cells: readonly (readonly [number, number])[]): TribeSpec =>
  ({ number, hexes: cells.map(([q, r]) => ({ q: q + CFC_SHIFT.dq, r: r + CFC_SHIFT.dr })) });

export const CFC_TRIBES: readonly TribeSpec[] = [
  tribe(10, [[-1, 3], [-1, 2], [0, 2]]), tribe(9, [[-1, 3], [-1, 4], [-2, 4]]),
  tribe(11, [[1, 2], [1, 1], [2, 1]]), tribe(8, [[1, 2], [1, 3], [0, 3]]),
  tribe(6, [[0, 4], [0, 3], [1, 3]]), tribe(3, [[0, 4], [0, 5], [-1, 5]]),
  tribe(4, [[2, 3], [2, 2], [3, 2]]), tribe(5, [[2, 3], [2, 4], [1, 4]]),
];

/** 部落的頂點索引（依 `CFC_TRIBES` 順序）：找出恰好由那三格共用的頂點。 */
export function tribeVertices(topology: BoardTopology): number[] {
  return CFC_TRIBES.map((spec) => {
    const hexes = spec.hexes.map((cell) => topology.hexes.findIndex((hex) => hex.q === cell.q && hex.r === cell.r));
    const vertex = topology.vertices.findIndex((info) =>
      info.hexes.length === hexes.length && hexes.every((hex) => info.hexes.includes(hex)));
    if (vertex < 0 || hexes.some((hex) => hex < 0)) throw new Error(`cloth for catan: tribe ${spec.number} has no vertex`);
    return vertex;
  });
}

/** 每個部落開局的布匹數與一般供應堆（SF25 p. 14：8 × 5 + 10 = 50）。 */
export const CFC_TRIBE_CLOTH = 5;
export const CFC_SUPPLY_CLOTH = 10;

/** Layout builder，登記為 `sf-cloth-for-catan`：3 人與 4 人同一張圖；港口種類以 game rng 洗牌。 */
export function clothForCatanLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = checkedTopology(topologyFor, CLOTH_FOR_CATAN_TOPOLOGY_ID, 42);
  const tokens = shuffle(CFC_PORT_TOKENS, context.rng);
  const ports: PortSpec[] = CFC_PORT_SLOTS.map((slot, index) => ({ ...slot, type: tokens[index]! }));
  // 強盜在 12 號圓片格 (-2,2)（轉錄座標）；海盜在框上（`pirate: null`）。
  return fixedLayout(topology, CFC_LAND, ports, { q: -2 + CFC_SHIFT.dq, r: 2 + CFC_SHIFT.dr });
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 14–15）。 */
export const CLOTH_FOR_CATAN_SOURCE = {
  land: CFC_LAND, portSlots: CFC_PORT_SLOTS, tribes: CFC_TRIBES, cells: NS4_CELLS.length, shift: CFC_SHIFT,
} as const;

// ---------------------------------------------------------------------------
// The Wonders of Catan（卡坦奇觀）— SF25 pp. 18–19
// ---------------------------------------------------------------------------
//
// 3 人與 4 人共用同一張圖（SF25 只有一張，跨 pp. 18–19）。外框 49 格，rows 6-7-8-7-8-7-6，
// 與世外部落（`FT_CELLS`）完全同形，所以共用 hex 清單與同一個平移 (dq, dr) = (-1, -3)；
// 港口位置不同（9 個），故登記自己的 topology id `sf-wonders-of-catan`。逐格表與雙人轉錄比對見
// docs/aegis/work/2026-11-24-seafarers-wonders-of-catan.md。
//
// 島編號：1 = 大島（25 格，含 3 塊沙漠）；2 = 西北小島（金礦與丘陵）；3 = 東南小島（金礦、森林、田野）。
// 強盜放在任一沙漠（layout builder 以 `rng` 決定並寫進 layout）；海盜不使用（`pirate: null`）。

export const WONDERS_OF_CATAN_TOPOLOGY_ID = 'sf-wonders-of-catan';

/** 轉錄座標平移到置中座標（與 `FT_SHIFT` 相同）。 */
const WC_SHIFT = { dq: -1, dr: -3 } as const;

const wc = (q: number, r: number, terrain: LandHex['terrain'], number: number | null, island: number): LandHex =>
  L(q + WC_SHIFT.dq, r + WC_SHIFT.dr, terrain, number, island);

const WC_LAND: readonly LandHex[] = [
  wc(0, 0, 'gold', 8, 2), wc(1, 0, 'hills', 2, 2), wc(3, 0, 'mountains', 10, 1),
  wc(2, 1, 'forest', 11, 1), wc(4, 1, 'desert', null, 1),
  wc(-2, 2, 'mountains', 12, 1), wc(-1, 2, 'fields', 6, 1), wc(0, 2, 'hills', 11, 1), wc(1, 2, 'fields', 10, 1),
  wc(2, 2, 'pasture', 3, 1), wc(3, 2, 'forest', 9, 1), wc(4, 2, 'desert', null, 1),
  wc(-2, 3, 'mountains', 3, 1), wc(-1, 3, 'fields', 4, 1), wc(0, 3, 'mountains', 6, 1), wc(1, 3, 'pasture', 5, 1),
  wc(2, 3, 'hills', 4, 1), wc(3, 3, 'desert', null, 1),
  wc(-3, 4, 'hills', 8, 1), wc(-2, 4, 'pasture', 9, 1), wc(1, 4, 'hills', 10, 1), wc(4, 4, 'gold', 6, 3),
  wc(-2, 5, 'forest', 3, 1), wc(0, 5, 'forest', 8, 1), wc(1, 5, 'fields', 9, 1), wc(3, 5, 'forest', 4, 3),
  wc(-3, 6, 'mountains', 5, 1), wc(-1, 6, 'pasture', 11, 1), wc(0, 6, 'pasture', 2, 1), wc(2, 6, 'fields', 5, 3),
];

/** 9 個港口位置（貼在陸地格朝向框的邊，圖上全是「?」）；種類是 5 個 2:1（各一種資源）+ 4 個 3:1，由 layout builder 洗牌。 */
const wcPort = (q: number, r: number, side: number): HarborSlotSpec => ({ q: q + WC_SHIFT.dq, r: r + WC_SHIFT.dr, side });
const WC_PORT_SLOTS: readonly HarborSlotSpec[] = [
  wcPort(-1, 3, 5), wcPort(1, 2, 2), wcPort(-1, 2, 2), wcPort(2, 2, 1),
  wcPort(-2, 3, 3), wcPort(-2, 5, 3), wcPort(1, 5, 1), wcPort(1, 5, 5), wcPort(-1, 6, 5),
];

export const WC_PORT_TOKENS: readonly HarborType[] = ['lumber', 'brick', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic'];

/** 設置禁設點與奇觀施工位置的標記（都是交叉點；`hexes` 是共用該點、在版圖內的格，轉錄座標）。 */
export type WonderMarkerKind = 'greatWall' | 'greatBridge' | 'x';

export interface WonderMarkerSpec {
  kind: WonderMarkerKind;
  hexes: readonly (readonly [number, number])[];
}

export const WC_MARKERS: readonly WonderMarkerSpec[] = [
  // Great Wall：沿 (3,2) 森林與三塊沙漠之間的 5 個交叉點（兩人轉錄一致）。
  { kind: 'greatWall', hexes: [[3, 2], [3, 1], [4, 1]] },
  { kind: 'greatWall', hexes: [[3, 2], [4, 1], [4, 2]] },
  { kind: 'greatWall', hexes: [[3, 2], [4, 2], [3, 3]] },
  { kind: 'greatWall', hexes: [[3, 2], [3, 3], [2, 3]] },
  { kind: 'greatWall', hexes: [[2, 3], [3, 3], [2, 4]] },
  // Great Bridge：海格 (-1,5)、(-2,6) 共用邊的兩端。
  { kind: 'greatBridge', hexes: [[-2, 5], [-1, 5], [-2, 6]] },
  { kind: 'greatBridge', hexes: [[-1, 6], [-2, 6], [-1, 5]] },
  // X：Great Bridge 兩端各自旁邊的交叉點（設置禁設點，不是施工位置）。
  { kind: 'x', hexes: [[-2, 5], [-1, 4], [-1, 5]] },
  { kind: 'x', hexes: [[-2, 5], [-2, 6], [-3, 6]] },
  { kind: 'x', hexes: [[-1, 6], [-1, 5], [0, 5]] },
  // 第三格 (-2,7) 在下緣框外，所以只有兩格。
  { kind: 'x', hexes: [[-1, 6], [-2, 6]] },
];

/** 標記的頂點索引：找出恰好由那幾格共用的頂點（轉錄座標平移後）。 */
export function wonderMarkerVertices(topology: BoardTopology): Record<WonderMarkerKind, number[]> {
  const out: Record<WonderMarkerKind, number[]> = { greatWall: [], greatBridge: [], x: [] };
  for (const spec of WC_MARKERS) {
    const hexes = spec.hexes.map(([q, r]) => topology.hexes.findIndex((hex) => hex.q === q + WC_SHIFT.dq && hex.r === r + WC_SHIFT.dr));
    const vertex = topology.vertices.findIndex((info) => info.hexes.length === hexes.length && hexes.every((hex) => info.hexes.includes(hex)));
    if (vertex < 0 || hexes.some((hex) => hex < 0)) throw new Error(`wonders of catan: ${spec.kind} marker ${JSON.stringify(spec.hexes)} has no vertex`);
    out[spec.kind].push(vertex);
  }
  return out;
}

/** Layout builder，登記為 `sf-wonders-of-catan`：3 人與 4 人同一張圖；港口種類以 game rng 洗牌，強盜隨機放在三塊沙漠之一。 */
export function wondersOfCatanLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = checkedTopology(topologyFor, WONDERS_OF_CATAN_TOPOLOGY_ID, 49);
  const tokens = shuffle(WC_PORT_TOKENS, context.rng);
  const ports: PortSpec[] = WC_PORT_SLOTS.map((slot, index) => ({ ...slot, type: tokens[index]! }));
  const deserts = WC_LAND.filter((hex) => hex.terrain === 'desert');
  const robber = deserts[context.rng.int(deserts.length)]!;
  // 海盜不使用（SF25 p. 18「Return the pirate to the box」）：`pirate: null`。
  return fixedLayout(topology, WC_LAND, ports, robber);
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 18–19）。 */
export const WONDERS_OF_CATAN_SOURCE = {
  land: WC_LAND, portSlots: WC_PORT_SLOTS, markers: WC_MARKERS, cells: FT_CELLS.length, shift: WC_SHIFT,
} as const;

// ---------------------------------------------------------------------------
// topology 與 layout
// ---------------------------------------------------------------------------

const slots = (ports: readonly PortSpec[]) => ports.map(({ q, r, side }) => ({ q, r, side }));

export const SCENARIO_TOPOLOGIES: readonly TopologyDefinition[] = [
  { id: 'sf-four-islands-3', hexes: NS3_CELLS, harborSlots: slots(FI3_PORTS) },
  { id: 'sf-four-islands-4', hexes: NS3_CELLS, harborSlots: slots(FI4_PORTS) },
  { id: 'sf-through-the-desert-3', hexes: NS3_CELLS, harborSlots: slots(TD3_PORTS) },
  { id: 'sf-through-the-desert-4', hexes: NS4_CELLS, harborSlots: slots(TD4_PORTS) },
  { id: FORGOTTEN_TRIBE_TOPOLOGY_ID, hexes: FT_CELLS, harborSlots: FT_PORT_SLOTS },
  { id: CLOTH_FOR_CATAN_TOPOLOGY_ID, hexes: NS4_CELLS, harborSlots: CFC_PORT_SLOTS.map(({ q, r, side }) => ({ q, r, side })) },
  { id: WONDERS_OF_CATAN_TOPOLOGY_ID, hexes: FT_CELLS, harborSlots: WC_PORT_SLOTS.map(({ q, r, side }) => ({ q, r, side })) },
];

/** 四島群島：3 人與 4 人都是 35 格外框，依人數選港口位置不同的 topology。 */
export function fourIslandsTopologyId(playerCount: number): string {
  if (playerCount === 3) return 'sf-four-islands-3';
  if (playerCount === 4) return 'sf-four-islands-4';
  throw new Error(`The Four Islands has no ${playerCount}-player map`);
}

/** 以格數檢查選到的 topology 是 35 格外框（spec §7.3）。 */
function checkedTopology(topologyFor: (id: string) => BoardTopology, id: string, cells: number): BoardTopology {
  const topology = topologyFor(id);
  if (topology.hexes.length !== cells) throw new Error(`topology ${id} has ${topology.hexes.length} hexes, expected ${cells}`);
  return topology;
}

/** Layout builder，登記為 `sf-four-islands`。 */
export function fourIslandsLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = checkedTopology(topologyFor, fourIslandsTopologyId(context.playerCount), 35);
  const [land, ports] = context.playerCount === 3 ? [FI3_LAND, FI3_PORTS] : [FI4_LAND, FI4_PORTS];
  if (context.mode === 'variable') {
    // SF25 p. 7 variable setup：陸地與圓片在四個島區內隨機，強盜放在 12 號圓片格。
    const board = variableFourIslandsBoard(land, ports, context.rng);
    const twelve = board.land.find((hex) => hex.number === 12)!;
    return fixedLayout(topology, board.land, board.ports, twelve);
  }
  return fixedLayout(topology, land, ports, context.playerCount === 3 ? { q: -3, r: 3 } : { q: 2, r: -2 });
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 6–7）。 */
export const FOUR_ISLANDS_SOURCE = {
  3: { land: FI3_LAND, ports: FI3_PORTS, cells: NS3_CELLS.length },
  4: { land: FI4_LAND, ports: FI4_PORTS, cells: NS3_CELLS.length },
} as const;
