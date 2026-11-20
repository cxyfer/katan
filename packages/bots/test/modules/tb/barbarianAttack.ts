/**
 * `tb-barbarian-attack` 的子 kit：盤上蠻族 + 俘虜 + supply 恆為 `BA_BARBARIAN_SUPPLY`（36），BA 牌庫 + 棄堆恆為 26，
 * 每個海岸格的蠻族不超過 `CONQUER_AT`，每條邊最多一個騎士、每人不超過 `BA_KNIGHTS_PER_PLAYER`
 * （`rules/test/tb-barbarians.test.ts:491-497`）。
 */

import { BA_BARBARIAN_SUPPLY, BA_DECK, BA_KNIGHTS_PER_PLAYER, CONQUER_AT, type GameState } from '@catan/rules';
import { partStateOf, sum, type TbPartKit } from './part.ts';

interface BaSlot {
  barbarians: Record<number, number>;
  supply: number;
  knights: { player: string; edge: number }[];
  prisoners: Record<string, number>;
  deck: string[];
  discard: string[];
}

function conservation(state: GameState): readonly string[] {
  const slot = partStateOf<BaSlot>(state, 'tb-barbarian-attack');
  if (!slot) return ['tb-barbarian-attack state missing'];
  const problems: string[] = [];
  const onBoard = sum(Object.values(slot.barbarians));
  const total = onBoard + sum(Object.values(slot.prisoners)) + slot.supply;
  if (total !== BA_BARBARIAN_SUPPLY) problems.push(`barbarians ${total} != ${BA_BARBARIAN_SUPPLY}`);
  for (const [hex, count] of Object.entries(slot.barbarians)) {
    if (count < 0 || count > CONQUER_AT) problems.push(`hex ${hex} has ${count} barbarians`);
  }
  const cards = slot.deck.length + slot.discard.length;
  if (cards !== BA_DECK.length) problems.push(`BA cards ${cards} != ${BA_DECK.length}`);
  if (new Set(slot.knights.map((knight) => knight.edge)).size !== slot.knights.length) problems.push('two knights share an edge');
  for (const player of state.players) {
    const own = slot.knights.filter((knight) => knight.player === player.id).length;
    if (own > BA_KNIGHTS_PER_PLAYER) problems.push(`${player.id} has ${own} knights > ${BA_KNIGHTS_PER_PLAYER}`);
  }
  return problems;
}

export const barbarianAttackPartKit: TbPartKit = { id: 'tb-barbarian-attack', conservation };
