/** A simple scripted player for whole New Shores games (conservation checks). */

import { isLandHex, topologyOf, totalResources } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import { RESOURCES, type GameState, type ModulePending, type Resource } from '../src/types.ts';
import { seafarersGame } from './seafarers-helpers.ts';

interface SeafarersHints {
  legalShips: number[];
  setupShips: number[];
  movableShips: { edge: number; targets: number[] }[];
  pirateTargets: (number | null)[];
  robberTargets: number[];
  goldRequired: number;
}

type AnyCommand = Command | { type: string; [field: string]: unknown };

function attempt(state: GameState, actor: string, command: AnyCommand, rng: Rng): GameState | null {
  const outcome = applyCommand(state, actor, command as Command, rng);
  return outcome.ok ? outcome.state : null;
}

function sfHints(state: GameState, playerId: string): SeafarersHints {
  return actionHints(state, playerId).modules!.seafarers as SeafarersHints;
}

function sorted(state: GameState, playerId: string, richestFirst: boolean): Resource[] {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  return RESOURCES.slice().sort((a, b) => (richestFirst ? player.resources[b] - player.resources[a] : player.resources[a] - player.resources[b]));
}

/** Squared distance from an edge to the nearest land hex the player has not settled. */
function shipScore(state: GameState, playerId: string, edge: number): number {
  const topo = topologyOf(state);
  const info = topo.edges[edge]!;
  for (const vertex of info.vertices) {
    if (state.board.buildings[vertex]) continue;
    const land = topo.vertices[vertex]!.hexes.some((hex) => isLandHex(state, hex));
    const crowded = topo.vertices[vertex]!.edges.some((other) => {
      const [a, b] = topo.edges[other]!.vertices;
      return !!state.board.buildings[a === vertex ? b : a];
    });
    if (land && !crowded) return -1;
  }
  let best = Infinity;
  topo.hexes.forEach((hex, index) => {
    if ((state.board.layout.islands[index] ?? 0) <= 1) return;
    const owned = topo.vertices.some((vertex, v) => vertex.hexes.includes(index) && state.board.buildings[v]?.player === playerId);
    if (owned) return;
    best = Math.min(best, (hex.x - info.x) ** 2 + (hex.y - info.y) ** 2);
  });
  return best;
}

function resolvePending(state: GameState, rng: Rng, step: number): GameState | null {
  const pending = state.pending;
  if (!pending) return null;
  switch (pending.kind) {
    case 'discard': {
      const id = Object.keys(pending.required).find((candidate) => !pending.submitted[candidate])!;
      const order = sorted(state, id, true);
      const player = state.players.find((candidate) => candidate.id === id)!;
      const pool: Resource[] = [];
      for (const resource of order) for (let i = 0; i < player.resources[resource]; i++) pool.push(resource);
      return attempt(state, id, { type: 'pending.discard', resources: pool.slice(0, pending.required[id]) }, rng);
    }
    case 'moveRobber': {
      const hints = sfHints(state, pending.actor);
      const targets: (number | null)[] = step % 3 === 0 ? [...hints.pirateTargets, ...hints.robberTargets] : [...hints.robberTargets, ...hints.pirateTargets];
      for (const target of targets) {
        const next = attempt(state, pending.actor, { type: 'pending.moveRobber', hex: target }, rng);
        if (next) return next;
      }
      return null;
    }
    case 'steal':
      return attempt(state, pending.actor, { type: 'pending.steal', victim: pending.candidates[0]! }, rng);
    case 'yearOfPlenty':
      return attempt(state, pending.actor, { type: 'pending.takeResource', resource: sorted(state, pending.actor, false)[0]! }, rng);
    case 'freeRoads': {
      const road = actionHints(state, pending.actor).legalRoads[0];
      const ships = sfHints(state, pending.actor).legalShips;
      const shipEdge = ships.sort((a, b) => shipScore(state, pending.actor, a) - shipScore(state, pending.actor, b))[0];
      const options: AnyCommand[] = [];
      if (road !== undefined) options.push({ type: 'build.road', edge: road });
      if (shipEdge !== undefined) options.splice(step % 2, 0, { type: 'build.ship', edge: shipEdge });
      for (const option of options) {
        const next = attempt(state, pending.actor, option, rng);
        if (next) return next;
      }
      return null;
    }
    default: {
      const frame = pending as ModulePending;
      if (frame.kind !== 'seafarers.gold') return null;
      const id = frame.responders[0]!;
      const needed = sfHints(state, id).goldRequired;
      const picks: Resource[] = [];
      const bank = { ...state.bank };
      for (const resource of sorted(state, id, false)) {
        while (picks.length < needed && bank[resource] > 0) {
          picks.push(resource);
          bank[resource] -= 1;
        }
      }
      return attempt(state, id, { type: 'gold.choose', resources: picks }, rng);
    }
  }
}

