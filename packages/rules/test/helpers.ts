/** Shared fixtures for rules tests. */

import { applyCommand, createGame, type Command } from '../src/engine.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import { legalBuildingVertices, legalRoadEdges } from '../src/engine.ts';
import type { GameEvent, GameState, PlayerColor, Resource } from '../src/types.ts';

export const COLORS: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'green', 'brown'];

export function playerIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `p${i + 1}`);
}

export function newGame(
  options: { players?: number; seed?: number; mode?: 'fixed' | 'variable'; profileId?: string } = {},
): { state: GameState; rng: Rng } {
  const count = options.players ?? 4;
  const rng = seededRng(options.seed ?? 12345);
  const state = createGame({
    profileId: options.profileId ?? 'base-2025',
    players: playerIds(count).map((id, index) => ({
      id,
      nickname: id.toUpperCase(),
      color: COLORS[index]!,
    })),
    setupMode: options.mode ?? 'fixed',
    rng,
  });
  return { state, rng };
}

/** Deterministic scripted RNG for dice/steal/deck assertions. */
export function scriptedRng(values: number[]): Rng {
  let cursor = 0;
  return {
    int(maxExclusive: number): number {
      if (cursor >= values.length) throw new Error('scripted rng exhausted');
      const raw = values[cursor++]!;
      if (raw < 0 || raw >= maxExclusive) {
        throw new Error(`scripted value ${raw} out of range for ${maxExclusive}`);
      }
      return raw;
    },
  };
}

export class CommandRejected extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, unknown> | undefined,
  ) {
    super(`command rejected: ${code}`);
  }
}

export interface ActResult {
  state: GameState;
  events: GameEvent[];
}

export function act(
  state: GameState,
  actorId: string,
  command: Command,
  rng: Rng = seededRng(1),
): ActResult {
  const outcome = applyCommand(state, actorId, command, rng);
  if (!outcome.ok) throw new CommandRejected(outcome.error.code, outcome.error.params);
  return { state: outcome.state, events: outcome.events };
}

export function expectRejected(
  state: GameState,
  actorId: string,
  command: Command,
  code: string,
  rng: Rng = seededRng(1),
): void {
  const outcome = applyCommand(state, actorId, command, rng);
  if (outcome.ok) throw new Error(`expected rejection ${code} but command succeeded`);
  if (outcome.error.code !== code) {
    throw new Error(`expected rejection ${code}, got ${outcome.error.code}`);
  }
}

export interface SetupPlan {
  /** Optional explicit vertices/edges per placement step, else first legal. */
  vertices?: (number | undefined)[];
  edges?: (number | undefined)[];
}

/** Runs the whole initial placement phase, choosing the first legal option. */
export interface SetupRecord {
  seat: number;
  playerId: string;
  vertex?: number;
  edge?: number;
}

export function runSetup(
  state: GameState,
  rng: Rng = seededRng(7),
  plan: SetupPlan = {},
): GameState {
  return runSetupRecorded(state, rng, plan).state;
}

export function runSetupRecorded(
  state: GameState,
  rng: Rng = seededRng(7),
  plan: SetupPlan = {},
): { state: GameState; placements: SetupRecord[] } {
  const placements: SetupRecord[] = [];
  let current = state;
  let step = 0;
  while (current.turn.phase === 'setup') {
    const setup = current.turn.setup!;
    const seat = setup.order[setup.index]!;
    const actor = current.players[seat]!.id;
    if (setup.stage === 'building') {
      const wanted = plan.vertices?.[step];
      const legal = legalBuildingVertices(current, actor, { setup: true });
      const vertex = wanted ?? legal[0];
      if (vertex === undefined) throw new Error('no legal settlement during setup');
      placements.push({ seat, playerId: actor, vertex });
      current = act(current, actor, { type: 'setup.placeBuilding', vertex }, rng).state;
    } else {
      const wanted = plan.edges?.[step];
      const legal = legalRoadEdges(current, actor, { setup: true, lastVertex: setup.lastVertex });
      const edge = wanted ?? legal[0];
      if (edge === undefined) throw new Error('no legal road during setup');
      placements.push({ seat, playerId: actor, edge });
      current = act(current, actor, { type: 'setup.placeRoad', edge }, rng).state;
      step += 1;
    }
  }
  return { state: current, placements };
}

export function give(state: GameState, playerId: string, resources: Partial<Record<Resource, number>>): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  for (const [resource, amount] of Object.entries(resources) as [Resource, number][]) {
    player.resources[resource] += amount;
    state.bank[resource] -= amount;
  }
}

export function setDice(state: GameState, dice: [number, number]): void {
  state.turn.dice = dice;
}

/** Force the turn to a specific seat and phase without going through commands. */
export function forceTurn(state: GameState, seat: number, phase: 'preroll' | 'action'): void {
  state.turn.seat = seat;
  state.turn.phase = phase;
  state.turn.setup = null;
  state.pending = null;
  state.turn.devCardPlayed = false;
}

/** A game past setup, with the turn forced onto a chosen seat. */
export function playableGame(
  options: {
    players?: number;
    seed?: number;
    mode?: 'fixed' | 'variable';
    seat?: number;
    phase?: 'preroll' | 'action';
  } = {},
): { state: GameState; rng: Rng } {
  const { state } = newGame(options);
  const finished = runSetup(state, seededRng(options.seed ?? 12345));
  forceTurn(finished, options.seat ?? 0, options.phase ?? 'action');
  return { state: finished, rng: seededRng(1) };
}

