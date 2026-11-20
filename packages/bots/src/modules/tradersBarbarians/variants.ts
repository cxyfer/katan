/**
 * 變體 Friendly Robber 與 Harbors 的策略（T&B 計畫 §4.2）。兩者都沒有模組指令。
 *
 * **Friendly Robber**：`robberTargets` 把盜賊目標 fold 換成 hints 的 `robberHexes`（rules 已套用 FR 的縮減，與行動者無關）；
 * hints 缺漏時原樣回傳收到的集合。這也是正確性必需（§4.1 第 13 列）：base 的保底取 fold 的第一項，而 fold 的初值排除強盜
 * 現位格；FR 在所有格都受保護時只能放沙漠，即使強盜已經在沙漠（`TB/variants/friendlyRobber.ts:34-41`）。
 * - `pending.moveRobber`：回傳完整的 `robberHexes`。base 的強盜評分在集合內挑阻擋價值最高的格；受保護玩家的格已被
 *   rules 排除，評分不必另外處理。集合只剩現位格（沙漠）時，base 候選跳過現位格、過濾後為空，`banditChoice` 取第一項。
 * - 其他時候（打出騎士卡的決策）：去掉強盜現位格。沒有別的格可去時回空集合，`banditChoice` 回 null，所以不打騎士卡
 *   （「有合法目標時才打」）。
 * standard 與 easy 相同。
 *
 * **Harbors**（standard；easy 不估）：Strongest Ports（2 VP）給第一位港口建築分數達到 `STRONGEST_PORTS_MINIMUM` 的玩家，之後
 * 只有嚴格超過持有者才轉手（`TB/variants/harbors.ts`）。這裡估「多蓋一座港口建築」帶來的板塊價值（`portBonus`）：
 * - 蓋完會拿到板塊（分數 ≥ 下限，而且嚴格超過所有對手）：+2 VP；
 * - 自己是持有者、有對手追平：守住的價值；
 * - 還差幾分：依還差的分數給一小部分。
 * 價值加在 `scoreExtras` 的港口計畫（城市、聚落，kind 為 `tradersBarbarians.portCity`／`portSettlement`，`planStep` 交回這裡）
 * 與 `actions` 的立即建造（與 base 同一個指令時，去重取較高分）。
 *
 * 只讀 view、hints 與模型，不 throw、不消耗亂數。
 */

import { COSTS, STRONGEST_PORTS_MINIMUM, STRONGEST_PORTS_POINTS, type GameView } from '@catan/rules';
import { isFreeSpot, playerYield, roadPath, type BoardModel } from '../../board.ts';
import {
  addCosts,
  canAfford,
  etaRounds,
  PIP_VALUE,
  productionValue,
  scaleCost,
  settlementSpotValue,
  type Plan,
} from '../../economy.ts';
import type { BotCommand, PlanInput, Scored, TurnContext } from '../types.ts';
import type { TbPartBot } from './part.ts';
import { TB_PART_IDS, TRADERS_BARBARIANS, tbPartView, tbRobberHexes } from './view.ts';

// ---------------------------------------------------------------------------
// Friendly Robber
// ---------------------------------------------------------------------------

export const friendlyRobberBot: TbPartBot = {
  id: TB_PART_IDS.friendlyRobber,
  robberTargets: (view, _selfId, targets) => {
    const hexes = tbRobberHexes(view.hints);
    if (!hexes) return targets;
    if (view.pending?.kind === 'moveRobber') return hexes;
    return hexes.filter((hex) => hex !== view.board.robber);
  },
};

// ---------------------------------------------------------------------------
// Harbors
// ---------------------------------------------------------------------------

export const PORT_CITY_PLAN = `${TRADERS_BARBARIANS}.portCity` as const;
export const PORT_SETTLEMENT_PLAN = `${TRADERS_BARBARIANS}.portSettlement` as const;

/** 持有者被追平時，再蓋一座港口建築守住板塊的價值（占 2 VP 的比例）。 */
const DEFEND_SHARE = 0.35;
/** 還差 n 分才拿得到時，這一分的價值：`STRONGEST_PORTS_POINTS × PROGRESS_SHARE / n`。 */
const PROGRESS_SHARE = 0.3;
/** 每個種類最多幾個港口聚落計畫。 */
const MAX_PORT_SETTLEMENT_PLANS = 2;

