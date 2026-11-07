/** hard 的發展卡：騎士用 hard 的強盜評分，壟斷用計牌結果。 */

import { RESOURCES, type Command, type Resource } from '@catan/rules';
import { canPlay } from '../base/cards.ts';
import { usefulRoad } from '../base/roads.ts';
import { deficitOf } from '../economy.ts';
import { handUtility } from '../trade.ts';
import { hardKnightDecision } from './robber.ts';
import type { HardTurn } from './turn.ts';

/** 壟斷至少預期拿到幾張（依用途加權）才打。 */
const MONOPOLY_MIN = 2.5;
/** 棄牌：第二、第三順位計畫的權重。 */
const DISCARD_WEIGHTS = [1, 0.5, 0.25];

/** 依計牌結果估計每種資源能從對手拿到幾張。 */
export function monopolyChoice(turn: HardTurn): Resource | null {
  const economy = turn.economy;
  const plan = economy.plans[0];
  const missing = plan ? deficitOf(economy.hand, plan.cost) : null;
  let best: Resource | null = null;
  let bestValue = 0;
  for (const resource of RESOURCES) {
    let expected = 0;
    for (const player of turn.opponents) expected += turn.hand(player.id)?.expected[resource] ?? 0;
    const useful = (missing && missing[resource] > 0) || economy.rates[resource] <= 2 ? 1 : 0.7;
    const value = expected * useful;
    if (value > bestValue) {
      bestValue = value;
      best = resource;
    }
  }
  return bestValue >= MONOPOLY_MIN ? best : null;
}

export function hardDevCardDecision(turn: HardTurn): Command | null {
  const { view } = turn;
  const knight = hardKnightDecision(turn);
  if (knight) return knight;
  const economy = turn.economy;
  const plan = economy.plans[0];
  if (canPlay(turn, 'yearOfPlenty') && plan) {
    const bankTotal = RESOURCES.reduce((sum, resource) => sum + view.bank[resource], 0);
    const missing = deficitOf(economy.hand, plan.nextCost);
    const need = RESOURCES.reduce((sum, resource) => sum + missing[resource], 0);
    if (bankTotal >= 1 && need >= 1 && need <= 2) return { type: 'dev.playYearOfPlenty' };
  }
  if (canPlay(turn, 'monopoly')) {
    const resource = monopolyChoice(turn);
    if (resource) return { type: 'dev.playMonopoly', resource };
  }
  if (canPlay(turn, 'roadBuilding') && economy.left.roads >= 1 && usefulRoad(turn, true) !== null) {
    return { type: 'dev.playRoadBuilding' };
  }
  return null;
}

/**
 * 棄牌：列舉所有棄法，保留對前三個計畫加權效用最高的手牌（standard 只看第一順位計畫，
 * 而且一張一張貪婪地丟）。
 */
export function hardDiscard(turn: HardTurn, count: number): Command | null {
  const economy = turn.economy;
  const hand = economy.hand;
  const plans = economy.plans.slice(0, 3);
  const weights = DISCARD_WEIGHTS;
  const keepValue = (kept: Record<Resource, number>): number => {
    if (plans.length === 0) return RESOURCES.reduce((sum, r) => sum + kept[r] * economy.weights[r], 0);
    let value = 0;
    plans.forEach((plan, index) => {
      value += weights[index]! * handUtility(economy, kept, plan.cost);
    });
    return value;
  };
  let best: Resource[] | null = null;
  let bestValue = -Infinity;
  const discard: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  const walk = (index: number, left: number): void => {
    if (index === RESOURCES.length) {
      if (left !== 0) return;
      const kept = { ...hand };
      for (const resource of RESOURCES) kept[resource] -= discard[resource];
      const value = keepValue(kept);
      if (value > bestValue) {
        bestValue = value;
        best = RESOURCES.flatMap((resource) => Array<Resource>(discard[resource]).fill(resource));
      }
      return;
    }
    const resource = RESOURCES[index]!;
    for (let take = Math.min(left, hand[resource]); take >= 0; take--) {
      discard[resource] = take;
      walk(index + 1, left - take);
    }
    discard[resource] = 0;
  };
  walk(0, count);
  return best ? { type: 'pending.discard', resources: best } : null;
}
