/**
 * Seafarers 的經濟鉤子與計畫步驟（SF 計畫 §4.2）。
 *
 * - `costs`／`piecesLeft`：船的成本（`SHIP_COST`）與剩餘船數。
 * - `scoreExtras`：新增計畫種類「島嶼聚落」`seafarers.islandSettlement`：沿著船路徑登上小島上一個還沒有
 *   聚落的路口（主島上道路到不了的空點不算，由 base 的聚落計畫處理）。船路徑 ≤ 4 艘（easy ≤ 3）；成本是 `SHIP_COST × n + COSTS.settlement`，`nextCost` 是 `SHIP_COST`
 *   （銀行交易的目標），沒有船要造時下一步就是聚落，視為立即得分（可以主動開價）。分數含 +2 VP（這座小島
 *   還沒領過加分）與金礦的萬用點數；金礦在城市與聚落計畫的估值走 `economy.ts` 的通用機制，不在這裡。
 * - `scoreExtras` 的第二種計畫「沿海聚落」`seafarers.coastSettlement`（海路通達，#171）：見下方「海路通達」一節。
 * - `planStep`：島嶼聚落的下一步，造船或登島後蓋聚落；沿海聚落的下一步，造路或抵達後蓋聚落。一律取自 hints，
 *   不合法時回 null，骨架會繼續處理銀行交易與其他計畫。
 *
 * 決定性（P4）：不讀事件、不消耗亂數；候選依分數由高到低排序，同分取路口編號較小者，船路徑則由
 * `searchShips` 保證取 edge index 最小者。
 */

import { COSTS, MAIN_ISLAND, SHIP_COST } from '@catan/rules';
import { isFreeSpot, isSeaEdge, playerYield, roadPath, type BoardModel, type Yield } from '../../board.ts';
import {
  addCosts,
  etaRounds,
  PIP_VALUE,
  scaleCost,
  settlementSpotValue,
  type KindTable,
  type Plan,
} from '../../economy.ts';
import { islandsAt, searchShips, shipEdgesOf, shipsLeft } from '../../sea.ts';
import type { BotCommand, BotEconomyHooks, BotModule, PlanInput, TurnContext } from '../types.ts';
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
  // 島嶼計畫在前、沿海計畫在後：同分時保留這個順序（模組計畫同分不依路口編號重排）。
  scoreExtras: (input) => [...islandSettlementPlans(input), ...coastSettlementPlans(input)],
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
 * 島嶼聚落的價值（勝利分當量）：聚落本身依船數打折（越遠越可能被別人搶先），加上還沒領過的小島加分
 * （每位玩家各領一次，不會被搶走，所以不打折）。島嶼計畫與沿海計畫的出海價值共用這個公式。
 */
