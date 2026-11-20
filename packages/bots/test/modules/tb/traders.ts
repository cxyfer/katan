/**
 * `tb-traders-barbarians` 的子 kit：commodity 共 36 個（貨物堆 + 車上 + 已送達），3 個蠻族所在的邊互不相同
 * （`rules/test/tb-traders.test.ts:457-463`）。
 */

import type { GameState } from '@catan/rules';
import { partStateOf, sum, type TbPartKit } from './part.ts';

interface TradersSlot {
  barbarians: number[];
  stacks: Record<string, string[]>;
  wagons: Record<string, { cargo: string | null; delivered: number }>;
}

const COMMODITY_TOKENS = 36;
const BARBARIANS = 3;

function conservation(state: GameState): readonly string[] {
  const slot = partStateOf<TradersSlot>(state, 'tb-traders-barbarians');
  if (!slot) return ['tb-traders-barbarians state missing'];
  const problems: string[] = [];
  const wagons = Object.values(slot.wagons);
  const tokens =
    sum(Object.values(slot.stacks).map((stack) => stack.length)) +
    sum(wagons.map((wagon) => wagon.delivered + (wagon.cargo ? 1 : 0)));
  if (tokens !== COMMODITY_TOKENS) problems.push(`commodity tokens ${tokens} != ${COMMODITY_TOKENS}`);
  if (slot.barbarians.length !== BARBARIANS || new Set(slot.barbarians).size !== BARBARIANS) {
    problems.push(`barbarians on ${slot.barbarians.length} edges, ${new Set(slot.barbarians).size} distinct`);
  }
  return problems;
}

export const tradersPartKit: TbPartKit = { id: 'tb-traders-barbarians', conservation };
