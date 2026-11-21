/**
 * 霧格的剩餘庫存（E1；E2 的探索期望值使用）。view 沒有牌堆，只能用公開資訊推導：
 * 每個區域的初始 tiles（`EP_SCENARIOS[sc].regions[R].tiles`）減去該區域已揭露的格子。
 * 已揭露格子的區域由地圖設定（`EP_SCENARIOS[sc].map`）的座標決定；tile 由 terrain 與 sites 還原。
 */

import { EP_SCENARIOS, type EpRegion, type EpTile } from '@katan/rules';
import type { EpGeometry } from './geometry.ts';

export type TileCounts = Partial<Record<EpTile, number>>;

const REGIONS: readonly EpRegion[] = ['parrot', 'goose'];

/** 揭露後的 tile：香料田的 terrain 是 desert，魚場與海都是 sea（以 site 區分）。 */
function tileOf(g: EpGeometry, hex: number): EpTile | undefined {
  const terrain = g.view.board.terrain[hex];
  const site = g.ep.sites.find((entry) => entry.hex === hex);
  if (terrain === 'sea') return site?.kind === 'shoal' ? 'shoal' : 'sea';
  if (terrain === 'desert') return site?.kind === 'spice' ? 'spice' : undefined;
  return terrain as EpTile | undefined;
}

/** 區域 `region` 的格子座標屬於哪一區（地圖格線 r → q 清單）。 */
function regionOf(map: Record<'parrot' | 'goose', Readonly<Record<number, readonly number[]>>>, q: number, r: number): EpRegion | null {
  for (const region of REGIONS) if (map[region][r]?.includes(q)) return region;
  return null;
}

/** 各區尚未揭露的 tile 數量（不會小於 0）；profile 不是 E&P 或資料缺漏時回 undefined。 */
export function remainingTiles(g: EpGeometry): Record<EpRegion, TileCounts> | undefined {
  const scenario = EP_SCENARIOS[g.ep.scenario];
  if (!scenario) return undefined;
  const left: Record<EpRegion, TileCounts> = { parrot: { ...scenario.regions.parrot.tiles }, goose: { ...scenario.regions.goose.tiles } };
  g.topo.hexes.forEach((coord, hex) => {
    if (g.fog.has(hex)) return;
    const region = regionOf(scenario.map, coord.q, coord.r);
    const tile = region ? tileOf(g, hex) : undefined;
    if (region && tile) left[region][tile] = Math.max(0, (left[region][tile] ?? 0) - 1);
  });
  return left;
}

/** 一個區域剩下的 tile 總數；用來檢查與 `V.regionsLeft` 一致。 */
export function tilesTotal(counts: TileCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
}

