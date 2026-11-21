/**
 * `tb-coins` 的子 kit：
 * - conservation：玩家 gold 合計加上 supply 恆為 100，沒有人是負的（rules `tb-*.test.ts` 的模擬局斷言）。
 * - perturb（fuzz）：隨機改動幾位玩家的 gold（與 supply 互補，總量不變）與本視窗已用的購買次數。gold 是公開資訊，
 *   所以沒有 `hideDifferently`。
 * - mechanics（Q2）：策略發出、被接受的 `tb.buyResource`／`tb.sellResources`，依難度分（`buy.standard`、`sell.easy`…）。
 */

import { GOLD_SUPPLY, PURCHASES_PER_TURN, type GameState, type Rng } from '@katan/rules';
import type { MechanicsTally } from '../types.ts';
import { partStateOf, sum, type TbPartKit } from './part.ts';

interface CoinsSlot {
  gold: Record<string, number>;
  supply: number;
  purchases: Record<string, { windowId: number; count: number }>;
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

/** 每位玩家有一半機率改成 0–11 gold（supply 不夠時取 supply 允許的最大值）；行動者有一半機率改掉本視窗的購買次數。 */
function perturb(state: GameState, rng: Rng): void {
  const slot = partStateOf<CoinsSlot>(state, 'tb-coins');
  if (!slot) return;
  for (const player of state.players) {
    if (rng.int(2) === 0) continue;
    const held = slot.gold[player.id] ?? 0;
    const next = Math.min(rng.int(12), held + slot.supply);
    slot.supply += held - next;
    slot.gold[player.id] = next;
  }
  const actor = state.players[state.turn.seat];
  if (actor && rng.int(2) === 1) {
    slot.purchases[actor.id] = { windowId: state.windowId, count: rng.int(PURCHASES_PER_TURN + 1) };
  }
}

function mechanics(): MechanicsTally {
  const counts: Record<string, number> = {};
  return {
    observe(step) {
      if (step.source !== 'policy') return;
      const kind = step.command.type === 'tb.buyResource' ? 'buy' : step.command.type === 'tb.sellResources' ? 'sell' : null;
      if (kind) counts[`${kind}.${step.level}`] = (counts[`${kind}.${step.level}`] ?? 0) + 1;
    },
    snapshot: () => ({ ...counts }),
  };
}

export const coinsPartKit: TbPartKit = { id: 'tb-coins', conservation, perturb, mechanics };
