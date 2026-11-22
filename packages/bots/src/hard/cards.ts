/** hard 的發展卡：騎士用 hard 的強盜評分，壟斷用計牌結果。 */

import { COSTS, RESOURCES, type Command, type Resource } from '@katan/rules';
import { canPlay } from '../base/cards.ts';
import { deficitOf } from '../economy.ts';
import { handUtility } from '../trade.ts';
import { hardKnightDecision } from './robber.ts';
import { roadBuildingEdge } from './roads.ts';
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

function hasSettlementSites(turn: HardTurn, sites: readonly number[], count: number): boolean {
  if (sites.length < count) return false;
  if (count <= 1) return true;
  return sites.some((site, index) => hasSettlementSites(
    turn,
    sites.slice(index + 1).filter((other) => !turn.model.neighbors[site]!.includes(other)),
    count - 1,
  ));
}

function monopolyWins(turn: HardTurn, resource: Resource): boolean {
  const { me, view } = turn;
  const gap = view.victoryTarget - (me.ownScore ?? me.publicScore);
  if (view.turn.phase !== 'action' || gap < 1 || gap > 3) return false;
  const { hand, left } = turn.economy;
  const maxCities = Math.min(left.cities, view.hints!.legalCities.length, gap);
  const sites = view.hints!.legalSettlements;
  const taken = turn.opponents.reduce((sum, player) => sum + (turn.hand(player.id)?.min[resource] ?? 0), 0);
  if (taken === 0) return false;
  for (let cities = 0; cities <= maxCities; cities++) {
    const settlements = gap - cities;
    if (settlements > left.settlements + cities || settlements > sites.length) continue;
    const cost = (kind: Resource): number => cities * (COSTS.city[kind] ?? 0) + settlements * (COSTS.settlement[kind] ?? 0);
    if (hand[resource] >= cost(resource)) continue;
    if (RESOURCES.every((kind) => hand[kind] + (kind === resource ? taken : 0) >= cost(kind)) &&
      hasSettlementSites(turn, sites, settlements)) return true;
  }
  return false;
}

export function winningMonopoly(turn: HardTurn): Command | null {
  const resource = canPlay(turn, 'monopoly') ? RESOURCES.find((kind) => monopolyWins(turn, kind)) : undefined;
  return resource ? { type: 'dev.playMonopoly', resource } : null;
}

function progressCard(turn: HardTurn): Command | null {
  if (canPlay(turn, 'yearOfPlenty')) {
    const { plans, hand } = turn.economy;
    const plan = plans[0];
    if (plan) {
      const missing = deficitOf(hand, plan.nextCost);
      const need = RESOURCES.reduce((sum, resource) => sum + missing[resource], 0);
      if (need >= 1 && need <= 2) return { type: 'dev.playYearOfPlenty' };
    }
  }
  const resource = canPlay(turn, 'monopoly') ? monopolyChoice(turn) : null;
  return resource ? { type: 'dev.playMonopoly', resource } : null;
}

export function hardDevCardDecision(turn: HardTurn): Command | null {
  const preroll = turn.view.turn.phase === 'preroll';
  if (preroll && !canPlay(turn, 'knight')) return null;
  const progress = progressCard(turn);
  const knight = hardKnightDecision(turn, progress !== null);
  if (knight || preroll) return knight;
  if (progress) return progress;
  if (canPlay(turn, 'roadBuilding') && roadBuildingEdge(turn, 2) !== null) {
    return { type: 'dev.playRoadBuilding' };
  }
  return null;
}

export function hardPlentyPick(turn: HardTurn): Resource | null {
  const { view, ctx } = turn;
  const pending = view.pending;
  if (pending?.kind !== 'yearOfPlenty' || pending.actor !== ctx.selfId) return null;
  const { bank } = view;
  const { hand, plans, weights, yield: income } = turn.economy;
  const useful = plans.find((plan) => {
    const missing = deficitOf(hand, plan.nextCost);
    const count = RESOURCES.reduce((total, resource) => total + missing[resource], 0);
    return count > 0 && count <= pending.remaining && RESOURCES.every((resource) => missing[resource] <= bank[resource]);
  }) ?? plans[0];
  const next = deficitOf(hand, useful?.nextCost ?? {});
  const full = deficitOf(hand, useful?.cost ?? {});
  let best: Resource | null = null;
  let bestScore = -Infinity;
  for (const resource of RESOURCES) {
    if (bank[resource] <= 0) continue;
    const nextCount = Math.min(next[resource], bank[resource], pending.remaining);
    const fullCount = Math.min(full[resource], bank[resource], pending.remaining);
    const score = 20 * nextCount + 5 * fullCount + weights[resource] + (income[resource] === 0 ? 1 : 0);
    if (score > bestScore) {
      best = resource;
      bestScore = score;
    }
  }
  return best;
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
