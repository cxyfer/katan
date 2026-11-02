/** Helpers for the Explorers & Pirates (CN3085) fixtures. */

import { topologyOf } from '../src/analysis.ts';
import { applyCommand, createGame, type Command } from '../src/engine.ts';
import { fogAtEnds, isSeaRoute } from '../src/modules/explorersPirates/geometry.ts';
import type { EpShip } from '../src/modules/explorersPirates/state.ts';
import type { EpScenarioId } from '../src/explorers-pirates-boards.ts';
import { epState } from '../src/modules/explorersPirates/state.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import { COLORS, forceTurn, playerIds } from './helpers.ts';

export const EP_PROFILE: Record<EpScenarioId, string> = {
  'land-ho': 'ep-land-ho-2025',
  'pirate-lairs': 'ep-pirate-lairs-2025',
  fish: 'ep-fish-2025',
  spices: 'ep-spices-2025',
  'explorers-pirates': 'ep-full-2025',
};

export function epGame(scenario: EpScenarioId, players: 3 | 4 = 4, seed = 12345): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const fixed = scenario === 'land-ho' || scenario === 'pirate-lairs';
  const state = createGame({
    profileId: EP_PROFILE[scenario],
    players: playerIds(players).map((id, index) => ({ id, nickname: id.toUpperCase(), color: COLORS[index]! })),
    setupMode: fixed ? 'fixed' : 'variable',
    rng,
  });
  return { state, rng };
}

export { epState };

export type AnyCommand = Command | { type: string; [field: string]: unknown };

export function run(state: GameState, actor: string, command: AnyCommand, rng: Rng = seededRng(1)) {
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (!outcome.ok) throw new Error(`rejected ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome;
}

export function refused(state: GameState, actor: string, command: AnyCommand, rng: Rng = seededRng(1)): string {
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (outcome.ok) throw new Error(`expected a refusal of ${command.type}`);
  return outcome.error.code;
}

export function landHo(players: 3 | 4 = 4): GameState {
  const { state } = epGame('land-ho', players);
  forceTurn(state, 0, 'action');
  state.windowId += 1;
  return state;
}

export function shipOf(state: GameState, playerId: string): EpShip {
  return epState(state).ships.find((ship) => ship.player === playerId)!;
}

/** Edges sharing an end with `edge` that ships may use. */
export function nextEdges(state: GameState, edge: number): number[] {
  const topo = topologyOf(state);
  return topo.edges[edge]!.vertices.flatMap((vertex) => topo.vertices[vertex]!.edges)
    .filter((other) => other !== edge && isSeaRoute(state, other));
}

/** A sea route away from fog with a neighbour whose end touches exactly one unexplored hex. */
export function exploringPair(state: GameState): { from: number; to: number } {
  const topo = topologyOf(state);
  for (let from = 0; from < topo.edges.length; from++) {
    if (!isSeaRoute(state, from) || fogAtEnds(state, from).length > 0) continue;
    const to = nextEdges(state, from).find((edge) => fogAtEnds(state, edge).length === 1);
    if (to !== undefined) return { from, to };
  }
  throw new Error('no exploring step');
}

export function edgeOfHex(state: GameState, hexIndex: number): number {
  const topo = topologyOf(state);
  const edge = topo.edges.findIndex((info, index) => info.hexes.includes(hexIndex) && isSeaRoute(state, index) && fogAtEnds(state, index).length === 0);
  if (edge < 0) throw new Error(`no sea edge at ${hexIndex}`);
  return edge;
}

export function gold(state: GameState, playerId: string): number {
  return epState(state).gold[playerId] ?? 0;
}

