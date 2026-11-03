/** Fixtures for the Cities & Knights rules tests. */

import { neighborsOfVertex, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, createGame } from '../src/engine.ts';
import { verticesOfHex } from '../src/topology.ts';
import type { ModuleCommand } from '../src/modules/types.ts';
import { ckState, type Knight } from '../src/modules/citiesKnights/state.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import type { Commodity, GameState, ModulePending } from '../src/types.ts';
import { COLORS, CommandRejected, forceTurn, playerIds, type ActResult } from './helpers.ts';

export function ckGame(players: 3 | 4 | 5 | 6 = 4, seed = 12345): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const state = createGame({
    profileId: players <= 4 ? 'ck-2025' : 'ck-paired-2025',
    players: playerIds(players).map((id, index) => ({ id, nickname: id.toUpperCase(), color: COLORS[index]! })),
    setupMode: 'fixed',
    rng,
  });
  return { state, rng };
}

/** A C&K game past setup with an empty board, the turn on `seat`. */
export function emptyCkGame(players: 3 | 4 | 5 | 6 = 4, seat = 0, phase: 'preroll' | 'action' = 'action'): GameState {
  const { state } = ckGame(players);
  forceTurn(state, seat, phase);
  state.windowId += 1;
  return state;
}

export function actCk(state: GameState, actorId: string, command: ModuleCommand, rng: Rng = seededRng(1)): ActResult {
  const outcome = applyCommand(state, actorId, command, rng);
  if (!outcome.ok) throw new CommandRejected(outcome.error.code, outcome.error.params);
  return { state: outcome.state, events: outcome.events };
}

export function rejectCk(state: GameState, actorId: string, command: ModuleCommand, rng: Rng = seededRng(1)): string {
  const outcome = applyCommand(state, actorId, command, rng);
  if (outcome.ok) throw new Error(`expected a rejection for ${command.type}`);
  return outcome.error.code;
}

export function addKnight(state: GameState, knight: Knight): void {
  ckState(state).knights.push({ ...knight });
}

export function giveCommodities(state: GameState, playerId: string, commodities: Partial<Record<Commodity, number>>): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  for (const [commodity, amount] of Object.entries(commodities) as [Commodity, number][]) {
    player.commodities[commodity] += amount;
    state.commodityBank[commodity] -= amount;
  }
}

/**
 * Scripted rolls for `turn.roll`: yellow and red production dice (1–6) and
 * the event face index (0–2 ship, 3 science, 4 trade, 5 politics).
 */
export function rollRng(yellow: number, red: number, event: number, after: number[] = []): Rng {
  const values = [yellow - 1, red - 1, event, ...after];
  let cursor = 0;
  return {
    int(max: number): number {
      if (cursor >= values.length) return 0;
      const value = values[cursor++]!;
      if (value < 0 || value >= max) throw new Error(`scripted ${value} out of range for ${max}`);
      return value;
    },
  };
}

export const SHIP = 0;
export const SCIENCE = 3;
export const TRADE = 4;
export const POLITICS = 5;

export function moduleFrame(state: GameState): ModulePending | null {
  const frame = state.pending;
  return frame && 'module' in frame ? (frame as ModulePending) : null;
}

// --- board helpers -----------------------------------------------------------

export function hexWith(state: GameState, terrain: string, number?: number): number {
  const index = state.board.layout.terrain.findIndex((candidate, hex) => candidate === terrain && (number === undefined || state.board.layout.numbers[hex] === number));
  if (index < 0) throw new Error(`no ${terrain} hex${number === undefined ? '' : ` with ${number}`}`);
  return index;
}

export function cornersOf(state: GameState, hex: number): number[] {
  return verticesOfHex(topologyOf(state), hex);
}

export function edgeBetween(state: GameState, a: number, b: number): number {
  const topo = topologyOf(state);
  const edge = topo.vertices[a]!.edges.find((candidate) => topo.edges[candidate]!.vertices.includes(b));
  if (edge === undefined) throw new Error(`no edge between ${a} and ${b}`);
  return edge;
}

/** A simple vertex path of `length` steps from `start`, avoiding `avoid`. */
export function pathFrom(state: GameState, start: number, length: number, avoid: readonly number[] = []): number[] {
  const topo = topologyOf(state);
  const path = [start];
  while (path.length <= length) {
    const last = path.at(-1)!;
    const next = neighborsOfVertex(topo, last).find((candidate) => !path.includes(candidate) && !avoid.includes(candidate));
    if (next === undefined) throw new Error(`path from ${start} stuck at ${last}`);
    path.push(next);
  }
  return path;
}