function setupStep(state: GameState, rng: Rng, step: number): GameState {
  const setup = state.turn.setup!;
  const actor = state.players[setup.order[setup.index]!]!.id;
  const hints = actionHints(state, actor);
  if (setup.stage === 'building') {
    const legal = hints.legalSettlements;
    return attempt(state, actor, { type: 'setup.placeBuilding', vertex: legal[(step * 7) % legal.length]! }, rng)!;
  }
  const ships = sfHints(state, actor).setupShips;
  if (ships.length > 0 && step % 2 === 0) return attempt(state, actor, { type: 'setup.placeShip', edge: ships[0]! }, rng)!;
  return attempt(state, actor, { type: 'setup.placeRoad', edge: hints.legalRoads[0]! }, rng)!;
}

export interface SimulationResult {
  state: GameState;
  shipsBuilt: number;
  shipsMoved: number;
  pirateMoves: number;
  goldChoices: number;
  islandBonuses: number;
}

export function simulateSeafarers(players: 3 | 4 | 5 | 6, seed: number, maxSteps = 30000): SimulationResult {
  const rng = seededRng(seed * 7919 + players);
  let { state } = seafarersGame(players, seed);
  const counters = { shipsBuilt: 0, shipsMoved: 0, pirateMoves: 0, goldChoices: 0, islandBonuses: 0 };
  const count = (before: GameState, after: GameState) => {
    for (const event of after.log) {
      if (event.seq <= before.seq) continue;
      if (event.type === 'ship.built' || event.type === 'setup.ship') counters.shipsBuilt++;
      if (event.type === 'ship.moved') counters.shipsMoved++;
      if (event.type === 'pirate.moved') counters.pirateMoves++;
      if (event.type === 'gold.chosen') counters.goldChoices++;
      if (event.type === 'island.bonus') counters.islandBonuses++;
    }
  };
  for (let step = 0; step < maxSteps && !state.result; step++) {
    const before = state;
    if (state.turn.phase === 'setup') {
      state = setupStep(state, rng, step);
      count(before, state);
      continue;
    }
    const pendingNext = resolvePending(state, rng, step);
    if (pendingNext) {
      state = pendingNext;
      count(before, state);
      continue;
    }
    if (state.pending) {
      const p = state.pending as { actor?: string };
      const id = p.actor ?? '';
      const h = actionHints(state, id);
      const road = h.legalRoads[0];
      const out = road === undefined ? null : applyCommand(state, id, { type: 'build.road', edge: road }, rng);
      throw new Error(`stuck on pending ${state.pending.kind} ${JSON.stringify({ roads: h.legalRoads.length, ships: sfHints(state, id).legalShips.length, out: out && !out.ok ? out.error : 'ok', pending: state.pending })}`);
    }
    const actor = state.players[state.turn.seat]!;
    const hints = actionHints(state, actor.id);
    const sea = hints.modules!.seafarers as SeafarersHints;
    if (hints.canRoll) {
      const knight = step % 4 === 0 && actor.devCards.includes('knight') && !state.turn.devCardPlayed;
      const target = step % 8 === 0 ? sea.pirateTargets[0] : sea.robberTargets[0];
      const played = knight && target !== undefined ? attempt(state, actor.id, { type: 'dev.playKnight', hex: target }, rng) : null;
      state = played ?? attempt(state, actor.id, { type: 'turn.roll' }, rng)!;
      count(before, state);
      continue;
    }
    const tries: AnyCommand[] = [];
    for (const vertex of hints.legalCities) tries.push({ type: 'build.city', vertex });
    for (const vertex of hints.legalSettlements) tries.push({ type: 'build.settlement', vertex });
    if (!state.turn.devCardPlayed) {
      for (const card of actor.devCards) {
        if (card === 'monopoly') tries.push({ type: 'dev.playMonopoly', resource: sorted(state, actor.id, false)[0]! });
        if (card === 'yearOfPlenty') tries.push({ type: 'dev.playYearOfPlenty' });
        if (card === 'roadBuilding') tries.push({ type: 'dev.playRoadBuilding' });
      }
    }
    if (hints.legalSettlements.length === 0) {
      const ships = sea.legalShips.slice().sort((a, b) => shipScore(state, actor.id, a) - shipScore(state, actor.id, b));
      if (ships[0] !== undefined) tries.push({ type: 'build.ship', edge: ships[0] });
      if (hints.legalRoads[0] !== undefined && step % 3 === 0) tries.push({ type: 'build.road', edge: hints.legalRoads[(step >> 2) % hints.legalRoads.length]! });
      const movable = sea.movableShips[0];
      if (movable && step % 5 === 0) {
        const target = movable.targets.slice().sort((a, b) => shipScore(state, actor.id, a) - shipScore(state, actor.id, b))[0]!;
        tries.push({ type: 'ship.move', from: movable.edge, to: target });
      }
    }
    tries.push({ type: 'build.devCard' });
    const give = sorted(state, actor.id, true)[0]!;
    if (actor.resources[give] >= hints.bankRates[give]) {
      tries.push({ type: 'trade.bank', give, receive: sorted(state, actor.id, false)[0]! });
    }
    let advanced = false;
    for (const command of tries) {
      const next = attempt(state, actor.id, command, rng);
      if (next) {
        state = next;
        advanced = true;
        break;
      }
    }
    if (!advanced) state = attempt(state, actor.id, { type: 'turn.end' }, rng)!;
    count(before, state);
  }
  return { state, ...counters };
}

export function handTotals(state: GameState): number {
  return state.players.reduce((sum, player) => sum + totalResources(player), 0);
}
