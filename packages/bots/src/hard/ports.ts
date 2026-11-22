import { COSTS, RESOURCES, type HarborType } from '@katan/rules';
import { emptyYield, type Yield } from '../board.ts';
import type { Cost, KindTable } from '../economy.ts';
import { hardEtaRounds } from './eta.ts';

export const NO_PORT_RATES: KindTable = { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 };
export const PORT_TRADE_COSTS = [COSTS.city, COSTS.settlement, COSTS.devCard];
const EMPTY_HAND = emptyYield();

export function ratesWithPort(rates: KindTable, port: HarborType | null): KindTable {
  if (!port) return rates;
  if (port !== 'generic') return rates[port] <= 2 ? rates : { ...rates, [port]: 2 };
  if (RESOURCES.every((resource) => rates[resource] <= 3)) return rates;
  const upgraded = { ...rates };
  for (const resource of RESOURCES) upgraded[resource] = Math.min(3, rates[resource]);
  return upgraded;
}

/** 同產能、不同匯率的 ETA 差。以空手估計反覆建造的收益，不把蓋港所花的手牌計入。 */
export function portTradeValue(
  income: Yield,
  before: KindTable,
  after: KindTable,
  players: number,
  targets: readonly Cost[],
): number {
  if (before === after || targets.length === 0) return 0;
  let saved = 0;
  for (const cost of targets) {
    const oldEta = hardEtaRounds(EMPTY_HAND, cost, income, before, players);
    if (!Number.isFinite(oldEta)) continue;
    const newEta = hardEtaRounds(EMPTY_HAND, cost, income, after, players);
    saved += (oldEta - newEta) / (1 + oldEta);
  }
  return saved / targets.length;
}
