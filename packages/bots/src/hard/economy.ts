/**
 * hard 的計畫估值（規格 §4 第 3 點）：以 base 經濟為底，改寫最長道路計畫與發展卡的價值。
 * 沿用 standard 的函式（例如 `planStep`、`usefulRoad`）時，讀到的也是這份經濟。
 */

import { COSTS } from '@catan/rules';
import { playerYield } from '../board.ts';
import { bestRouteEdge, economyOf, etaRounds, scaleCost, type Economy, type Plan } from '../economy.ts';
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
function routePlan(turn: HardTurn, economy: Economy): Plan | null {
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
  const eta = etaRounds(economy.hand, cost, playerYield(model, ctx.selfId), economy.rates, view.players.length);
  return { kind: 'longestRoad', vertex: null, roads: [edge], ships: [], cost, nextCost: COSTS.road, value, eta, score: value / (1 + eta) };
}

/** 發展卡的倍率，依計牌模組的未現身牌池調整：分數卡都已現身時下降，剩下的騎士多時上升。 */
function devCardFactor(turn: HardTurn): number {
  const { unseen, unseenTotal } = turn.belief.dev;
  if (unseenTotal <= 0) return DEV_CARD_SCALE;
  const progress = unseenTotal - unseen.victoryPoint - unseen.knight;
  const value = (unseen.victoryPoint * 1 + unseen.knight * 0.4 + progress * 0.5) / unseenTotal;
  return (DEV_CARD_SCALE * value) / BASE_DEV_VALUE;
}

export function hardEconomyOf(turn: HardTurn): Economy {
  const base = economyOf(turn.model, [], 'standard');
  const route = routePlan(turn, base);
  const factor = base.plans.some((plan) => plan.kind === 'devCard') ? devCardFactor(turn) : 1;
  const plans = base.plans
    .filter((plan) => !route || plan.kind !== 'longestRoad')
    .map((plan) => {
      if (plan.kind !== 'devCard') return plan;
      const value = plan.value * factor;
      return { ...plan, value, score: value / (1 + plan.eta) };
    });
  if (route) plans.push(route);
  // 穩定排序：同分時保留 base 的順序。
  plans.sort(comparePlans);
  return { ...base, plans };
}
