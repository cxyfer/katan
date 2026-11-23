/**
 * Seafarers 其餘劇本的版圖（SF25 pp. 6–20，spec 2026-11-22-seafarers-scenarios.md §7.3）。
 *
 * 目前有 The Four Islands（四島群島）與 Through the Desert（穿越荒漠，SF25 pp. 10–11，
 * 外框依人數不同，見該節）。四島群島：
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
import type { BoardTopology, TopologyDefinition } from './topology.ts';
import type { BoardLayout } from './types.ts';

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
// 兩份獨立轉錄的格、港口逐項一致，見 docs/aegis/work/2026-11-22-seafarers-through-the-desert.md。

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
  // 強盜在沙漠 (0,-2)；海盜在框上（`pirate: null`）。
  return context.playerCount === 3
    ? fixedLayout(topology, TD3_LAND, TD3_PORTS, { q: 0, r: -2 })
    : fixedLayout(topology, TD4_LAND, TD4_PORTS, { q: 0, r: -2 });
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 10–11）。 */
export const THROUGH_THE_DESERT_SOURCE = {
  3: { land: TD3_LAND, ports: TD3_PORTS, cells: NS3_CELLS.length },
  4: { land: TD4_LAND, ports: TD4_PORTS, cells: NS4_CELLS.length },
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
  return context.playerCount === 3
    ? fixedLayout(topology, FI3_LAND, FI3_PORTS, { q: -3, r: 3 })
    : fixedLayout(topology, FI4_LAND, FI4_PORTS, { q: 2, r: -2 });
}

/** 轉錄的配件，供 fixture 測試使用（SF25 pp. 6–7）。 */
export const FOUR_ISLANDS_SOURCE = {
  3: { land: FI3_LAND, ports: FI3_PORTS, cells: NS3_CELLS.length },
  4: { land: FI4_LAND, ports: FI4_PORTS, cells: NS3_CELLS.length },
} as const;
