/**
 * Seafarers 的經濟鉤子與計畫步驟（SF 計畫 §4.2）。
 *
 * - `costs`／`piecesLeft`：船的成本（`SHIP_COST`）與剩餘船數。
 * - `scoreExtras`：新增計畫種類「島嶼聚落」`seafarers.islandSettlement`：沿著船路徑登上小島上一個還沒有
 *   聚落的路口（主島上道路到不了的空點不算，由 base 的聚落計畫處理）。船路徑 ≤ 4 艘（easy ≤ 3）；成本是 `SHIP_COST × n + COSTS.settlement`，`nextCost` 是 `SHIP_COST`
 *   （銀行交易的目標），沒有船要造時下一步就是聚落，視為立即得分（可以主動開價）。分數含 +2 VP（這座小島
 *   還沒領過加分）與金礦的萬用點數；金礦在城市與聚落計畫的估值走 `economy.ts` 的通用機制，不在這裡。
 * - `planStep`：島嶼聚落的下一步，造船或登島後蓋聚落；一律取自 hints，不合法時回 null，骨架會繼續處理
 *   銀行交易與其他計畫。
 *
 * 決定性（P4）：不讀事件、不消耗亂數；候選依分數由高到低排序，同分取路口編號較小者，船路徑則由
 * `searchShips` 保證取 edge index 最小者。
 */

import { COSTS, MAIN_ISLAND, SHIP_COST } from '@catan/rules';
import { isFreeSpot, playerYield, roadPath } from '../../board.ts';
import {
  addCosts,
  etaRounds,
  PIP_VALUE,
  scaleCost,
  settlementSpotValue,
  type Plan,
} from '../../economy.ts';
import { islandsAt, searchShips, shipsLeft } from '../../sea.ts';
import type { BotEconomyHooks, BotModule, PlanInput } from '../types.ts';
import { moduleHints, moduleView } from '../view.ts';

/** 島嶼聚落的計畫種類（`<module id>.<名稱>`）。 */
export const ISLAND_SETTLEMENT = 'seafarers.islandSettlement' as const;

/** 小島加分（SF25 p. 4；rules 的 `ISLAND_BONUS` 沒有匯出）。 */
export const ISLAND_BONUS_VP = 2;

/** 計畫的船路徑長度上限：standard 4 艘，easy 3 艘（D-SF2）。 */
export const MAX_PLAN_SHIPS = 4;
export const EASY_MAX_PLAN_SHIPS = 3;

/** 每個計畫保留的候選數（與 base 的聚落計畫相同）。 */
const PLANS_KEPT = 3;

/** 每艘船讓計畫晚一些完成（輪數），與 base 每條道路的 0.35 相同。 */
export const ETA_PER_SHIP = 0.35;

export const seafarersEconomy: BotEconomyHooks = {
  costs: () => ({ ship: SHIP_COST }),
  piecesLeft: (model) => ({ ships: shipsLeft(model) }),
  scoreExtras: islandSettlementPlans,
};

/** 這個 view 還沒領過加分的小島之外，自己已領過的島嶼 id。 */
export function claimedIslands(model: PlanInput['model']): ReadonlySet<number> {
  return new Set(moduleView(model.view, 'seafarers')?.islandBonus?.[model.selfId] ?? []);
}

/** 路口上還沒領過加分的小島數（每座小島 +2 VP；只有 new-shores 劇本有這條規則）。 */
export function unclaimedIslandsAt(model: PlanInput['model'], vertex: number, claimed: ReadonlySet<number>): number {
  if (model.profile.scenario !== 'new-shores') return 0;
  return islandsAt(model, vertex).filter((island) => island !== MAIN_ISLAND && !claimed.has(island)).length;
}

/**
 * 島嶼聚落計畫。`base.left.ships` 是船路徑的容量上限：付費造船用真實的存量；移船（`actions.ts`）
 * 另以 `存量 + 1` 評估，因為移進來的那一艘不花船。
 */
export function islandSettlementPlans({ model, level, base }: PlanInput): Plan[] {
  const { view, selfId } = model;
  // `legalSettlements` 不扣聚落存量（N2），自己檢查。
  if (base.left.settlements <= 0) return [];
  const cap = Math.min(level === 'easy' ? EASY_MAX_PLAN_SHIPS : MAX_PLAN_SHIPS, Math.max(0, base.left.ships));
  const search = searchShips(model, selfId, cap);
  const legalNow = new Set(view.hints?.legalSettlements ?? []);
  const claimed = claimedIslands(model);
  const islandRules = model.profile.scenario === 'new-shores';
  const longTerm = playerYield(model, selfId, true);
  const players = view.players.length;
  const candidates: Plan[] = [];
  for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
    const ships = search.distance[vertex]!;
    if (ships === Infinity || ships > cap) continue;
    // 道路一樣近或更近：base 的聚落計畫已經涵蓋這個路口。
    if (base.search.distance[vertex]! <= ships) continue;
    if (!isFreeSpot(model, vertex)) continue;
    // 這是「島嶼」聚落：主島上道路到不了的空點不值得繞著海岸造船去（new-shores 才有主島的概念）。
    if (islandRules && !islandsAt(model, vertex).some((island) => island !== MAIN_ISLAND)) continue;
    // 船已經停在這裡：可以直接蓋，但必須是 hints 認可的位置。
    if (ships === 0 && !legalNow.has(vertex)) continue;
    const path = ships === 0 ? [] : roadPath(search, vertex);
    const cost = addCosts(scaleCost(SHIP_COST, ships), COSTS.settlement);
    // 越遠越可能被別人搶先，聚落本身的價值打折；小島加分每位玩家各領一次，不會被搶走，所以不打折。
    const settlement = (1 + PIP_VALUE * settlementSpotValue(model, vertex, base.weights, longTerm)) * 0.9 ** ships;
    const value = settlement + ISLAND_BONUS_VP * unclaimedIslandsAt(model, vertex, claimed);
    const eta = etaRounds(base.hand, cost, base.yield, base.rates, players, base.kinds) + ships * ETA_PER_SHIP;
    candidates.push({
      kind: ISLAND_SETTLEMENT,
      vertex,
      roads: [],
      ships: path,
      cost,
      nextCost: ships > 0 ? SHIP_COST : COSTS.settlement,
      value,
      eta,
      score: value / (1 + eta),
      immediate: ships === 0,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.vertex! - b.vertex!);
  return candidates.slice(0, PLANS_KEPT);
}

/** 島嶼聚落的下一步：船路徑的第一艘，抵達後在目標路口蓋聚落。模組對不屬於自己的計畫種類回 undefined。 */
export const seafarersPlanStep: NonNullable<BotModule['planStep']> = (turn, plan) => {
  if (plan.kind !== ISLAND_SETTLEMENT) return undefined;
  const { view, economy } = turn;
  const ships = plan.ships ?? [];
  if (ships.length > 0) {
    const edge = ships[0]!;
    const legal = moduleHints(view.hints, 'seafarers')?.legalShips ?? [];
    // `legalShips` 已扣船隻存量，但不檢查費用（骨架在呼叫前已確認 nextCost 付得起）。
    return legal.includes(edge) ? { type: 'build.ship', edge } : null;
  }
  const vertex = plan.vertex;
  if (vertex === null || !(view.hints?.legalSettlements ?? []).includes(vertex)) return null;
  return economy.left.settlements > 0 ? { type: 'build.settlement', vertex } : null;
};
