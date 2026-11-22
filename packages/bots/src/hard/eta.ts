import { RESOURCES } from '@katan/rules';
import type { Yield } from '../board.ts';
import type { Cost, Hand, KindTable } from '../economy.ts';

/** 以期望產量並行補缺；保留計畫成本後，同種資源湊足一整筆才可換匯。 */
export function hardEtaRounds(hand: Hand, cost: Cost, income: Yield, rates: KindTable, players: number): number {
  let missing = 0;
  let trades = 0;
  const production = [];
  for (const resource of RESOURCES) {
    const surplus = hand[resource] - (cost[resource] ?? 0);
    const rate = rates[resource];
    const pips = income[resource];
    if (surplus < 0) missing -= surplus;
    else trades += Math.floor(surplus / rate);
    if (pips <= 0) continue;
    const next = surplus < 0 ? 1 : rate - (surplus % rate);
    production.push({ surplus, rate, pips, next, time: next / pips });
  }
  if (missing === 0) return 0;
  if (trades >= missing) return 0.25;
  if (production.length === 0) return Infinity;

  // 每次事件補一張（直產或換匯），因此最多走初始缺牌數次，不必逐輪模擬。
  for (let remaining = missing - trades; ; remaining--) {
    let first = production[0]!;
    for (const source of production) if (source.time < first.time) first = source;
    if (remaining === 1) return (first.time * 36) / players;
    first.next += first.surplus + first.next < 0 ? 1 : first.rate;
    first.time = first.next / first.pips;
  }
}
