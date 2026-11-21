/**
 * 探索步的期望值（計畫 §4.3；E2）。只用公開資訊：霧格的剩餘庫存來自 `inventory.ts`，不讀牌堆（B-FAIR）。
 * 單位是勝利分當量：一張資源約 0.25 分，一座新島上的聚落約 1 分。
 */

import { EP_DISCOVERY_GOLD, type EpTile } from '@katan/rules';
import { fogAtEnds, type EpGeometry } from './geometry.ts';
import { tilesTotal, type remainingTiles } from './inventory.ts';

type Remaining = ReturnType<typeof remainingTiles>;

/** 產出資源的陸地 tile。 */
export const LAND_TILES: readonly EpTile[] = ['hills', 'forest', 'pasture', 'fields', 'mountains'];

/** 揭露陸地：一張資源加上日後的聚落點。 */
const LAND_VALUE = 0.35;
/** 揭露海或特殊格：2 金（約 0.8 張資源）。 */
const GOLD_VALUE = EP_DISCOVERY_GOLD * 0.1;
/** 手上有 settler 時，揭露到陸地可以立刻定居。 */
const SETTLE_BONUS = 0.6;

/** 某個霧格揭露成陸地的機率；沒有庫存資料時視為各半。 */
export function landOdds(g: EpGeometry, remaining: Remaining, hex: number): number {
  const region = g.ep.fog.find((entry) => entry.hex === hex)?.region;
  const counts = region ? remaining?.[region] : undefined;
  const total = counts ? tilesTotal(counts) : 0;
  if (!counts || total <= 0) return 0.5;
  return LAND_TILES.reduce((sum, tile) => sum + (counts[tile] ?? 0), 0) / total;
}

/** 剩餘庫存中是否還有陸地（沒有就不必再為了 settler 探索）。 */
export function landExpected(g: EpGeometry, remaining: Remaining): boolean {
  if (g.fog.size === 0) return false;
  if (!remaining) return true;
  return Object.values(remaining).some((counts) => LAND_TILES.some((tile) => (counts[tile] ?? 0) > 0));
}

/**
 * 走到 `edge` 會探索的期望值；沒有霧格回 0。easy 不算期望值，任何霧格都是 1（走最近的）。
 * `settler`：船上有 settler，揭露到陸地可以定居。
 */
export function exploreValue(
  g: EpGeometry,
  remaining: Remaining,
  edge: number,
  opts: { readonly settler: boolean; readonly standard: boolean },
): number {
  const fog = fogAtEnds(g, edge);
  if (fog.length === 0) return 0;
  if (!opts.standard) return 1;
  let value = 0;
  let none = 1;
  for (const hex of fog) {
    const land = landOdds(g, remaining, hex);
    value += land * LAND_VALUE + (1 - land) * GOLD_VALUE;
    none *= 1 - land;
  }
  return opts.settler ? value + (1 - none) * SETTLE_BONUS : value;
}
