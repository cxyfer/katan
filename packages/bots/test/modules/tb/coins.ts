/** `tb-coins` 的子 kit：玩家 gold 合計加上 supply 恆為 100，沒有人是負的（rules `tb-*.test.ts` 的模擬局斷言）。 */

import { GOLD_SUPPLY, type GameState } from '@catan/rules';
import { partStateOf, sum, type TbPartKit } from './part.ts';

interface CoinsSlot {
  gold: Record<string, number>;
  supply: number;
}

function conservation(state: GameState): readonly string[] {
  const slot = partStateOf<CoinsSlot>(state, 'tb-coins');
  if (!slot) return ['tb-coins state missing'];
  const problems: string[] = [];
  const total = slot.supply + sum(Object.values(slot.gold));
  if (total !== GOLD_SUPPLY) problems.push(`gold ${total} != ${GOLD_SUPPLY}`);
  if (slot.supply < 0) problems.push(`gold supply < 0: ${slot.supply}`);
  for (const [id, amount] of Object.entries(slot.gold)) if (amount < 0) problems.push(`${id} gold < 0: ${amount}`);
  return problems;
}

export const coinsPartKit: TbPartKit = { id: 'tb-coins', conservation };
