/**
 * `tb-fishing` 的子 kit：
 *
 * - conservation：各面額的 supply + 棄堆 + 手牌恆為 `FISH_SUPPLY`（[11,10,8]），舊靴只有 1 個（在 supply 或在某人手上），手牌不超過
 *   `FISH_LIMIT`（`rules/test/tb-fishing.test.ts:426`）。
 * - hideDifferently（B-FAIR，§6.1）：對手的魚片面額（片數不變）與蓋著的 supply 的組成（總數不變）。每位對手各把一片魚與 supply 中
 *   另一種面額交換，守恆不變；投影只有片數與 supply 總數，所以不變。
 * - perturb（fuzz）：同樣在手牌與 supply 之間交換面額；手上未滿時從 supply 補一片；舊靴還在 supply 時偶爾發給某位玩家。
 * - mechanics（Q2，§6.3）：策略送出的花魚（依用途）、交出舊靴、交換與放棄交換。
 */

import { FISH_LIMIT, FISH_SUPPLY, type GameState, type Rng } from '@katan/rules';
import type { MechanicsTally } from '../types.ts';
import { partStateOf, type TbPartKit } from './part.ts';

interface FishingSlot {
  supply: { fish: [number, number, number]; boot: number };
  discard: [number, number, number];
  hands: Record<string, number[]>;
  boot: string | null;
}

const slotOf = (state: GameState): FishingSlot | undefined => partStateOf<FishingSlot>(state, 'tb-fishing');

function conservation(state: GameState): readonly string[] {
  const slot = slotOf(state);
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

/**
 * 把 `hand` 的第 `at` 片換成 supply 中的另一種面額（`pick` 決定從候選中取哪一個）；supply 的組成隨之改變，總數與守恆不變。
 * 換成功時回 true。
 */
function swapWithSupply(slot: FishingSlot, hand: number[], at: number, pick: (count: number) => number): boolean {
  const token = hand[at]!;
  const others = [1, 2, 3].filter((value) => value !== token && slot.supply.fish[value - 1]! > 0);
  if (others.length === 0) return false;
  const value = others[pick(others.length)]!;
  slot.supply.fish[value - 1]! -= 1;
  slot.supply.fish[token - 1]! += 1;
  hand[at] = value;
  return true;
}

function hideDifferently(variant: GameState, viewerId: string): boolean {
  const slot = slotOf(variant);
  if (!slot) return false;
  let changed = false;
  for (const player of variant.players) {
    if (player.id === viewerId) continue;
    const hand = slot.hands[player.id] ?? [];
    for (let at = 0; at < hand.length; at++) {
      if (swapWithSupply(slot, hand, at, () => 0)) {
        changed = true;
        break;
      }
    }
  }
  return changed;
}

function perturb(state: GameState, rng: Rng): void {
  const slot = slotOf(state);
  if (!slot) return;
  for (const player of state.players) {
    const hand = (slot.hands[player.id] ??= []);
    if (hand.length > 0 && rng.int(2) === 0) swapWithSupply(slot, hand, rng.int(hand.length), (count) => rng.int(count));
    if (hand.length < FISH_LIMIT && rng.int(2) === 0) {
      const values = [1, 2, 3].filter((value) => slot.supply.fish[value - 1]! > 0);
      if (values.length > 0) {
        const value = values[rng.int(values.length)]!;
        slot.supply.fish[value - 1]! -= 1;
        hand.push(value);
      }
    }
  }
  if (slot.boot === null && slot.supply.boot === 1 && rng.int(4) === 0) {
    slot.supply.boot = 0;
    slot.boot = state.players[rng.int(state.players.length)]!.id;
  }
}

function mechanics(): MechanicsTally {
  const counts: Record<string, number> = {};
  const add = (name: string): void => {
    counts[name] = (counts[name] ?? 0) + 1;
  };
  return {
    observe(step) {
      if (step.source !== 'policy') return;
      const command = step.command as { type: string; action?: unknown; token?: unknown };
      if (command.type === 'tb.spendFish') {
        add('spendFish');
        add(`spend.${String(command.action)}`);
        add(`spendFish.${step.level}`);
      } else if (command.type === 'tb.giveBoot') {
        add('giveBoot');
      } else if (command.type === 'tb.fishSwap') {
        add(command.token === null ? 'swapDeclined' : 'swap');
      }
    },
    snapshot: () => ({ ...counts }),
  };
}

export const fishingPartKit: TbPartKit = { id: 'tb-fishing', conservation, hideDifferently, perturb, mechanics };
