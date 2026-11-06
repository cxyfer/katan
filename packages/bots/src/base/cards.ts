/** base 的發展卡輔助：能否打出，以及豐收之年的挑選。 */

import { RESOURCES, type DevCardType, type Resource } from '@catan/rules';
import { deficitOf, type Hand } from '../economy.ts';
import type { Scored, TurnContext } from '../modules/types.ts';

export function canPlay(turn: TurnContext, card: DevCardType): boolean {
  const { me, view } = turn;
  if (view.turn.devCardPlayed) return false;
  // `devCards` 是先前回合持有的卡；本回合新買的同類卡在 `newDevCards`，
  // 不影響舊卡是否可打出。
  return (me.devCards ?? []).includes(card);
}

export function plentyPick(
  turn: TurnContext,
  hand: Hand = turn.economy.hand,
  bank: Readonly<Record<Resource, number>> = turn.view.bank,
): Resource | null {
  const economy = turn.economy;
  const plan = economy.plans[0];
  // 先補下一步（例如通往聚落的道路），再補整個計畫。
  const next = deficitOf(hand, plan?.nextCost ?? {});
  const missing = deficitOf(hand, plan?.cost ?? {});
  const scored: Scored<Resource>[] = [];
  for (const resource of RESOURCES) {
    if (bank[resource] <= 0) continue;
    const score =
      (next[resource] > 0 ? 20 : 0) +
      (missing[resource] > 0 ? 10 + missing[resource] : 0) +
      economy.weights[resource] +
      (economy.yield[resource] === 0 ? 1 : 0);
    scored.push({ item: resource, score });
  }
  // 豐收之年拿的是確定需要的牌，不加隨機。
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item ?? null;
}
