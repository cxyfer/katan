/**
 * E&P 的固定盤面建構（ep-duty、ep-route 共用）：以 rules 的真實指令走完 setup 與擲骰，再直接改寫 moduleState
 * 製造擱淺、海盜 frame 等盤面。不經 `supports` 閘門，只靠保底 policy 驅動。
 */

import { applyCommand, moduleStateOf, topologyOf, type GameState, type GameView, type Rng } from '@katan/rules';
import { fallbackPolicy } from '../src/fallback.ts';
import { epHints, type EpHints } from '../src/modules/explorersPirates/view.ts';
import type { BotCommand, BotContext } from '../src/types.ts';
import { applyDecision, newBotGame, nextDecision, viewFor, type BotSeat } from './harness.ts';

export const EP_PROFILES = [
  'ep-land-ho-2025',
  'ep-pirate-lairs-2025',
  'ep-fish-2025',
  'ep-spices-2025',
  'ep-full-2025',
] as const;

export interface EpSlot {
  gold: Record<string, number>;
  fog: { hex: number; region: string }[];
  ships: { id: string; player: string; edge: number; cargo: string[] }[];
  harbors: { vertex: number; player: string; cargo: string[] }[];
  pirate: { hex: number; owner: string } | null;
  turn: {
    windowId: number;
    phase: 'action' | 'movement';
    active: string | null;
    ships: Record<string, { used: number; extra: boolean; done: boolean; tribute: boolean; chased: boolean }>;
    goldBuys: number;
    fastGold: number;
    fishRolled: boolean;
  };
  nextShip: number;
}

export const slotOf = (state: GameState): EpSlot => moduleStateOf<EpSlot>(state, 'explorersPirates')!;

export const ctxFor = (selfId: string): BotContext => ({ selfId, level: 'standard', seed: 1, offerPhases: {} });

export function fallbackSeats(players: number): BotSeat[] {
  return Array.from({ length: players }, (_, index) => ({ id: `bot${index + 1}`, level: 'standard' as const, policy: fallbackPolicy }));
}

/** 保底此刻對 `id` 的決策。 */
export const dutyOf = (state: GameState, id: string): BotCommand | null => fallbackPolicy.decide(viewFor(state, id), ctxFor(id));

/** 套用指令；被拒時丟出錯誤並附上代碼。 */
export function accept(state: GameState, actor: string, command: BotCommand, rng: Rng): GameState {
  const outcome = applyCommand(state, actor, command, rng);
  if (!outcome.ok) throw new Error(`${actor} ${JSON.stringify(command)} rejected: ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome.state;
}

/** 讓所有座位只走保底，直到 `done(state)` 成立（最多 `max` 步）。 */
export function driveUntil(
  game: { state: GameState; rng: Rng },
  players: number,
  done: (state: GameState) => boolean,
  max = 400,
): GameState {
  let state = game.state;
  const seats = fallbackSeats(players);
  for (let step = 0; step < max && !done(state); step++) {
    const decision = nextDecision(state, seats);
    if (!decision) throw new Error(`stalled at step ${step}`);
    const outcome = applyDecision(state, decision, game.rng);
    if (!outcome.ok) throw new Error(`rejected: ${JSON.stringify(outcome.failure)}`);
    state = outcome.state;
  }
  if (!done(state)) throw new Error('driveUntil: step limit');
  return state;
}

export function newEpGame(profileId: string, players: number, seed: number): { state: GameState; rng: Rng } {
  return newBotGame({ profileId, players, seed });
}

/** 走完 setup 與擲骰，停在第一位玩家的行動子階段。 */
export function toAction(profileId: string, players: number, seed: number): { state: GameState; rng: Rng; me: string } {
  const game = newEpGame(profileId, players, seed);
  const state = driveUntil(game, players, (candidate) => candidate.turn.phase === 'action' && !candidate.pending);
  return { state, rng: game.rng, me: state.players[state.turn.seat]!.id };
}

/** 讓行動者進入 Movement，並把 `ship` 設為移動中（`used` 為已走的步數）。 */
export function enterMovement(state: GameState, ship: string | null, used = 0): void {
  const slot = slotOf(state);
  slot.turn = {
    windowId: state.windowId,
    phase: 'movement',
    active: ship,
    ships: ship ? { [ship]: { used, extra: false, done: false, tribute: false, chased: false } } : {},
    goldBuys: 0,
    fastGold: 0,
    fishRolled: false,
  };
}

/** 在 `edge` 上補 `count` 艘對手的船（輪流指派給 `owners`）。 */
export function crowd(state: GameState, edge: number, count: number, owners: readonly string[]): void {
  const slot = slotOf(state);
  for (let i = 0; i < count; i++) {
    slot.ships.push({ id: `x${slot.nextShip++}`, player: owners[i % owners.length]!, edge, cargo: [] });
  }
}

/** 與 `edge` 共用端點的邊。 */
export function adjacentEdges(state: GameState, edge: number): number[] {
  const topo = topologyOf(state);
  const out = new Set<number>();
  for (const vertex of topo.edges[edge]!.vertices) for (const other of topo.vertices[vertex]!.edges) if (other !== edge) out.add(other);
  return [...out].sort((a, b) => a - b);
}

export const hintsOf = (view: GameView): EpHints => epHints(view.hints)!;
