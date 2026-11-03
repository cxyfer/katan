/** Simple scenario bots for simulated Traders & Barbarians games. */
import { getTopology } from '../src/topology-registry.ts';

import { actionHints, applyCommand, type Command } from '../src/engine.ts';
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

/** Bridges when possible, buys with gold, sometimes sells for gold. */
export const riversBot: SimulationBot = {
  actions(state, actor, step) {
    const out: Command[] = [];
    const rivers = tb<{ bridgeSites: number[] }>(state, 'tb-rivers');
    for (const edge of rivers.bridgeSites) out.push({ type: 'tb.buildBridge', edge } as unknown as Command);
    const gold = tb<{ gold: Record<string, number> }>(state, 'tb-coins').gold[actor] ?? 0;
    if (gold >= 2) out.push({ type: 'tb.buyResource', resource: poorest(state, actor) } as unknown as Command);
    if (step % 4 === 0) {
      const player = state.players.find((candidate) => candidate.id === actor)!;
      const rich = RESOURCES.slice().sort((a, b) => player.resources[b] - player.resources[a])[0]!;
      out.push({ type: 'tb.sellResources', resource: rich } as unknown as Command);
    }
    return out;
  },
};

/** Bids a little, assigns and places on the first legal location. */
export const trainsBot: SimulationBot = {
  pending(state, rng) {
    const frame = state.pending as ModulePending | null;
    if (!frame?.kind.startsWith('tradersBarbarians.wagon')) return null;
    const actor = frame.responders[0]!;
    const hints = applyHints(state, actor);
    const first = (hints?.locations as number[] | undefined)?.[(state.seq % 3)] ?? (hints?.locations as number[] | undefined)?.[0];
    if (frame.kind === 'tradersBarbarians.wagonBid') {
      const player = state.players.find((candidate) => candidate.id === actor)!;
      const grain = state.seq % 2 === 0 && player.resources.grain > 0 ? 1 : 0;
      return tryCommand(state, actor, { type: 'tb.bidWagon', wool: 0, grain }, rng);
    }
    if (frame.kind === 'tradersBarbarians.wagonAssign') return tryCommand(state, actor, { type: 'tb.assignWagon', edge: first }, rng);
    return tryCommand(state, actor, { type: 'tb.placeWagon', edge: first }, rng);
  },
};

function applyHints(state: GameState, playerId: string): Record<string, unknown> | null {
  const modules = actionHints(state, playerId).modules as Record<string, Record<string, Record<string, unknown>>> | undefined;
  return modules?.tradersBarbarians?.['tb-merchant-trains'] ?? null;
}

/** Builds scenario cards, answers every card frame and moves castle knights toward barbarians. */
export const barbarianBot: SimulationBot = {
  pending(state, rng) {
    const frame = state.pending as ModulePending | null;
    if (!frame?.kind.startsWith('tradersBarbarians.ba')) return null;
    const actor = frame.responders[0]!;
    const modules = actionHints(state, actor).modules as Record<string, Record<string, Record<string, unknown>>>;
    const hints = modules.tradersBarbarians!['tb-barbarian-attack']!;
    const board = hints.board as { commandType: string; targets: number[]; kind: string } | null;
    if (board) {
      const target = board.targets[state.seq % board.targets.length];
      return tryCommand(state, actor, { type: board.commandType, [board.kind === 'hex' ? 'hex' : 'edge']: target }, rng);
    }
    if (frame.kind === 'tradersBarbarians.baSteal') {
      return tryCommand(state, actor, { type: 'tb.baSteal', victim: (hints.stealVictims as string[])[0] }, rng);
    }
    if (frame.kind === 'tradersBarbarians.baTreason') {
      const [from, to] = (hints.treasonMoves as [number, number][])[0]!;
      return tryCommand(state, actor, { type: 'tb.baTreason', from, to }, rng);
    }
    if (frame.kind === 'tradersBarbarians.baKnights') {
      const slot = tb<{ barbarians: Record<number, number>; coastal: number[] }>(state, 'tb-barbarian-attack');
      const topology = getTopologyOf(state);
      const wanted = new Set(slot.coastal.filter((hex) => (slot.barbarians[hex] ?? 0) > 0)
        .flatMap((hex) => topology.edges.map((info, edge) => (info.hexes.includes(hex) ? edge : -1)).filter((edge) => edge >= 0)));
      for (const move of hints.knightMoves as { from: number; targets: number[] }[]) {
        const to = move.targets.find((edge) => wanted.has(edge)) ?? move.targets[0];
        if (to === undefined) continue;
        const next = tryCommand(state, actor, { type: 'tb.moveKnight', from: move.from, to }, rng);
        if (next) return next;
      }
      return tryCommand(state, actor, { type: 'tb.endKnights' }, rng);
    }
    return null;
  },
  actions(_state, _actor, step) {
    return step % 2 === 0 ? [{ type: 'tb.buildBaCard' } as unknown as Command] : [];
  },
};

function getTopologyOf(state: GameState) {
  return getTopology(state.board.layout.topologyId);
}

/** Moves barbarians, upgrades and drives the wagon toward the nearest useful plaza. */
export const tradersBot: SimulationBot = {
  pending(state, rng) {
    const frame = state.pending as ModulePending | null;
    if (!frame?.kind.startsWith('tradersBarbarians.tb')) return null;
    const actor = frame.responders[0]!;
    const slot = tb<{ barbarians: number[]; wagons: Record<string, { vertex: number; cargo: string | null }>; sites: { id: string; plaza: number }[] }>(state, 'tb-traders-barbarians');
    if (frame.kind === 'tradersBarbarians.tbBarbarian') {
      const from = slot.barbarians[0]!;
      const to = state.board.roads.findIndex((road, edge) => !!road && road.player !== actor && !slot.barbarians.includes(edge));
      return tryCommand(state, actor, { type: 'tb.moveBarbarian', from, to: to >= 0 ? to : (from + 7) % 72 === from ? 1 : (from + 7) % 72 }, rng);
    }
    const modules = actionHints(state, actor).modules as Record<string, Record<string, Record<string, unknown>>>;
    const steps = (modules.tradersBarbarians!['tb-traders-barbarians']!.steps as number[]) ?? [];
    if (steps.length === 0 || state.seq % 7 === 0) return tryCommand(state, actor, { type: 'tb.wagonStop' }, rng);
    // Prefer a plaza, else wander deterministically.
    const plaza = steps.find((vertex) => slot.sites.some((site) => site.plaza === vertex));
    return tryCommand(state, actor, { type: 'tb.wagonStep', to: plaza ?? steps[state.seq % steps.length] }, rng);
  },
  actions(state, actor) {
    const out: Command[] = [{ type: 'tb.upgradeWagon' } as unknown as Command];
    const player = state.players.find((candidate) => candidate.id === actor)!;
    const slot = tb<{ barbarians: number[] }>(state, 'tb-traders-barbarians');
    if (player.devCards.includes('barbarianKnight')) {
      const to = (slot.barbarians[0]! + 11) % 72;
      if (!slot.barbarians.includes(to)) out.push({ type: 'tb.playKnight', from: slot.barbarians[0], to } as unknown as Command);
    }
    if (player.devCards.includes('swiftJourney')) out.push({ type: 'tb.playSwiftJourney' } as unknown as Command);
    return out;
  },
};
