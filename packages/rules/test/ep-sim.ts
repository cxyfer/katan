/**
 * A simple scripted player for whole Explorers & Pirates games: it builds
 * harbours, ships, settlers and crews, sails toward the nearest goal (land to
 * settle, a lair or spice farm for a crew, the Council for goods, otherwise
 * the fog), and answers the pirate and discard frames.
 */

import { neighborsOfVertex, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import type { EpScenarioId } from '../src/explorers-pirates-boards.ts';
import type { ExplorersPiratesHints, ExplorersPiratesView } from '../src/modules/explorersPirates/index.ts';
import { TRACK_VALUES, trackSpace } from '../src/modules/explorersPirates/core.ts';
import { closedSite, councilAnchors, isExploredLand, isSeaRoute, vertexTouchesFog } from '../src/modules/explorersPirates/geometry.ts';
import { epState, type EpShip } from '../src/modules/explorersPirates/state.ts';
import { projectGame } from '../src/project.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import { RESOURCES, type GameState, type ModulePending, type Resource } from '../src/types.ts';
import { epGame } from './ep-helpers.ts';

type AnyCommand = Command | { type: string; [field: string]: unknown };

export interface EpSimulation {
  state: GameState;
  events: Record<string, number>;
  steps: number;
}

/** The last command the engine accepted, so a driver can replay the bot's choice elsewhere. */
let lastAccepted: { actor: string; command: AnyCommand } | null = null;

function attempt(state: GameState, actor: string, command: AnyCommand, rng: Rng): GameState | null {
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (outcome.ok) lastAccepted = { actor, command };
  return outcome.ok ? outcome.state : null;
}

export function epHints(state: GameState, playerId: string): ExplorersPiratesHints {
  return actionHints(state, playerId).modules!.explorersPirates as ExplorersPiratesHints;
}

export function epView(state: GameState, viewerId: string): ExplorersPiratesView {
  return projectGame(state, viewerId).modules!.explorersPirates as ExplorersPiratesView;
}

function player(state: GameState, id: string) {
  return state.players.find((candidate) => candidate.id === id)!;
}

/** Free intersections next to explored land a settler could found on. */
function settleSpots(state: GameState, playerId: string): Set<number> {
  const slot = epState(state);
  const topo = topologyOf(state);
  const out = new Set<number>();
  topo.vertices.forEach((vertex, index) => {
    if (state.board.buildings[index]) return;
    if (!vertex.hexes.some((hex) => isExploredLand(state, slot, hex))) return;
    if (vertexTouchesFog(state, index)) return;
    if (vertex.hexes.some((hex) => closedSite(state, hex, playerId))) return;
    if (neighborsOfVertex(topo, index).some((neighbor) => state.board.buildings[neighbor])) return;
    out.add(index);
  });
  return out;
}

/** Goal edge sets for a ship, most wanted first; each is a set of sea-route edges. */
function goalSets(state: GameState, ship: EpShip): Set<number>[] {
  const slot = epState(state);
  const topo = topologyOf(state);
  const byVertex = (vertices: Iterable<number>) => {
    const wanted = new Set(vertices);
    const edges = new Set<number>();
    topo.edges.forEach((edge, index) => {
      if (edge.vertices.some((vertex) => wanted.has(vertex))) edges.add(index);
    });
    return edges;
  };
  const byHex = (hexes: Iterable<number>) => {
    const wanted = new Set(hexes);
    const edges = new Set<number>();
    topo.edges.forEach((edge, index) => {
      if (edge.hexes.some((hex) => wanted.has(hex))) edges.add(index);
    });
    return edges;
  };
  const own = slot.harbors.filter((harbor) => harbor.player === ship.player);
  const out: Set<number>[] = [];
  if (ship.cargo.includes('settler')) out.push(byVertex(settleSpots(state, ship.player)));
  if (ship.cargo.includes('crew')) {
    out.push(byHex(slot.sites.filter((site) => (site.kind === 'lair' && !site.captured && site.crews.length < 3 && !trackFull(state, ship.player, 'lairs'))
      || (site.kind === 'spice' && !site.crews.includes(ship.player))).map((site) => site.hex)));
  }
  if (ship.cargo.includes('fish') || ship.cargo.includes('spice')) out.push(byVertex(councilAnchors(state, slot)));
  if (ship.cargo.length === 0) {
    out.push(byHex(slot.sites.filter((site) => (site.kind === 'shoal' && site.fish && !trackFull(state, ship.player, 'fish'))
      || (site.kind === 'spice' && site.crews.includes(ship.player) && site.sacks.includes(ship.player))).map((site) => site.hex)));
    out.push(byVertex(own.filter((harbor) => harbor.cargo.length > 0).map((harbor) => harbor.vertex)));
    if (crewWork(state, ship.player)) out.push(byVertex(own.map((harbor) => harbor.vertex)));
  }
  // Explore: edges with an end at an unexplored hex.
  const fog = new Set(slot.fog.map((entry) => entry.hex));
  out.push(byVertex(topo.vertices.flatMap((vertex, index) => (vertex.hexes.some((hex) => fog.has(hex)) ? [index] : []))));
  out.push(byVertex(own.map((harbor) => harbor.vertex)));
  return out.filter((set) => set.size > 0);
}

/** Breadth-first distance over sea routes from every goal edge. */
function distances(state: GameState, goals: Set<number>): Map<number, number> {
  const topo = topologyOf(state);
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const edge of goals) {
    dist.set(edge, 0);
    queue.push(edge);
  }
  while (queue.length > 0) {
    const edge = queue.shift()!;
    const d = dist.get(edge)!;
    for (const vertex of topo.edges[edge]!.vertices) {
      for (const next of topo.vertices[vertex]!.edges) {
        if (dist.has(next) || !isSeaRoute(state, next)) continue;
        dist.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

function trackFull(state: GameState, id: string, mission: 'fish' | 'spices' | 'lairs'): boolean {
  const slot = epState(state);
  return !slot.tracks[mission] || trackSpace(slot, mission, id) >= TRACK_VALUES[mission].length;
}

/** Sites a crew could still go to. */
function crewWork(state: GameState, id: string): boolean {
  return epState(state).sites.some((site) => (site.kind === 'lair' && !site.captured && site.crews.length < 3 && !trackFull(state, id, 'lairs'))
    || (site.kind === 'spice' && !site.crews.includes(id)));
}

const SETTLER_COST: Resource[] = ['brick', 'lumber', 'wool', 'grain'];

function missing(state: GameState, id: string, cost: Partial<Record<Resource, number>>): Resource | null {
  const hand = player(state, id).resources;
  for (const resource of RESOURCES) if ((cost[resource] ?? 0) > hand[resource]) return resource;
  return null;
}

function resolvePending(state: GameState, rng: Rng): GameState | null {
  const pending = state.pending!;
  if (pending.kind === 'discard') {
    const id = Object.keys(pending.required).find((candidate) => !pending.submitted[candidate])!;
    const hand = player(state, id).resources;
    const pool: Resource[] = [];
    for (const resource of RESOURCES.slice().sort((a, b) => hand[b] - hand[a])) for (let i = 0; i < hand[resource]; i++) pool.push(resource);
    return attempt(state, id, { type: 'pending.discard', resources: pool.slice(0, pending.required[id]) }, rng);
  }
  const frame = pending as ModulePending;
  if (frame.kind !== 'explorersPirates.pirate') return null;
  const id = frame.responders[0]!;
  const hints = epHints(state, id);
  if (hints.robCandidates.length > 0) return attempt(state, id, { type: 'ep.robPlayer', victim: hints.robCandidates[0]! }, rng);
  // Prefer a hex where an opponent's ship is.
  const slot = epState(state);
  const topo = topologyOf(state);
  const crowded = hints.pirateTargets.find((hex) => slot.ships.some((ship) => ship.player !== id && topo.edges[ship.edge]!.hexes.includes(hex)));
  return attempt(state, id, { type: 'ep.placePirate', hex: crowded ?? hints.pirateTargets[rng.int(hints.pirateTargets.length)]! }, rng);
}

function setupMove(state: GameState, rng: Rng, step: number): GameState | null {
  const setup = state.turn.setup!;
  const actor = state.players[setup.order[setup.index]!]!.id;
  const hints = epHints(state, actor).setup!;
  const pick = (list: number[]) => list[(step * 7) % list.length]!;
  if (hints.step === 'harbor') return attempt(state, actor, { type: 'ep.setupHarbor', vertex: pick(hints.harbor) }, rng);
  if (hints.step === 'settlement') return attempt(state, actor, { type: 'ep.setupSettlement', vertex: pick(hints.settlement) }, rng);
  if (hints.ship.length > 0) return attempt(state, actor, { type: 'ep.setupShip', edge: hints.ship[0]! }, rng);
  return attempt(state, actor, { type: 'ep.setupRoad', edge: hints.road[0]! }, rng);
}

/** One command of the action phase, or null when the bot is done building. */
function actionMove(state: GameState, id: string, rng: Rng, turnNo: number): GameState | null {
  const hints = epHints(state, id);
  const base = actionHints(state, id);
  const slot = epState(state);
  const hand = player(state, id).resources;
  const tries: AnyCommand[] = [];
  for (const vertex of hints.harbors) tries.push({ type: 'ep.buildHarbor', vertex });
  for (const vertex of base.legalSettlements) tries.push({ type: 'build.settlement', vertex });
  const ships = slot.ships.filter((ship) => ship.player === id);
  const emptyShip = ships.find((ship) => ship.cargo.length === 0 && hints.pieceShips.includes(ship.id));
  const roomShip = ships.find((ship) => ship.cargo.length < 2 && !ship.cargo.includes('settler') && !ship.cargo.includes('fish') && hints.pieceShips.includes(ship.id));
  const anyCrewShip = ships.some((ship) => ship.cargo.includes('crew'));
  if (hints.settlersLeft > 0 && !ships.some((ship) => ship.cargo.includes('settler'))) {
    if (emptyShip) tries.push({ type: 'ep.buildSettler', ship: emptyShip.id });
    else if (hints.pieceHarbors.length > 0) tries.push({ type: 'ep.buildSettler', harbor: hints.pieceHarbors[0]! });
  }
  if (hints.crewsLeft > 0 && !anyCrewShip && roomShip && crewWork(state, id)) tries.push({ type: 'ep.buildCrew', ship: roomShip.id });
  if (hints.shipEdges.length > 0 && ships.length < 3) tries.push({ type: 'ep.buildShip', edge: hints.shipEdges[rng.int(hints.shipEdges.length)]! });
  if (turnNo % 3 === 0 && base.legalRoads.length > 0 && hand.lumber > 1 && hand.brick > 1) {
    tries.push({ type: 'build.road', edge: base.legalRoads[rng.int(base.legalRoads.length)]! });
  }
  if (hints.fastGoldLeft > 0) {
    const give = RESOURCES.slice().sort((a, b) => hand[b] - hand[a])[0]!;
    if (hand[give] > 2) tries.push({ type: 'ep.fastGold', give });
  }
  if (ships.length > 0 && turnNo % 5 === 0 && hand.wool > 1) tries.push({ type: 'ep.extraMove', ship: ships[0]!.id });
  // Gold and supply trades toward a settler or a harbour.
  const want = missing(state, id, { brick: 1, lumber: 1, wool: 1, grain: 1 }) ?? missing(state, id, { grain: 2, ore: 2 });
  if (want) {
    if (hints.goldBuysLeft > 0) tries.push({ type: 'ep.buyResource', receive: want });
    const spare = RESOURCES.filter((resource) => resource !== want && hand[resource] >= 4)
      .sort((a, b) => hand[b] - hand[a])[0];
    if (spare) tries.push({ type: 'trade.bank', give: spare, receive: want });
  }
  const glut = RESOURCES.find((resource) => hand[resource] >= 5 && !SETTLER_COST.includes(resource));
  if (glut) tries.push({ type: 'ep.sellForGold', give: glut });
  for (const command of tries) {
    const next = attempt(state, id, command, rng);
    if (next) return next;
  }
  return null;
}

/** One command of the movement phase, or null when every ship is done. */
function movementMove(state: GameState, id: string, rng: Rng): GameState | null {
  const hints = epHints(state, id);
  if (hints.fishRoll) {
    const next = attempt(state, id, { type: 'ep.fishRoll' }, rng);
    if (next) return next;
  }
  const slot = epState(state);
  if (hints.stranded) {
    const active = hints.ships.find((ship) => ship.id === epState(state).turn.active)!;
    for (const step of active.steps) {
      const next = attempt(state, id, { type: 'ep.moveShip', ship: active.id, edge: step.edge }, rng);
      if (next) return next;
    }
  }
  for (const shipHint of hints.ships) {
    const ship = slot.ships.find((candidate) => candidate.id === shipHint.id)!;
    const tries: AnyCommand[] = [];
    for (const vertex of shipHint.found) tries.push({ type: 'ep.found', ship: ship.id, vertex });
    for (const hex of shipHint.dropCrew) tries.push({ type: 'ep.dropCrew', ship: ship.id, hex });
    if (shipHint.deliver) tries.push({ type: 'ep.deliver', ship: ship.id });
    if (!trackFull(state, id, 'fish')) for (const hex of shipHint.loadFish) tries.push({ type: 'ep.loadFish', ship: ship.id, hex });
    for (const hex of shipHint.loadSpice) tries.push({ type: 'ep.loadSpice', ship: ship.id, hex });
    for (const hex of shipHint.pickCrew) tries.push({ type: 'ep.pickCrew', ship: ship.id, hex });
    if (shipHint.chase) tries.push({ type: 'ep.chase', ship: ship.id });
    for (const vertex of shipHint.harbors) {
      const harbor = slot.harbors.find((candidate) => candidate.vertex === vertex)!;
      for (const piece of harbor.cargo) tries.push({ type: 'ep.load', ship: ship.id, harbor: vertex, piece });
    }
    for (const command of tries) {
      const next = attempt(state, id, command, rng);
      if (next) return next;
    }
    if (shipHint.done || shipHint.steps.length === 0) continue;
    // The first goal the ship can still reach.
    let dist = new Map<number, number>();
    let here = Infinity;
    for (const goals of goalSets(state, ship)) {
      dist = distances(state, goals);
      here = dist.get(ship.edge) ?? Infinity;
      if (here < Infinity) break;
    }
    if (here === 0) continue;
    const ranked = shipHint.steps
      .map((step) => ({ step, d: dist.get(step.edge) ?? Infinity }))
      .filter((entry) => entry.d < here || (here === Infinity && entry.step.explores))
      .sort((a, b) => a.d - b.d);
    for (const { step } of ranked) {
      const next = attempt(state, id, { type: 'ep.moveShip', ship: ship.id, edge: step.edge }, rng);
      if (next) return next;
    }
  }
  return null;
}

/**
 * One bot decision: the next accepted command for whoever owes one, with the
 * state after it (applied with `rng`). `memo.turnNo` counts finished turns.
 * The browser harness replays `actor`/`command` against the real service.
 */
export function epBotStep(state: GameState, rng: Rng, step: number, memo: { turnNo: number }):
  { state: GameState; actor: string; command: AnyCommand } | null {
  lastAccepted = null;
  let next: GameState | null = null;
  if (state.pending) next = resolvePending(state, rng);
  else if (state.turn.phase === 'setup') next = setupMove(state, rng, step);
  else {
    const id = state.players[state.turn.seat]!.id;
    if (state.turn.phase === 'preroll') next = attempt(state, id, { type: 'turn.roll' }, rng);
    else {
      const phase = epHints(state, id).phase;
      if (phase === 'action') next = actionMove(state, id, rng, memo.turnNo) ?? attempt(state, id, { type: 'ep.startMovement' }, rng);
      else next = movementMove(state, id, rng);
      if (!next) {
        next = attempt(state, id, { type: 'turn.end' }, rng);
        memo.turnNo++;
      }
    }
  }
  const accepted = lastAccepted as { actor: string; command: AnyCommand } | null;
  return next && accepted ? { state: next, ...accepted } : null;
}

export function simulateExplorersPirates(scenario: EpScenarioId, players: 3 | 4, seed: number, maxSteps = 40000): EpSimulation {
  const rng = seededRng(seed * 7919 + players);
  let { state } = epGame(scenario, players, seed);
  const events: Record<string, number> = {};
  const memo = { turnNo: 0 };
  let steps = 0;
  for (; steps < maxSteps && !state.result; steps++) {
    const before = state.seq;
    const next = epBotStep(state, rng, steps, memo)?.state ?? null;
    if (!next) {
      const id = state.players[state.turn.seat]!.id;
      const outcome = applyCommand(state, id, { type: 'turn.end' } as Command, rng);
      throw new Error(`simulation stuck at step ${steps}: ${state.turn.phase} ${JSON.stringify(state.pending)} ${JSON.stringify(outcome.ok ? null : outcome.error)} ${JSON.stringify(epHints(state, id))}`);
    }
    for (const event of next.log) if (event.seq > before) events[event.type] = (events[event.type] ?? 0) + 1;
    state = next;
  }
  return { state, events, steps };
}


/** A game of the scenario past its setup, the turn forced onto seat 0's action phase. */
export function epPlayable(scenario: EpScenarioId, players: 3 | 4 = 4, seed = 12345): GameState {
  const rng = seededRng(seed);
  let { state } = epGame(scenario, players, seed);
  for (let step = 0; state.turn.phase === 'setup'; step++) state = setupMove(state, rng, step)!;
  state.turn.seat = 0;
  state.turn.phase = 'action';
  state.turn.setup = null;
  state.pending = null;
  state.windowId += 1;
  return state;
}
