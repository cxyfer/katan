/**
 * `tb-traders-barbarians` 的子 kit（T&B 計畫 §6.1–§6.3；S7）。
 *
 * - conservation：commodity 共 36 個（貨物堆 + 車上 + 已送達），3 個蠻族所在的邊互不相同（`rules/test/tb-traders.test.ts:457-463`）。
 * - hideDifferently（B-FAIR）：發展卡牌庫與對手的發展卡（含本回合新買的）、各貨物堆的內容與順序。投影只公開貨物堆的張數，
 *   所以兩個貨物堆各換一個不同的 commodity、再把每一堆倒序，投影不變。base 的 `hideDifferently` 另外換對手的資源與
 *   `devCards`、倒序牌庫。
 * - mechanics（Q2）：策略送出、被接受的指令造成的運貨次數（`tb.commodityDelivered` 事件），依 standard／easy 分開。
 */

import type { GameState } from '@catan/rules';
import type { MechanicsTally } from '../types.ts';
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

/** 兩個貨物堆各換一個不同的 commodity（張數不變），再把每一堆倒序。 */
function shuffleStacks(slot: TradersSlot): boolean {
  let changed = false;
  const stacks = Object.values(slot.stacks);
  outer: for (const a of stacks) {
    for (const b of stacks) {
      if (a === b) continue;
      const i = a.findIndex((token) => b.some((other) => other !== token));
      if (i < 0) continue;
      const j = b.findIndex((other) => other !== a[i]);
      [a[i], b[j]] = [b[j]!, a[i]!];
      changed = true;
      break outer;
    }
  }
  for (const stack of stacks) {
    if (stack.length > 1 && stack.some((token) => token !== stack[0])) {
      stack.reverse();
      changed = true;
    }
  }
  return changed;
}

function hideDifferently(variant: GameState, viewerId: string): boolean {
  let changed = false;
  const slot = partStateOf<TradersSlot>(variant, 'tb-traders-barbarians');
  if (slot && shuffleStacks(slot)) changed = true;
  // 對手本回合新買的發展卡與牌庫交換身分（base 只換 `devCards`）。
  for (const player of variant.players) {
    if (player.id === viewerId) continue;
    const index = player.newDevCards.findIndex((card) => variant.devDeck.some((other) => other !== card));
    if (index < 0) continue;
    const deckIndex = variant.devDeck.findIndex((other) => other !== player.newDevCards[index]);
    [player.newDevCards[index], variant.devDeck[deckIndex]] = [variant.devDeck[deckIndex]!, player.newDevCards[index]!];
    changed = true;
    break;
  }
  return changed;
}

function mechanics(): MechanicsTally {
  const counts: Record<string, number> = {};
  return {
    observe(step) {
      if (step.source !== 'policy') return;
      const delivered = step.events.filter((event) => event.type === 'tb.commodityDelivered').length;
      if (delivered === 0) return;
      const key = `delivered.${step.level}`;
      counts[key] = (counts[key] ?? 0) + delivered;
    },
    snapshot: () => ({ ...counts }),
  };
}

export const tradersPartKit: TbPartKit = { id: 'tb-traders-barbarians', conservation, hideDifferently, mechanics };