interface PortStanding {
  readonly holder: string | null;
  readonly points: Readonly<Record<string, number>>;
}

/** 港口路口上的建築分數與持有者：讀 harbors 的 view；缺漏時依盤面自行計算（與 rules 的 `portPoints` 相同）。 */
export function portStanding(model: BoardModel): PortStanding {
  const view = model.view;
  const part = tbPartView(view, TB_PART_IDS.harbors);
  const holder = typeof part?.holder === 'string' ? part.holder : null;
  const published = part?.portPoints;
  if (published && typeof published === 'object') return { holder, points: published };
  const points: Record<string, number> = Object.fromEntries(view.players.map((player) => [player.id, 0]));
  view.board.buildings.forEach((building, vertex) => {
    if (building && model.harborAt[vertex]) points[building.player] = (points[building.player] ?? 0) + (building.city ? 2 : 1);
  });
  return { holder, points };
}

/**
 * 自己多一分港口建築分數時，Strongest Ports 的價值（勝利分當量）。`selfId` 的分數 p、對手最高 q：
 * - 不是持有者：p+1 ≥ 下限且 p+1 > q 就拿到板塊（2 VP）；否則依還差的分數 `max(下限, q+1) − p` 給 `2 × 0.3 / 還差`。
 * - 是持有者：q ≥ p（對手再一分就超過）時守住的價值 `2 × 0.35`；否則 0。
 */
export function portBonus(standing: PortStanding, selfId: string): number {
  const mine = standing.points[selfId] ?? 0;
  const rival = Math.max(0, ...Object.entries(standing.points).filter(([id]) => id !== selfId).map(([, points]) => points));
  if (standing.holder === selfId) return rival >= mine ? STRONGEST_PORTS_POINTS * DEFEND_SHARE : 0;
  const after = mine + 1;
  if (after >= STRONGEST_PORTS_MINIMUM && after > rival) return STRONGEST_PORTS_POINTS;
  const needed = Math.max(STRONGEST_PORTS_MINIMUM, rival + 1) - mine;
  return (STRONGEST_PORTS_POINTS * PROGRESS_SHARE) / Math.max(1, needed);
}

/** 港口路口（港口邊的兩端）。 */
function isPortVertex(model: BoardModel, vertex: number): boolean {
  return model.harborAt[vertex] !== null && model.harborAt[vertex] !== undefined;
}

/** 輪到自己的行動階段（沒有待決效果）：此時 base 只在 hints 的合法位置裡規劃城市。 */
function acting(view: GameView, selfId: string): boolean {
  return view.hints !== undefined && view.turn.playerId === selfId && view.turn.phase === 'action' && !view.pending;
}