export function islandSiteValue(
  model: BoardModel,
  vertex: number,
  ships: number,
  weights: KindTable,
  longTerm: Yield,
  claimed: ReadonlySet<number>,
): number {
  const settlement = (1 + PIP_VALUE * settlementSpotValue(model, vertex, weights, longTerm)) * 0.9 ** ships;
  return settlement + ISLAND_BONUS_VP * unclaimedIslandsAt(model, vertex, claimed);
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
    const value = islandSiteValue(model, vertex, ships, base.weights, longTerm, claimed);
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

// ---------------------------------------------------------------------------
// 海路通達（#171）
// ---------------------------------------------------------------------------
//
// 船只能接在自己的建築或船上，不能接路（rules 的 `canPlaceShip`）。兩棟開局建築都在內陸、又還沒有船的玩家，
// 必須先在沿海、還有空海邊的路口蓋一座聚落才造得了船；base 的聚落計畫只看產能，不知道這一點，對手的路一旦
// 占住海岸，這位玩家就再也出不了海（3 人 sf-ck 對 naive 的看門狗停滯）。所以沒有出發點時，沿海空點另外以
// 「出海之後能登上的小島」估值，讓玩家修路到海邊，並在對手的路封住之前先蓋下去。已有出發點時不產生任何計畫。

/** 沿海聚落的計畫種類：修路到沿海空點蓋聚落，取得船的出發點。 */
export const COAST_SETTLEMENT = 'seafarers.coastSettlement' as const;

/**
 * 出海價值的比重：沿海聚落只是出發點，登島還要另外造船、另外蓋聚落（那些成本與輪數不在這個計畫裡），
 * 所以最佳島嶼計畫的價值只算一半。未經對局調校（推測），以 Q3 bench 驗證。
 */
export const ACCESS_WEIGHT = 0.5;

/** 每條道路讓計畫晚一些完成（輪數），與 base 的聚落計畫相同。 */
const ETA_PER_ROAD = 0.35;

/** 拿掉海盜的盤面：海盜會被移走，所以它旁邊的海邊仍算出發點，也仍是出海的路線。 */
function withoutPirate(model: BoardModel): BoardModel {
  if (model.view.board.pirate === null) return model;
  return { ...model, view: { ...model.view, board: { ...model.view.board, pirate: null } } };
}

/**
 * 自己現在有沒有船的出發點：自己的建築或船旁邊，有一條現在就能放船的海邊（`shipEdgesOf`，不看海盜）。
 * 只是估值用的模型；合法性仍以 `hints.modules.seafarers.legalShips` 為準。
 */
export function hasLaunchPoint(model: BoardModel, playerId: string = model.selfId): boolean {
  return shipEdgesOf(withoutPirate(model), playerId).length > 0;
}

/** `vertex` 旁邊空著、而且不在 `taken`（計畫要修的路）上的海邊數。 */
function openSeaEdges(model: BoardModel, vertex: number, taken: readonly number[]): number {
  const { roads } = model.view.board;
  return model.topo.vertices[vertex]!.edges.filter((edge) => isSeaEdge(model, edge) && !roads[edge] && !taken.includes(edge)).length;
}

/**
 * 在 `vertex` 蓋了聚落（`roads` 也修好）之後，以 ≤ `cap` 艘船能登上的最佳島嶼聚落的價值（勝利分當量，
 * `islandSiteValue`）；登不上任何小島時為 0。不看海盜。島嶼的條件與 `islandSettlementPlans` 相同：
 * New Shores 只算主島以外的小島，道路一樣近或更近的空點不算。
 */
export function seaAccessValue(
  model: BoardModel,
  vertex: number,
  roads: readonly number[],
  cap: number,
  input: Pick<PlanInput['base'], 'search' | 'weights'>,
  longTerm: Yield,
  claimed: ReadonlySet<number>,
): number {
  const { board } = model.view;
  const buildings = board.buildings.slice();
  buildings[vertex] = { player: model.selfId, city: false };
  const built = board.roads.slice();
  for (const edge of roads) built[edge] = { player: model.selfId, ship: false };
  const after: BoardModel = { ...model, view: { ...model.view, board: { ...board, buildings, roads: built, pirate: null } } };
  const search = searchShips(after, model.selfId, cap);
  const islandRules = model.profile.scenario === 'new-shores';
  let best = 0;
  for (let site = 0; site < model.topo.vertices.length; site++) {
    const ships = search.distance[site]!;
    if (ships === 0 || ships > cap || input.search.distance[site]! <= ships) continue;
    if (!isFreeSpot(after, site)) continue;
    if (islandRules && !islandsAt(model, site).some((island) => island !== MAIN_ISLAND)) continue;
    best = Math.max(best, islandSiteValue(model, site, ships, input.weights, longTerm, claimed));
  }
  return best;
}

/**
 * 沿海聚落計畫：沒有船的出發點、而且還有船與聚落可用時，沿 base 的道路 BFS（≤ `MAX_PLAN_ROADS` 條，與 base 的
 * 聚落計畫相同）到一個沿海空點。蓋好之後那個路口必須還有一條空的海邊（路徑占用的不算），而且出海能登上小島
 * （`seaAccessValue > 0`）；否則它與內陸空點沒有差別，交給 base。價值＝聚落本身（與 base 相同）＋
 * `ACCESS_WEIGHT` × 出海價值，整體依道路數打折（越遠越可能被搶先，與 base 相同）；成本、`nextCost` 與 eta 也與
 * base 的聚落計畫相同。船路徑的容量與島嶼計畫相同（standard 4、easy 3 艘，且不超過船的存量）。
 */
export function coastSettlementPlans({ model, level, base }: PlanInput): Plan[] {
  const { view, selfId } = model;
  if (base.left.settlements <= 0) return [];
  const cap = Math.min(level === 'easy' ? EASY_MAX_PLAN_SHIPS : MAX_PLAN_SHIPS, Math.max(0, base.left.ships));
  if (cap === 0 || hasLaunchPoint(model, selfId)) return [];
  const legalNow = new Set(view.hints?.legalSettlements ?? []);
  const claimed = claimedIslands(model);
  const longTerm = playerYield(model, selfId, true);
  const players = view.players.length;
  const candidates: Plan[] = [];
  for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
    const distance = base.search.distance[vertex]!;
    if (distance === Infinity || !isFreeSpot(model, vertex)) continue;
    if (distance === 0 && !legalNow.has(vertex)) continue;
    const roads = distance === 0 ? [] : roadPath(base.search, vertex);
    if (roads.length > base.left.roads || openSeaEdges(model, vertex, roads) === 0) continue;
    const access = seaAccessValue(model, vertex, roads, cap, base, longTerm, claimed);
    if (access <= 0) continue;
    const settlement = 1 + PIP_VALUE * settlementSpotValue(model, vertex, base.weights, longTerm);
    const value = (settlement + ACCESS_WEIGHT * access) * 0.9 ** roads.length;
    const cost = addCosts(COSTS.settlement, scaleCost(COSTS.road, roads.length));
    const eta = etaRounds(base.hand, cost, base.yield, base.rates, players, base.kinds) + roads.length * ETA_PER_ROAD;
    candidates.push({
      kind: COAST_SETTLEMENT,
      vertex,
      roads,
      ships: [],
      cost,
      nextCost: roads.length > 0 ? COSTS.road : COSTS.settlement,
      value,
      eta,
      score: value / (1 + eta),
      immediate: roads.length === 0,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.vertex! - b.vertex!);
  return candidates.slice(0, PLANS_KEPT);
}

/** 沿海聚落的下一步：與 base 的聚落計畫相同，先造路，抵達後蓋聚落。 */
function coastSettlementStep(turn: TurnContext, plan: Plan): BotCommand | null {
  const { view, economy } = turn;
  const hints = view.hints;
  const edge = plan.roads[0];
  if (edge !== undefined) {
    return (hints?.legalRoads ?? []).includes(edge) && economy.left.roads > 0 ? { type: 'build.road', edge } : null;
  }
  const vertex = plan.vertex;
  if (vertex === null || !(hints?.legalSettlements ?? []).includes(vertex)) return null;
  return economy.left.settlements > 0 ? { type: 'build.settlement', vertex } : null;
}

/**
 * 模組計畫的下一步。島嶼聚落：船路徑的第一艘，抵達後在目標路口蓋聚落；沿海聚落：見 `coastSettlementStep`。
 * 模組對不屬於自己的計畫種類回 undefined。
 */
export const seafarersPlanStep: NonNullable<BotModule['planStep']> = (turn, plan) => {
  if (plan.kind === COAST_SETTLEMENT) return coastSettlementStep(turn, plan);
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
