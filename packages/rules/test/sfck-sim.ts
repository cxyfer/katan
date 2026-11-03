/**
 * Whole Seafarers + Cities & Knights games on Heading for New Shores: the
 * C&K scripted player (ck-sim.ts) plus ships, gold, the pirate chase and
 * Road Building with ships.
 */

import { topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { ckView } from '../src/modules/citiesKnights/state.ts';
import type { Rng } from '../src/rng.ts';
import { RESOURCES, type GameState, type ModulePending, type Resource } from '../src/types.ts';
import { simulateCitiesKnights, type AnyCommand, type CkSimulation } from './ck-sim.ts';
import { shipScore } from './seafarers-sim.ts';
import { sfckGame } from './sfck-helpers.ts';

interface SeafarersHints {
  legalShips: number[];
  pirateTargets: (number | null)[];
  setupShips: number[];
  movableShips: { edge: number; targets: number[] }[];
  goldRequired: number;
}

interface CombinedHints {
  pirateActive: boolean;
  pirateChase: number[];
  bandit: 'robber' | 'pirate' | 'either' | null;
}

function attempt(state: GameState, actor: string, command: AnyCommand, rng: Rng): GameState | null {
  const outcome = applyCommand(state, actor, command as Command, rng);
  return outcome.ok ? outcome.state : null;
}

function sfHints(state: GameState, playerId: string): SeafarersHints {
  return actionHints(state, playerId).modules!.seafarers as SeafarersHints;
}

function combinedHints(state: GameState, playerId: string): CombinedHints {
  return actionHints(state, playerId).modules!.seafarersCitiesKnights as CombinedHints;
}

function poorestFirst(state: GameState, playerId: string): Resource[] {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  return RESOURCES.slice().sort((a, b) => player.resources[a] - player.resources[b]);
}

function bestShips(state: GameState, playerId: string, edges: readonly number[]): number[] {
  return edges.slice().sort((a, b) => shipScore(state, playerId, a) - shipScore(state, playerId, b));
}

/** Sea hexes next to an active knight that can still act, so its owner may chase the pirate (COMB-6). */
function pirateBait(state: GameState, targets: readonly (number | null)[]): number[] {
  const topo = topologyOf(state);
  const near = new Set(ckView(state).knights.filter((knight) => knight.active).flatMap((knight) => topo.vertices[knight.vertex]!.hexes));
  return targets.filter((hex): hex is number => hex !== null && hex !== state.board.pirate && near.has(hex));
}

export function pending(state: GameState, rng: Rng, step: number): GameState | null | undefined {
  const frame = state.pending;
  if (!frame) return undefined;
  // A chased pirate goes to any other sea hex, or the frame.
  if (frame.kind === 'moveRobber' && frame.pirate) {
    const targets = sfHints(state, frame.actor).pirateTargets.filter((hex) => hex !== state.board.pirate);
    for (const hex of [targets[step % Math.max(1, targets.length)], null]) {
      if (hex === undefined) continue;
      const next = attempt(state, frame.actor, { type: 'pending.moveRobber', hex }, rng);
      if (next) return next;
    }
    return null;
  }
  // Half the 7s after the first attack send the pirate next to a knight.
  if (frame.kind === 'moveRobber' && step % 2 === 0 && combinedHints(state, frame.actor).bandit === 'either') {
    const bait = pirateBait(state, sfHints(state, frame.actor).pirateTargets);
    if (bait[0] !== undefined) return attempt(state, frame.actor, { type: 'pending.moveRobber', hex: bait[step % bait.length]! }, rng) ?? undefined;
  }
  if (frame.kind === 'freeRoads') {
    const roads = actionHints(state, frame.actor).legalRoads;
    const ships = bestShips(state, frame.actor, sfHints(state, frame.actor).legalShips);
    const options: AnyCommand[] = [];
    if (roads[0] !== undefined) options.push({ type: 'build.road', edge: roads[0] });
    if (ships[0] !== undefined) options.splice(step % 2, 0, { type: 'build.ship', edge: ships[0] });
    for (const option of options) {
      const next = attempt(state, frame.actor, option, rng);
      if (next) return next;
    }
    return null;
  }
  if (frame.kind === 'seafarers.gold') {
    const id = (frame as ModulePending).responders[0]!;
    const needed = sfHints(state, id).goldRequired;
    const picks: Resource[] = [];
    const bank = { ...state.bank };
    for (const resource of poorestFirst(state, id)) {
      while (picks.length < needed && bank[resource] > 0) {
        picks.push(resource);
        bank[resource] -= 1;
      }
    }
    return attempt(state, id, { type: 'gold.choose', resources: picks }, rng);
  }
  return undefined;
}

function setup(state: GameState, rng: Rng, step: number): GameState | null | undefined {
  const turn = state.turn.setup!;
  if (turn.stage !== 'road' || step % 2 !== 0) return undefined;
  const actor = state.players[turn.order[turn.index]!]!.id;
  const ships = sfHints(state, actor).setupShips;
  return ships.length > 0 ? attempt(state, actor, { type: 'setup.placeShip', edge: ships[0]! }, rng) : undefined;
}

function tries(state: GameState, actorId: string, step: number): AnyCommand[] {
  const out: AnyCommand[] = [];
  const chase = combinedHints(state, actorId).pirateChase;
  if (chase[0] !== undefined) out.push({ type: 'knight.chasePirate', vertex: chase[0] });
  // Head for the small islands even while the main island has room.
  if (actionHints(state, actorId).legalSettlements.length > 0 && step % 3 !== 0) return out;
  const sea = sfHints(state, actorId);
  const ship = bestShips(state, actorId, sea.legalShips)[0];
  if (ship !== undefined) out.push({ type: 'build.ship', edge: ship });
  const movable = sea.movableShips[0];
  if (movable && step % 5 === 0) out.push({ type: 'ship.move', from: movable.edge, to: bestShips(state, actorId, movable.targets)[0]! });
  return out;
}

export interface SfckCounters {
  shipsBuilt: number;
  shipsMoved: number;
  goldChoices: number;
  islandBonuses: number;
  pirateMoves: number;
  pirateChased: number;
}

export function simulateSeafarersCitiesKnights(players: 3 | 4 | 5 | 6, seed: number, maxSteps = 60000): CkSimulation & { sea: SfckCounters } {
  const result = simulateCitiesKnights(players, seed, maxSteps, {
    game: (count, gameSeed) => sfckGame(count, gameSeed).state,
    pending,
    setup,
    tries,
  });
  const sea: SfckCounters = { shipsBuilt: 0, shipsMoved: 0, goldChoices: 0, islandBonuses: 0, pirateMoves: 0, pirateChased: 0 };
  for (const event of result.state.log) {
    if (event.type === 'ship.built' || event.type === 'setup.ship') sea.shipsBuilt++;
    if (event.type === 'ship.moved') sea.shipsMoved++;
    if (event.type === 'gold.chosen') sea.goldChoices++;
    if (event.type === 'island.bonus') sea.islandBonuses++;
    if (event.type === 'pirate.moved') sea.pirateMoves++;
    if (event.type === 'sfck.knightChasedPirate') sea.pirateChased++;
  }
  return { ...result, sea };
}
