/** Simple scenario bots for simulated Traders & Barbarians games. */

import { applyCommand, type Command } from '../src/engine.ts';
import { moduleStateOf } from '../src/modules/state.ts';
import type { seededRng } from '../src/rng.ts';
import { RESOURCES, type GameState, type ModulePending, type Resource } from '../src/types.ts';
import type { SimulationBot } from './simulate.ts';

type Rng = ReturnType<typeof seededRng>;

export function tb<T>(state: GameState, part: string): T {
  return (moduleStateOf<Record<string, unknown>>(state, 'tradersBarbarians')![part]) as T;
}

export function tryCommand(state: GameState, actor: string, command: Record<string, unknown>, rng: Rng): GameState | null {
  const outcome = applyCommand(state, actor, command as unknown as Command, rng);
  return outcome.ok ? outcome.state : null;
}

function poorest(state: GameState, actor: string): Resource {
  const player = state.players.find((candidate) => candidate.id === actor)!;
  return RESOURCES.slice().sort((a, b) => player.resources[a] - player.resources[b])[0]!;
}

/** Smallest set of tokens (largest first) covering a cost. */
export function payWith(hand: number[], cost: number): number[] | null {
  const sorted = hand.slice().sort((a, b) => b - a);
  const out: number[] = [];
  let sum = 0;
  for (const value of sorted) {
    if (sum >= cost) break;
    out.push(value);
    sum += value;
  }
  return sum >= cost ? out : null;
}

export const fishingBot: SimulationBot = {
  pending(state, rng) {
    const frame = state.pending as ModulePending | null;
    if (frame?.kind !== 'tradersBarbarians.fishSwap') return null;
    const actor = frame.responders[0]!;
    const hand = tb<{ hands: Record<string, number[]> }>(state, 'tb-fishing').hands[actor] ?? [];
    const lowest = hand.slice().sort()[0];
    return tryCommand(state, actor, { type: 'tb.fishSwap', token: state.seq % 2 === 0 && lowest ? lowest : null }, rng);
  },
  actions(state, actor, step) {
    const slot = tb<{ hands: Record<string, number[]>; boot: string | null }>(state, 'tb-fishing');
    const hand = slot.hands[actor] ?? [];
    const out: Command[] = [];
    const take = payWith(hand, 4);
    if (take) out.push({ type: 'tb.spendFish', action: 'takeResource', tokens: take, resource: poorest(state, actor) } as unknown as Command);
    const steal = payWith(hand, 3);
    const victim = state.players.find((player) => player.id !== actor && RESOURCES.some((resource) => player.resources[resource] > 0));
    if (steal && victim && step % 2 === 0) out.push({ type: 'tb.spendFish', action: 'steal', tokens: steal, victim: victim.id } as unknown as Command);
    const robber = payWith(hand, 2);
    if (robber && state.board.robber >= 0 && step % 3 === 0) out.push({ type: 'tb.spendFish', action: 'removeRobber', tokens: robber } as unknown as Command);
    if (slot.boot === actor) {
      for (const player of state.players) if (player.id !== actor) out.push({ type: 'tb.giveBoot', to: player.id } as unknown as Command);
    }
    return out;
  },
};
