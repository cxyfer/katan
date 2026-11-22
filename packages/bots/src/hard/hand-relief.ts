import { COSTS, RESOURCES, type Command, type Resource } from '@katan/rules';
import { usefulRoad } from '../base/roads.ts';
import { canAfford, handSize, pay, type Cost } from '../economy.ts';
import { bankTradesThisTurn, handUtility } from '../trade.ts';
import { hurts } from './build.ts';
import type { HardTurn } from './turn.ts';

function reliefTrade(turn: HardTurn, target: Cost): Command | null {
  const { view, ctx, model, economy } = turn;
  const { hand, rates, weights } = economy;
  const surplus = (resource: Resource): number => hand[resource] - (target[resource] ?? 0);
  if (!RESOURCES.some((resource) => surplus(resource) >= rates[resource])) return null;

  const traded = bankTradesThisTurn(view, ctx.selfId);
  const otherCards = view.players.reduce((sum, player) => sum + (player.id === ctx.selfId ? 0 : player.handSize), 0);
  // 即使對手的牌全是同種，也要確定銀行至少有一張才送出交易。
  const receives = RESOURCES.filter((resource) =>
    !traded.gave.has(resource) && hand[resource] + otherCards < model.profile.bankPerResource,
  ).sort((first, second) =>
    Math.min(0, surplus(first)) - Math.min(0, surplus(second)) ||
    Number(surplus(first) + 1 >= rates[first]) - Number(surplus(second) + 1 >= rates[second]) ||
    weights[second] - weights[first],
  );
  let best: { give: Resource; receive: Resource; left: number } | null = null;
  for (const give of RESOURCES) {
    const left = surplus(give) - rates[give];
    if (left < 0 || traded.received.has(give) || (best && left <= best.left)) continue;
    const receive = receives.find((resource) => resource !== give);
    if (receive) best = { give, receive, left };
  }
  return best && { type: 'trade.bank', give: best.give, receive: best.receive };
}

function sevenRisk(turn: HardTurn): number {
  const players = turn.view.players.length;
  // 每骰有 1/6 擲出 7，至少一次的機率為 1 − (5/6)^rolls。一般局含自己下一次擲骰；
  // paired 第二位不擲骰，與第一位相隔三席，兩段分別跨 players − 3 骰與 3 骰。
  const rolls = turn.model.profile.paired ? (turn.pairedSecond ? 3 : players - 3) : players;
  return 1 - (5 / 6) ** rolls;
}

function expectedDiscardLoss(turn: HardTurn, target: Cost, count: number, before: number): number {
  const { economy } = turn;
  const { hand } = economy;
  const surplus = RESOURCES.map((resource) => ({ resource, count: hand[resource] - (target[resource] ?? 0) }))
    .filter((entry) => entry.count > 0);
  if (surplus.reduce((sum, entry) => sum + entry.count, 0) < count) return Infinity;

  // 還能保住主計畫時，優先棄掉效用最低的過剩牌。
  const order = surplus.map((entry) => ({
    ...entry, loss: before - handUtility(economy, pay(hand, { [entry.resource]: 1 }), target),
  })).sort((first, second) => first.loss - second.loss);
  let loss = 0;
  let remaining = count;
  for (const entry of order) {
    const take = Math.min(entry.count, remaining);
    loss += take * entry.loss;
    remaining -= take;
    if (remaining === 0) break;
  }
  return sevenRisk(turn) * loss;
}

export function hardHandRelief(turn: HardTurn): Command | null {
  const { view, economy } = turn;
  const size = handSize(economy.hand);
  if (size <= economy.handLimit) return null;
  const target = economy.plans[0]?.cost ?? {};
  const trade = reliefTrade(turn, target);
  if (trade) return trade;

  const canBuyDev = view.devDeckSize > 0 && canAfford(economy.hand, COSTS.devCard);
  if (canBuyDev && !hurts(economy, target, COSTS.devCard)) return { type: 'build.devCard' };
  const edge = economy.left.roads > 0 && canAfford(economy.hand, COSTS.road)
    ? usefulRoad(turn, economy.left.roads > 3)
    : null;
  if (edge !== null && !hurts(economy, target, COSTS.road)) return { type: 'build.road', edge };

  if (!canBuyDev && edge === null) return null;
  const before = handUtility(economy, economy.hand, target);
  const risk = expectedDiscardLoss(turn, target, Math.floor(size / 2), before);
  const worthBreaking = (cost: Cost): boolean => risk > before - handUtility(economy, pay(economy.hand, cost), target);
  if (canBuyDev && worthBreaking(COSTS.devCard)) return { type: 'build.devCard' };
  return edge !== null && worthBreaking(COSTS.road) ? { type: 'build.road', edge } : null;
}
