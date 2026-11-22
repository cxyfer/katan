/**
 * hard 的計畫估值（規格 §4 第 3 點）：以 base 經濟為底，改寫最長道路計畫與發展卡的價值。
 * 沿用 standard 的函式（例如 `planStep`、`usefulRoad`）時，讀到的也是這份經濟。
 */

import { COSTS, RESOURCES } from '@katan/rules';
import { isFreeSpot, playerYield, roadPath, vertexYield, type Yield } from '../board.ts';
import { addCosts, bestRouteEdge, economyOf, PIP_VALUE, scaleCost, weightedPips, type Cost, type Economy, type Plan } from '../economy.ts';
import { hardEtaRounds } from './eta.ts';
import { NO_PORT_RATES, portTradeValue, ratesWithPort } from './ports.ts';
import type { HardTurn } from './turn.ts';

/** 還差幾條道路就拿到最長道路時，計畫的價值（以勝利分計）。standard 只追差 1–2 條的。 */
const ROUTE_VALUE: readonly number[] = [0, 2.1, 1.8, 1.45, 1.1];

/**
 * 發展卡計畫相對 standard 估值的倍率。自我對局（每種設定 500 局）：1.15、1.3、1.5、1.6、2 倍中
 * 1.3 倍最好；3 人局從 1 倍的 41% 提高到 46%。
 */
const DEV_CARD_SCALE = 1.3;

/** 牌庫初始組成下，一張發展卡的估值（分數卡 1、騎士 0.4、進度卡 0.5，以勝利分計）。 */
const BASE_DEV_VALUE = (5 * 1 + 14 * 0.4 + 6 * 0.5) / 25;

function comparePlans(a: Plan, b: Plan): number {
  return b.score - a.score;
}

/** 最長道路：還差 1–4 條、而且有能延長路線的合法道路時列為計畫；自己持有時防守。 */
function routePlan(turn: HardTurn, economy: Economy): Omit<Plan, 'eta' | 'score'> | null {
  const { view, model, ctx } = turn;
  if (economy.left.roads <= 0) return null;
  const holder = view.awards.longestRoad;
  const bestRival = Math.max(0, ...turn.opponents.map((player) => player.longestRoadLength));
  let needed: number;
  let value: number;
  if (holder === ctx.selfId) {
    // 對手只差一條就追平時，先拉開距離。
    if (bestRival < economy.myRoute - 1) return null;
    needed = 1;
    value = 1.2;
  } else {
    const holderLength = holder ? (turn.player(holder)?.longestRoadLength ?? 0) : 0;
    needed = Math.max(5, holderLength + 1, bestRival + 1) - economy.myRoute;
    if (needed < 1 || needed >= ROUTE_VALUE.length || needed > economy.left.roads) return null;
    value = ROUTE_VALUE[needed]!;
  }
  const edge = bestRouteEdge(model, view.hints?.legalRoads ?? [], economy.myRoute);
  if (edge === null) return null;
  const cost = scaleCost(COSTS.road, needed);
  return { kind: 'longestRoad', vertex: null, roads: [edge], ships: [], cost, nextCost: COSTS.road, value };
}

/** 發展卡的倍率，依計牌模組的未現身牌池調整：分數卡都已現身時下降，剩下的騎士多時上升。 */
function devCardFactor(turn: HardTurn): number {
  const { unseen, unseenTotal } = turn.belief.dev;
  if (unseenTotal <= 0) return DEV_CARD_SCALE;
  const progress = unseenTotal - unseen.victoryPoint - unseen.knight;
  const value = (unseen.victoryPoint * 1 + unseen.knight * 0.4 + progress * 0.5) / unseenTotal;
  return (DEV_CARD_SCALE * value) / BASE_DEV_VALUE;
}