/** 港口城市與港口聚落的計畫（standard）；板塊沒有價值時不產生。 */
export function portPlans(input: PlanInput): Plan[] {
  if (input.level === 'easy') return [];
  const { model, base } = input;
  const { view, selfId } = model;
  const bonus = portBonus(portStanding(model), selfId);
  if (bonus <= 0) return [];
  const players = view.players.length;
  const plans: Plan[] = [];
  const push = (plan: Omit<Plan, 'eta' | 'score'>, extraEta = 0): void => {
    const eta = etaRounds(base.hand, plan.cost, base.yield, base.rates, players, base.kinds) + extraEta;
    plans.push({ ...plan, eta, score: plan.value / (1 + eta) });
  };

  if (base.left.cities > 0) {
    const legal = acting(view, selfId) ? new Set(view.hints!.legalCities) : null;
    view.board.buildings.forEach((building, vertex) => {
      if (!building || building.player !== selfId || building.city || !isPortVertex(model, vertex)) return;
      if (legal && !legal.has(vertex)) return;
      push({
        kind: PORT_CITY_PLAN,
        vertex,
        roads: [],
        ships: [],
        cost: COSTS.city,
        nextCost: COSTS.city,
        value: 1 + PIP_VALUE * productionValue(model, vertex, base.weights) + bonus,
        immediate: true,
      });
    });
  }

  if (base.left.settlements > 0) {
    const legalNow = new Set(view.hints?.legalSettlements ?? []);
    const longTerm = playerYield(model, selfId, true);
    const settlements: Plan[] = [];
    const before = plans.length;
    for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
      if (!isPortVertex(model, vertex)) continue;
      const distance = base.search.distance[vertex]!;
      if (distance === Infinity || !isFreeSpot(model, vertex)) continue;
      if (distance === 0 && !legalNow.has(vertex)) continue;
      const roads = distance === 0 ? [] : roadPath(base.search, vertex);
      if (roads.length > base.left.roads) continue;
      const discount = 0.9 ** roads.length;
      push(
        {
          kind: PORT_SETTLEMENT_PLAN,
          vertex,
          roads,
          ships: [],
          cost: addCosts(COSTS.settlement, scaleCost(COSTS.road, roads.length)),
          nextCost: roads.length > 0 ? COSTS.road : COSTS.settlement,
          value: (1 + PIP_VALUE * settlementSpotValue(model, vertex, base.weights, longTerm) + bonus) * discount,
          immediate: roads.length === 0,
        },
        roads.length * 0.35,
      );
    }
    settlements.push(...plans.splice(before));
    settlements.sort((a, b) => b.score - a.score || a.vertex! - b.vertex!);
    plans.push(...settlements.slice(0, MAX_PORT_SETTLEMENT_PLANS));
  }
  return plans;
}

/** 港口計畫的下一步；不是港口計畫回 undefined，付不起或已不合法回 null。 */
export function portPlanStep(turn: TurnContext, plan: Plan): BotCommand | null | undefined {
  if (plan.kind !== PORT_CITY_PLAN && plan.kind !== PORT_SETTLEMENT_PLAN) return undefined;
  const hints = turn.view.hints;
  const { hand, left } = turn.economy;
  if (!hints || !canAfford(hand, plan.nextCost) || plan.vertex === null) return null;
  if (plan.kind === PORT_CITY_PLAN) {
    return hints.legalCities.includes(plan.vertex) && left.cities > 0 ? { type: 'build.city', vertex: plan.vertex } : null;
  }
  if (plan.roads.length === 0) {
    return hints.legalSettlements.includes(plan.vertex) && left.settlements > 0
      ? { type: 'build.settlement', vertex: plan.vertex }
      : null;
  }
  const edge = plan.roads[0]!;
  return hints.legalRoads.includes(edge) && left.roads > 0 ? { type: 'build.road', edge } : null;
}

/**
 * 付得起的港口城市與港口聚落，分數 = base 立即建造的分數（`buildDecision` 的同一個公式）+ 板塊價值。與 base 的同一個指令
 * 去重時取較高分，所以只會把港口建築往前排。
 */
export function portActions(turn: TurnContext): Scored<BotCommand>[] {
  if (turn.level === 'easy') return [];
  const { view, model, ctx } = turn;
  const hints = view.hints;
  if (!hints) return [];
  const bonus = portBonus(portStanding(model), ctx.selfId);
  if (bonus <= 0) return [];
  const { hand, left, weights } = turn.economy;
  const out: Scored<BotCommand>[] = [];
  if (left.cities > 0 && canAfford(hand, COSTS.city)) {
    for (const vertex of hints.legalCities) {
      if (!isPortVertex(model, vertex)) continue;
      out.push({ item: { type: 'build.city', vertex }, score: 1 + PIP_VALUE * productionValue(model, vertex, weights) + bonus });
    }
  }
  if (left.settlements > 0 && canAfford(hand, COSTS.settlement)) {
    const mine = playerYield(model, ctx.selfId, true);
    for (const vertex of hints.legalSettlements) {
      if (!isPortVertex(model, vertex)) continue;
      out.push({
        item: { type: 'build.settlement', vertex },
        score: 1 + PIP_VALUE * settlementSpotValue(model, vertex, weights, mine) + bonus,
      });
    }
  }
  return out;
}

export const harborsBot: TbPartBot = {
  id: TB_PART_IDS.harbors,
  actions: portActions,
  planStep: portPlanStep,
  economy: { scoreExtras: portPlans },
};
