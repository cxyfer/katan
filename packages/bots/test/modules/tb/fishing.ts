/**
 * `tb-fishing` 的子 kit：各面額的 supply + 棄堆 + 手牌恆為 `FISH_SUPPLY`（[11,10,8]），舊靴只有 1 個（在 supply 或在某人
 * 手上），手牌不超過 `FISH_LIMIT`（`rules/test/tb-fishing.test.ts:426`）。
 */

import { FISH_LIMIT, FISH_SUPPLY, type GameState } from '@catan/rules';
import { partStateOf, type TbPartKit } from './part.ts';

interface FishingSlot {
  supply: { fish: [number, number, number]; boot: number };
  discard: [number, number, number];
  hands: Record<string, number[]>;
  boot: string | null;
}

function conservation(state: GameState): readonly string[] {
  const slot = partStateOf<FishingSlot>(state, 'tb-fishing');
  if (!slot) return ['tb-fishing state missing'];
  const problems: string[] = [];
  const hands = Object.values(slot.hands);
  FISH_SUPPLY.forEach((expected, index) => {
    const value = index + 1;
    const held = hands.reduce((total, hand) => total + hand.filter((token) => token === value).length, 0);
    const total = slot.supply.fish[index]! + slot.discard[index]! + held;
    if (total !== expected) problems.push(`${value}-fish tokens ${total} != ${expected}`);
  });
  const boots = slot.supply.boot + (slot.boot === null ? 0 : 1);
  if (boots !== 1) problems.push(`old boots ${boots} != 1`);
  for (const [id, hand] of Object.entries(slot.hands)) {
    if (hand.length > FISH_LIMIT) problems.push(`${id} holds ${hand.length} fish tokens > ${FISH_LIMIT}`);
  }
  return problems;
}

export const fishingPartKit: TbPartKit = { id: 'tb-fishing', conservation };
