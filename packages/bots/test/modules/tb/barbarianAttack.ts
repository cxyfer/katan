/**
 * `tb-barbarian-attack` 的子 kit：
 *
 * - conservation：盤上蠻族 + 俘虜 + supply 恆為 `BA_BARBARIAN_SUPPLY`（36），BA 牌庫 + 棄堆恆為 26，每個海岸格的蠻族不超過
 *   `CONQUER_AT`，每條邊最多一個騎士、每人不超過 `BA_KNIGHTS_PER_PLAYER`（`rules/test/tb-barbarians.test.ts:491-497`）。
 * - hideDifferently（B-FAIR，§6.1）：BA 牌庫是蓋著的（投影只有張數），把順序倒過來。
 * - perturb（fuzz）：洗亂 BA 牌庫；沒有待決 frame 時，在海岸格與 supply 之間搬一個蠻族（守恆與每格上限不變）。BA 沒有發展卡
 *   牌庫，harness 的擾動發給玩家的發展卡在這個劇本不可能出現，一併清掉。
 * - mechanics（Q2，§6.3）：策略送出的 BA 指令與它們造成的事件（俘虜、驅逐、征服、解放）。
 */

import { BA_BARBARIAN_SUPPLY, BA_DECK, BA_KNIGHTS_PER_PLAYER, CONQUER_AT, type GameState, type Rng } from '@catan/rules';
import type { MechanicsTally } from '../types.ts';
import { partStateOf, sum, type TbPartKit } from './part.ts';

interface BaSlot {
  coastal: number[];
  barbarians: Record<number, number>;
  supply: number;
  knights: { player: string; edge: number }[];
  prisoners: Record<string, number>;
  deck: string[];
  discard: string[];
}

const slotOf = (state: GameState): BaSlot | undefined => partStateOf<BaSlot>(state, 'tb-barbarian-attack');

function conservation(state: GameState): readonly string[] {
  const slot = slotOf(state);
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

/** 牌庫倒序；順序真的改變時回 true。 */
function hideDifferently(variant: GameState): boolean {
  const slot = slotOf(variant);
  if (!slot || slot.deck.length < 2) return false;
  const reversed = [...slot.deck].reverse();
  const changed = reversed.some((card, index) => card !== slot.deck[index]);
  slot.deck = reversed;
  return changed;
}

function perturb(state: GameState, rng: Rng): void {
  const slot = slotOf(state);
  if (!slot) return;
  for (const player of state.players) {
    player.devCards = [];
    player.newDevCards = [];
  }
  for (let i = slot.deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [slot.deck[i], slot.deck[j]] = [slot.deck[j]!, slot.deck[i]!];
  }
  // frame 進行中不搬：Capture／Treason 的候選依蠻族位置而定。
  if (state.pending) return;
  const hex = slot.coastal[rng.int(slot.coastal.length)]!;
  const count = slot.barbarians[hex] ?? 0;
  if (rng.int(2) === 0 && count > 0) {
    slot.barbarians[hex] = count - 1;
    slot.supply += 1;
  } else if (count < CONQUER_AT && slot.supply > 0) {
    slot.barbarians[hex] = count + 1;
    slot.supply -= 1;
  }
}

/** BA 的指令；計數名稱即指令名稱去掉 `tb.`。 */
const COMMANDS = ['tb.buildBaCard', 'tb.baCapture', 'tb.baPlaceKnight', 'tb.baTreason', 'tb.baSteal', 'tb.moveKnight', 'tb.endKnights'];

function mechanics(): MechanicsTally {
  const counts: Record<string, number> = {};
  const add = (name: string, amount = 1): void => {
    counts[name] = (counts[name] ?? 0) + amount;
  };
  return {
    observe(step) {
      if (step.source !== 'policy') return;
      if (COMMANDS.includes(step.command.type)) add(step.command.type.slice(3));
      if (step.command.type === 'tb.moveKnight' && (step.command as { boost?: unknown }).boost === true) add('boost');
      for (const event of step.events) {
        const params = event.params as Record<string, unknown>;
        if (event.type === 'tb.barbarianCaptured') add('prisoners');
        if (event.type === 'tb.barbariansExpelled') {
          add('expels');
          add('prisoners', sum(Object.values((params.prisoners ?? {}) as Record<string, number>)));
        }
        if (event.type === 'tb.hexConquered') add('conquered');
        if (event.type === 'tb.hexLiberated') add('liberated');
      }
    },
    snapshot: () => ({ ...counts }),
  };
}

export const barbarianAttackPartKit: TbPartKit = { id: 'tb-barbarian-attack', conservation, hideDifferently, perturb, mechanics };