export function placeBuilding(
  state: GameState,
  playerId: string,
  vertex: number,
  city = false,
): void {
  state.board.buildings[vertex] = { player: playerId, city };
}

export function placeRoad(state: GameState, playerId: string, edge: number, ship = false): void {
  state.board.roads[edge] = { player: playerId, ship };
}

export function setHand(state: GameState, playerId: string, resources: Partial<Record<Resource, number>>): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  player.resources = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...resources };
}

export function handOf(state: GameState, playerId: string): Record<Resource, number> {
  return { ...state.players.find((candidate) => candidate.id === playerId)!.resources };
}

export function handSize(state: GameState, playerId: string): number {
  const hand = handOf(state, playerId);
  return Object.values(hand).reduce((sum, amount) => sum + amount, 0);
}

/** First intersection/edge helpers for board manipulation. */
export function firstEmptyVertex(state: GameState, from = 0): number {
  for (let vertex = from; vertex < state.board.buildings.length; vertex++) {
    if (!state.board.buildings[vertex]) return vertex;
  }
  throw new Error('no empty vertex');
}

export function firstEmptyEdge(state: GameState, from = 0): number {
  for (let edge = from; edge < state.board.roads.length; edge++) {
    if (!state.board.roads[edge]) return edge;
  }
  throw new Error('no empty edge');
}

import { getTopology } from '../src/topology-registry.ts';

/** Places a simple path (no repeated intersection) of `length` roads. */
export function placePath(
  state: GameState,
  playerId: string,
  length: number,
  options: { startVertex?: number; avoid?: Set<number> } = {},
): number[] {
  const topo = getTopology(state.board.layout.topologyId);
  const avoid = options.avoid ?? new Set<number>();
  const starts =
    options.startVertex !== undefined ? [options.startVertex] : topo.vertices.map((_, index) => index);
  const usedEdges = new Set<number>();

  const search = (
    vertex: number,
    remaining: number,
    trail: number[],
    visited: Set<number>,
  ): number[] | null => {
    if (remaining === 0) return trail;
    for (const edge of topo.vertices[vertex]!.edges) {
      if (usedEdges.has(edge) || avoid.has(edge) || state.board.roads[edge]) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      if (visited.has(next)) continue;
      usedEdges.add(edge);
      visited.add(next);
      const found = search(next, remaining - 1, [...trail, edge], visited);
      if (found) return found;
      visited.delete(next);
      usedEdges.delete(edge);
    }
    return null;
  };

  for (const start of starts) {
    const found = search(start, length, [], new Set([start]));
    if (found) {
      for (const edge of found) state.board.roads[edge] = { player: playerId, ship: false };
      return found;
    }
  }
  throw new Error(`no path of length ${length} available`);
}

/** Edges of a hexagon around a chosen hex (a 6-road loop). */
export function hexLoopEdges(state: GameState, hex: number): number[] {
  const topo = getTopology(state.board.layout.topologyId);
  return topo.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.hexes.length === 2 && edge.hexes.includes(hex))
    .map(({ index }) => index);
}

/** The inland hex of the standard board, which has six inland neighbours. */
export function centreHex(state: GameState): number {
  return state.board.layout.terrain.findIndex((_, hex) => hexLoopEdges(state, hex).length === 6);
}

/** Places `arms` simple paths of `armLength` roads radiating from one intersection. */
export function placeStar(
  state: GameState,
  playerId: string,
  armLength: number,
  arms = 3,
): number[] {
  const topo = getTopology(state.board.layout.topologyId);
  for (let centre = 0; centre < topo.vertices.length; centre++) {
    const incident = topo.vertices[centre]!.edges;
    if (incident.length < arms) continue;
    const usedEdges = new Set<number>();
    const visited = new Set<number>([centre]);
    const placed: number[] = [];
    let ok = true;
    for (const first of incident.slice(0, arms)) {
      if (usedEdges.has(first)) {
        ok = false;
        break;
      }
      let vertex = centre;
      let edge = first;
      for (let step = 0; step < armLength; step++) {
        if (usedEdges.has(edge) || state.board.roads[edge]) {
          ok = false;
          break;
        }
        const [a, b] = topo.edges[edge]!.vertices;
        const next = a === vertex ? b : a;
        if (visited.has(next)) {
          ok = false;
          break;
        }
        usedEdges.add(edge);
        visited.add(next);
        placed.push(edge);
        vertex = next;
        if (step < armLength - 1) {
          const candidates = topo.vertices[vertex]!.edges.filter(
            (candidate) =>
              !usedEdges.has(candidate) && !visited.has(
                topo.edges[candidate]!.vertices[0] === vertex
                  ? topo.edges[candidate]!.vertices[1]
                  : topo.edges[candidate]!.vertices[0],
              ),
          );
          if (candidates.length === 0) {
            ok = false;
            break;
          }
          edge = candidates[0]!;
        }
      }
      if (!ok) break;
    }
    if (ok) {
      for (const edge of placed) state.board.roads[edge] = { player: playerId, ship: false };
      return placed;
    }
  }
  throw new Error('no star fixture available');
}
