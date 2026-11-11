/** hard 的建造順序：與 standard 相同，但在銀行交易之前先嘗試國內交易。 */

import { COSTS } from '@catan/rules';
import { playerYield } from '../board.ts';
import { usefulRoad } from '../base/roads.ts';
import { canAfford, PIP_VALUE, productionValue, settlementSpotValue, type Cost, type Economy } from '../economy.ts';
import { planStep } from '../heuristic.ts';
import type { Scored } from '../modules/types.ts';
import { bankTradeToward } from '../trade.ts';
import type { BotCommand } from '../types.ts';
import { hardProposal } from './trade.ts';
import type { HardTurn } from './turn.ts';

/** 付完 `spend` 後，主要計畫已持有的資源是否減少。 */
function hurts(economy: Economy, primary: Cost, spend: Cost): boolean {
  return (Object.keys(spend) as (keyof Cost)[]).some((kind) => {
    const held = economy.hand[kind] ?? 0;
    return held - (spend[kind] ?? 0) < Math.min(held, primary[kind] ?? 0);
  });
}

export function hardBuildDecision(turn: HardTurn): BotCommand | null {
  const { view, model, ctx } = turn;
  const hints = view.hints!;
  const economy = turn.economy;
  const hand = economy.hand;
  const { left, weights } = economy;

  // a) 付得起的城市與聚落：立即得分。
  const scoring: Scored<BotCommand>[] = [];
  if (left.cities > 0 && canAfford(hand, COSTS.city)) {
    for (const vertex of hints.legalCities) {
      scoring.push({ item: { type: 'build.city', vertex }, score: 1 + PIP_VALUE * productionValue(model, vertex, weights) });
    }
  }
  if (left.settlements > 0 && canAfford(hand, COSTS.settlement)) {
    const mine = playerYield(model, ctx.selfId, true);
    for (const vertex of hints.legalSettlements) {
      scoring.push({
        item: { type: 'build.settlement', vertex },
        score: 1 + PIP_VALUE * settlementSpotValue(model, vertex, weights, mine),
      });
    }
  }
  const scoringPick = turn.pick(scoring);
  if (scoringPick) return scoringPick;

  // b) 主要計畫：付得起就做下一步；否則先找玩家交易，再看銀行交易能否在這回合補齊。
  const primary = economy.plans[0];
  if (primary) {
    const step = planStep(turn, primary);
    if (step) return step;
    if (!turn.pairedSecond) {
      const offer = hardProposal(turn, primary.cost);
      if (offer) return offer;
    }
    const trade = bankTradeToward(view, economy, primary.nextCost, primary.cost);
    if (trade) return trade;
  }

  // c) 其他付得起、且不動用主要計畫資源的建造。
  const reserve = primary?.cost ?? {};
  for (const plan of economy.plans.slice(1)) {
    if (!canAfford(hand, plan.nextCost) || hurts(economy, reserve, plan.nextCost)) continue;
    const step = planStep(turn, plan);
    if (step) return step;
  }
  if (view.devDeckSize > 0 && canAfford(hand, COSTS.devCard) && !hurts(economy, reserve, COSTS.devCard)) {
    return { type: 'build.devCard' };
  }
  if (left.roads > 0 && canAfford(hand, COSTS.road) && !hurts(economy, reserve, COSTS.road)) {
    const edge = usefulRoad(turn, false);
    if (edge !== null) return { type: 'build.road', edge };
  }
  return null;
}