/** 港口收益只看目前仍可走的基本建造方向；多個聚落候選只算一種成本。 */
export function settlementPortTargets(economy: Economy): Cost[] {
  const targets: Cost[] = [];
  if (economy.plans.some((plan) => plan.kind === 'city')) targets.push(COSTS.city);
  if (economy.left.settlements > 1 && economy.plans.some((plan) => plan.kind === 'settlement')) targets.push(COSTS.settlement);
  if (economy.plans.some((plan) => plan.kind === 'devCard')) targets.push(COSTS.devCard);
  return targets;
}

/** 長期產能與多樣性沿用基本估值，港口則只計新匯率帶來的收益。 */
export function hardSettlementValue(base: Economy, vertex: number, mine: Yield, targets: readonly Cost[]): number {
  const { model, rates } = base;
  const spot = vertexYield(model, vertex);
  let pips = weightedPips(spot, base.weights);
  for (const resource of RESOURCES) if (spot[resource] > 0 && mine[resource] === 0) pips += 2.5;
  const upgraded = ratesWithPort(rates, model.harborAt[vertex] ?? null);
  if (upgraded === rates) return 1 + PIP_VALUE * pips;
  for (const resource of RESOURCES) spot[resource] += mine[resource];
  const trade = portTradeValue(spot, rates, upgraded, model.view.players.length, targets);
  return 1 + PIP_VALUE * pips + 0.5 * trade;
}

/** 共用經濟已截取前三名；hard 得先用自己的估值重排所有可達空點。 */
function settlementPlans(turn: HardTurn, base: Economy, scorePlan: (plan: Omit<Plan, 'eta' | 'score'>) => Plan): Plan[] {
  if (base.left.settlements <= 0) return [];
  const { model, view, ctx } = turn;
  const mine = playerYield(model, ctx.selfId, true);
  const targets = settlementPortTargets(base);
  const legalNow = new Set(view.hints?.legalSettlements ?? []);
  const plans: Plan[] = [];
  for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
    const distance = base.search.distance[vertex]!;
    if (distance === Infinity || (distance === 0 && !legalNow.has(vertex)) || !isFreeSpot(model, vertex)) continue;
    const roads = roadPath(base.search, vertex);
    const value = hardSettlementValue(base, vertex, mine, targets) * 0.9 ** distance;
    plans.push(scorePlan({
      kind: 'settlement',
      vertex,
      roads,
      ships: [],
      cost: addCosts(COSTS.settlement, scaleCost(COSTS.road, distance)),
      nextCost: distance > 0 ? COSTS.road : COSTS.settlement,
      value,
    }));
  }
  return plans.sort(comparePlans).slice(0, 3);
}

export function hardEconomyOf(turn: HardTurn): Economy {
  const standard = economyOf(turn.model, [], 'standard');
  let rates = turn.view.hints?.bankRates ?? NO_PORT_RATES;
  if (!turn.view.hints) {
    turn.view.board.buildings.forEach((building, vertex) => {
      if (building?.player === turn.ctx.selfId) rates = ratesWithPort(rates, turn.model.harborAt[vertex] ?? null);
    });
  }
  const base = { ...standard, rates };
  const route = routePlan(turn, base);
  const factor = base.plans.some((plan) => plan.kind === 'devCard') ? devCardFactor(turn) : 1;
  const scorePlan = (plan: Omit<Plan, 'eta' | 'score'>): Plan => {
    const eta = hardEtaRounds(base.hand, plan.cost, base.yield, base.rates, turn.view.players.length)
      + (plan.kind === 'settlement' ? plan.roads.length * 0.35 : 0);
    return { ...plan, eta, score: plan.value / (1 + eta) };
  };
  const plans = base.plans
    .filter((plan) => plan.kind !== 'settlement' && (!route || plan.kind !== 'longestRoad'))
    .map((plan) => scorePlan(plan.kind === 'devCard' ? { ...plan, value: plan.value * factor } : plan));
  plans.push(...settlementPlans(turn, base, scorePlan));
  if (route) plans.push(scorePlan(route));
  plans.sort(comparePlans);
  return { ...base, plans };
}
