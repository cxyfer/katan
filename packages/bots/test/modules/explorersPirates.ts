/**
 * Explorers & Pirates 的 ModuleTestKit（E&P 計畫 §6.1；E1）。kit 的 `id` 是 rules module id `explorersPirates`。
 *
 * - conservation：金幣 148 枚、魚 6 份（有魚任務時）、棋子不超過 `EP_PIECES`、每邊最多 2 艘船。每邊上限的
 *   豁免（C7）：移動中的船穿越滿格邊時該邊暫時有 3 艘，所以只有行動者 active 船所在的邊可以有 3 艘；
 *   ep-2025.2（#97）只允許進入之後仍有出口的滿格邊，靜止的 3 艘一律違規，超過 3 艘也一律違規。
 * - hideDifferently：打亂牌堆內部順序（discs、abilities、lairTokens），view 不投影這些；
 * - perturb：在只有 1 艘船的邊上，替非行動者補一艘空船，製造滿格邊（不超過每人 3 艘）；
 * - mechanics：策略送出的 `ep.*` 事件計數（保底代送的不算，Q2 只看策略）；
 * - responseCommands：E&P 沒有非行動者的額外指令（海盜 frame 只有行動者作答）。
 *
 * 不得 import `rules/test/*`。rules 的 E&P 狀態型別沒有匯出，這裡只宣告會讀的欄位。
 */

import {
  EP_COIN_SUPPLY,
  EP_FISH_HAULS,
  EP_PIECES,
  epScenario,
  moduleStateOf,
  type GameState,
  type Rng,
} from '@katan/rules';
import type { MechanicsTally, ModuleTestKit } from './types.ts';

const ID = 'explorersPirates';

interface Piece {
  vertex?: number;
  player: string;
  cargo: string[];
}

interface Slot {
  scenario: string;
  gold: Record<string, number>;
  goldSupply: number;
  fishSupply: number;
  ships: { id: string; player: string; edge: number; cargo: string[] }[];
  harbors: Piece[];
  sites: { kind: string; fish?: boolean; crews?: string[] }[];
  pools: Record<string, { discs: number[]; abilities: string[] }>;
  lairTokens: number[];
  nextShip: number;
  turn?: { active: string | null };
}

const slotOf = (state: GameState): Slot | undefined => moduleStateOf<Slot>(state, ID);
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function conservation(state: GameState): readonly string[] {
  const slot = slotOf(state);
  if (!slot) return ['explorersPirates state missing'];
  const problems: string[] = [];
  const gold = slot.goldSupply + sum(Object.values(slot.gold));
  if (gold !== EP_COIN_SUPPLY) problems.push(`gold ${gold} != ${EP_COIN_SUPPLY}`);
  const cargo = [...slot.ships, ...slot.harbors].flatMap((holder) => holder.cargo);
  const fish = slot.fishSupply + slot.sites.filter((site) => site.kind === 'shoal' && site.fish).length + cargo.filter((piece) => piece === 'fish').length;
  // 依劇本判斷有沒有魚任務；不能用「總數 > 0」，否則魚全數消失的回歸會被漏掉。
  const hasFish = epScenario(slot.scenario).missions.includes('fish');
  if (hasFish && fish !== EP_FISH_HAULS) problems.push(`fish hauls ${fish} != ${EP_FISH_HAULS}`);
  const turnPlayer = state.players[state.turn.seat]?.id;
  for (const player of state.players) {
    const ships = slot.ships.filter((ship) => ship.player === player.id).length;
    if (ships > EP_PIECES.ships) problems.push(`${player.id} has ${ships} ships > ${EP_PIECES.ships}`);
    const harbors = slot.harbors.filter((harbor) => harbor.player === player.id).length;
    if (harbors > EP_PIECES.harbors) problems.push(`${player.id} has ${harbors} harbours > ${EP_PIECES.harbors}`);
    const mine = [...slot.ships, ...slot.harbors].filter((holder) => holder.player === player.id).flatMap((holder) => holder.cargo);
    const settlers = mine.filter((piece) => piece === 'settler').length;
    if (settlers > EP_PIECES.settlers) problems.push(`${player.id} has ${settlers} settlers > ${EP_PIECES.settlers}`);
    // 與 rules 的 piecesInPlay 相同：船上、harbour 上，加上駐在巢穴與香料農場的 crew。
    const stationed = slot.sites.flatMap((site) => site.crews ?? []).filter((id) => id === player.id).length;
    const crews = mine.filter((piece) => piece === 'crew').length + stationed;
    if (crews > EP_PIECES.crews) problems.push(`${player.id} has ${crews} crews > ${EP_PIECES.crews}`);
    const plain = state.board.buildings.filter((building) => building?.player === player.id).length - harbors;
    if (plain > EP_PIECES.settlements) problems.push(`${player.id} has ${plain} plain settlements > ${EP_PIECES.settlements}`);
  }
  const perEdge = new Map<number, string[]>();
  for (const ship of slot.ships) perEdge.set(ship.edge, [...(perEdge.get(ship.edge) ?? []), ship.player]);
  // C7：只豁免行動者 active 船所在的那一條邊（正在穿越滿格邊時暫時有 3 艘）。
  const active = slot.ships.find((ship) => ship.id === slot.turn?.active && ship.player === turnPlayer);
  for (const [edge, owners] of perEdge) {
    const exempt = owners.length === 3 && active !== undefined && active.edge === edge;
    if (owners.length > 2 && !exempt) problems.push(`edge ${edge} holds ${owners.length} ships`);
  }
  return problems;
}

/** 就地旋轉（長度 > 1 且不是全部相同時順序一定會變）。 */
function rotate(values: unknown[]): boolean {
  if (values.length < 2 || values.every((value) => value === values[0])) return false;
  values.push(values.shift());
  return true;
}

function hideDifferently(variant: GameState, _viewerId: string): boolean {
  const slot = slotOf(variant);
  if (!slot) return false;
  let changed = false;
  for (const pool of Object.values(slot.pools)) {
    if (rotate(pool.discs)) changed = true;
    if (rotate(pool.abilities)) changed = true;
  }
  if (rotate(slot.lairTokens)) changed = true;
  return changed;
}

function perturb(state: GameState, rng: Rng): void {
  const slot = slotOf(state);
  if (!slot || state.pending || state.turn.phase === 'setup') return;
  const turnPlayer = state.players[state.turn.seat]?.id;
  const lone = slot.ships.filter((ship) => slot.ships.filter((other) => other.edge === ship.edge).length === 1);
  const owners = state.players.filter((player) => player.id !== turnPlayer && slot.ships.filter((ship) => ship.player === player.id).length < EP_PIECES.ships);
  if (lone.length === 0 || owners.length === 0) return;
  const at = lone[rng.int(lone.length)]!;
  const owner = owners[rng.int(owners.length)]!;
  slot.ships.push({ id: `s${slot.nextShip++}`, player: owner.id, edge: at.edge, cargo: [] });
}

function mechanics(): MechanicsTally {
  const counts: Record<string, number> = {};
  return {
    observe(step) {
      if (step.source !== 'policy') return;
      for (const event of step.events) {
        if (!event.type.startsWith('ep.')) continue;
        const name = event.type.slice(3);
        counts[name] = (counts[name] ?? 0) + 1;
      }
    },
    snapshot: () => ({ ...counts }),
  };
}

export const explorersPiratesKit: ModuleTestKit = {
  id: ID,
  conservation,
  hideDifferently,
  perturb,
  responseCommands: [],
  mechanics,
};