/** Lays the player's roads along a vertex path; returns the edges. */
export function roadAlong(state: GameState, playerId: string, path: readonly number[]): number[] {
  const edges: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const edge = edgeBetween(state, path[i - 1]!, path[i]!);
    state.board.roads[edge] = { player: playerId, ship: false };
    edges.push(edge);
  }
  return edges;
}

export function setBuilding(state: GameState, playerId: string, vertex: number, city = false): void {
  state.board.buildings[vertex] = { player: playerId, city };
}

export function setImprovement(state: GameState, playerId: string, track: 'science' | 'trade' | 'politics', level: number): void {
  state.players.find((candidate) => candidate.id === playerId)!.improvements[track] = level;
}

export function player(state: GameState, playerId: string) {
  return state.players.find((candidate) => candidate.id === playerId)!;
}

export function hints(state: GameState, playerId: string): any {
  return actionHints(state, playerId).modules!.citiesKnights;
}

export function eventsOf(result: ActResult, type: string) {
  return result.events.filter((event) => event.type === type);
}

/** `count` intersections obeying the distance rule, avoiding `avoid` and their neighbours. */
export function spreadVertices(state: GameState, count: number, avoid: readonly number[] = []): number[] {
  const topo = topologyOf(state);
  const taken = new Set<number>();
  for (const vertex of avoid) {
    taken.add(vertex);
    for (const neighbour of neighborsOfVertex(topo, vertex)) taken.add(neighbour);
  }
  for (let vertex = 0; vertex < topo.vertices.length; vertex++) {
    if (state.board.buildings[vertex]) {
      taken.add(vertex);
      for (const neighbour of neighborsOfVertex(topo, vertex)) taken.add(neighbour);
    }
  }
  const out: number[] = [];
  for (let vertex = 0; vertex < topo.vertices.length && out.length < count; vertex++) {
    if (taken.has(vertex)) continue;
    out.push(vertex);
    taken.add(vertex);
    for (const neighbour of neighborsOfVertex(topo, vertex)) taken.add(neighbour);
  }
  if (out.length < count) throw new Error('board too crowded');
  return out;
}

// --- progress cards ------------------------------------------------------------

/** `progress.play` for a card put into the hand first. */
export function playCard(state: GameState, actorId: string, card: string, params: Record<string, unknown> = {}, rng?: Rng): ActResult {
  return actCk(state, actorId, { type: 'progress.play', card, ...params }, rng);
}

export function rejectCard(state: GameState, actorId: string, card: string, params: Record<string, unknown> = {}): string {
  return rejectCk(state, actorId, { type: 'progress.play', card, ...params });
}

/** Puts cards into a hand, taking them out of their decks to keep the 54 cards. */
export function handCards(state: GameState, playerId: string, cards: string[]): void {
  const hand = player(state, playerId).progressCards;
  for (const card of cards) {
    for (const track of ['science', 'trade', 'politics'] as const) {
      const index = state.progressDecks[track].indexOf(card as never);
      if (index >= 0) {
        state.progressDecks[track].splice(index, 1);
        break;
      }
    }
    hand.push(card as never);
  }
}

export function bottomOf(state: GameState, track: 'science' | 'trade' | 'politics'): string | undefined {
  return state.progressDecks[track].at(-1);
}

/** Any rng that must not be drawn from. */
export const NO_DRAW: Rng = {
  int() {
    throw new Error('unexpected draw');
  },
};

export function scripted(values: number[]): Rng {
  let cursor = 0;
  return {
    int(max: number): number {
      const value = values[cursor++];
      if (value === undefined) throw new Error('script exhausted');
      if (value < 0 || value >= max) throw new Error(`scripted ${value} out of range for ${max}`);
      return value;
    },
  };
}

export function totalHand(state: GameState, playerId: string): number {
  const p = player(state, playerId);
  return Object.values(p.resources).reduce((a, b) => a + b, 0) + Object.values(p.commodities).reduce((a, b) => a + b, 0);
}

/** A vertex path of `length` steps clear of `avoid` and its neighbours. */
export function freePath(state: GameState, length: number, avoid: readonly number[] = []): number[] {
  const topo = topologyOf(state);
  const blocked = new Set<number>(avoid);
  for (const vertex of avoid) for (const neighbour of neighborsOfVertex(topo, vertex)) blocked.add(neighbour);
  for (let start = 0; start < topo.vertices.length; start++) {
    if (blocked.has(start)) continue;
    try {
      return pathFrom(state, start, length, [...blocked]);
    } catch {
      // try the next start
    }
  }
  throw new Error('no free path');
}
