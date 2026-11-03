/**
 * A simple scripted player for whole Cities & Knights games (conservation
 * checks). Progress cards are drawn and discarded but never played (P3).
 */

import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import { COMMODITIES, RESOURCES, type CardKind, type Commodity, type GameState, type ModulePending, type Resource } from '../src/types.ts';
import type { ImprovementOption } from '../src/modules/citiesKnights/cities.ts';
import { TRACK_COMMODITY, type Track } from '../src/modules/citiesKnights/constants.ts';
import { ckView } from '../src/modules/citiesKnights/state.ts';
import { ckGame } from './ck-helpers.ts';

interface KnightHint {
  vertex: number;
  level: number;
  active: boolean;
  canActivate: boolean;
  canPromote: boolean;
  canAct: boolean;
  moves: number[];
  displace: number[];
  chase: boolean;
}

interface CkHints {
  recruitSites: number[];
  knights: KnightHint[];
  wallSites: number[];
  improvements: ImprovementOption[];
  progressExcess: number;
  retreat: number[];
  pillage: number[];
  defenderDecks: Track[];
  scienceBonus: boolean;
}

type AnyCommand = Command | { type: string; [field: string]: unknown };

function attempt(state: GameState, actor: string, command: AnyCommand, rng: Rng): GameState | null {
  const outcome = applyCommand(state, actor, command as Command, rng);
  return outcome.ok ? outcome.state : null;
}

function ckHints(state: GameState, playerId: string): CkHints {
  return actionHints(state, playerId).modules!.citiesKnights as CkHints;
}

function playerOf(state: GameState, playerId: string) {
  return state.players.find((candidate) => candidate.id === playerId)!;
}

function resourcesBy(state: GameState, playerId: string, richestFirst: boolean): Resource[] {
  const player = playerOf(state, playerId);
  return RESOURCES.slice().sort((a, b) => (richestFirst ? player.resources[b] - player.resources[a] : player.resources[a] - player.resources[b]));
}

function cardPool(state: GameState, playerId: string): CardKind[] {
  const player = playerOf(state, playerId);
  const pool: CardKind[] = [];
  for (const resource of resourcesBy(state, playerId, true)) for (let i = 0; i < player.resources[resource]; i++) pool.push(resource);
  for (const commodity of COMMODITIES) for (let i = 0; i < player.commodities[commodity]; i++) pool.push(commodity);
  return pool;
}

export interface CkCounters {
  events: number;
  attacks: number;
  pillaged: number;
  defenders: number;
  defenderTies: number;
  knightsRecruited: number;
  knightsActivated: number;
  knightsPromoted: number;
  knightsMoved: number;
  knightsDisplaced: number;
  robberChased: number;
  walls: number;
  improvements: number;
  metropolises: number;
  progressDrawn: number;
  progressVp: number;
  progressDiscards: number;
  commodities: number;
  scienceBonus: number;
}

const COUNTED: Record<string, keyof CkCounters> = {
  'ck.eventRolled': 'events',
  'ck.barbariansAttack': 'attacks',
  'ck.cityPillaged': 'pillaged',
  'ck.defenderOfCatan': 'defenders',
  'ck.defendersTied': 'defenderTies',
  'ck.knightRecruited': 'knightsRecruited',
  'ck.knightActivated': 'knightsActivated',
  'ck.knightPromoted': 'knightsPromoted',
  'ck.knightMoved': 'knightsMoved',
  'ck.knightDisplaced': 'knightsDisplaced',
  'ck.knightChasedRobber': 'robberChased',
  'ck.wallBuilt': 'walls',
  'ck.cityImproved': 'improvements',
  'ck.metropolisAwarded': 'metropolises',
  'ck.progressDrawn': 'progressDrawn',
  'ck.progressVictoryPoint': 'progressVp',
  'ck.progressDiscarded': 'progressDiscards',
  'ck.commoditiesProduced': 'commodities',
  'ck.scienceBonusTaken': 'scienceBonus',
};

function resolvePending(state: GameState, rng: Rng, step: number): GameState | null {
  const pending = state.pending;
  if (!pending) return null;
  switch (pending.kind) {
    case 'discard': {
      const id = Object.keys(pending.required).find((candidate) => !pending.submitted[candidate])!;
      return attempt(state, id, { type: 'pending.discard', resources: cardPool(state, id).slice(0, pending.required[id]) }, rng);
    }
    case 'moveRobber': {
      const hexes = state.board.layout.terrain.length;
      for (let k = 0; k < hexes; k++) {
        const next = attempt(state, pending.actor, { type: 'pending.moveRobber', hex: (state.seq + k * 7) % hexes }, rng);
        if (next) return next;
      }
      return null;
    }
    case 'steal':
      return attempt(state, pending.actor, { type: 'pending.steal', victim: pending.candidates[0]! }, rng);
    default: {
      const frame = pending as ModulePending;
      const id = frame.responders[0]!;
      const hints = ckHints(state, id);
      switch (frame.kind) {
        case 'citiesKnights.pillage':
          return attempt(state, id, { type: 'barbarians.pillage', vertex: hints.pillage[step % hints.pillage.length]! }, rng);
        case 'citiesKnights.displaced':
          return attempt(state, id, { type: 'knight.retreat', vertex: hints.retreat[0] ?? null }, rng);
        case 'citiesKnights.defenderDraw':
          return attempt(state, id, { type: 'barbarians.chooseDeck', track: hints.defenderDecks[step % hints.defenderDecks.length]! }, rng);
        case 'citiesKnights.progressDiscard': {
          const required = (frame.data.required as Record<string, number>)[id]!;
          return attempt(state, id, { type: 'progress.discard', cards: playerOf(state, id).progressCards.slice(0, required) }, rng);
        }
        case 'citiesKnights.scienceBonus': {
          const want = resourcesBy(state, id, false).find((resource) => state.bank[resource] > 0) ?? null;
          return attempt(state, id, { type: 'science.take', resource: want }, rng);
        }
        default:
          return null;
      }
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
  return attempt(state, actor, { type: 'setup.placeRoad', edge: hints.legalRoads[(step * 3) % hints.legalRoads.length]! }, rng)!;
}

/** The commodity the player most wants next: the cheapest improvement still open. */
function wantedCommodity(options: ImprovementOption[]): Commodity | null {
  const open = options.filter((option) => option.blocked === null || option.blocked === 'cost').sort((a, b) => a.cost - b.cost);
  return open[0] ? (TRACK_COMMODITY[open[0].track] as Commodity) : null;
}

function actionTries(state: GameState, actorId: string, step: number): AnyCommand[] {
  const hints = actionHints(state, actorId);
  const ck = ckHints(state, actorId);
  const player = playerOf(state, actorId);
  const view = ckView(state);
  const tries: AnyCommand[] = [];
  if (ck.progressExcess > 0) {
    tries.push({ type: 'progress.discard', cards: player.progressCards.slice(0, ck.progressExcess) });
    return tries;
  }
  for (const option of ck.improvements) {
    if (option.blocked === null) tries.push({ type: 'city.improve', track: option.track, ...(option.metropolis ? { vertex: option.sites[0] } : {}) });
  }
  for (const vertex of hints.legalCities) tries.push({ type: 'build.city', vertex });
  for (const vertex of hints.legalSettlements) tries.push({ type: 'build.settlement', vertex });
  // Stand the knights up as the barbarians close in.
  const threat = view.barbarian >= 4;
  for (const knight of ck.knights) {
    if (knight.canActivate && (threat || step % 6 === 0)) tries.push({ type: 'knight.activate', vertex: knight.vertex });
  }
  for (const knight of ck.knights) {
    if (!knight.canAct) continue;
    if (knight.chase && step % 3 === 0) tries.push({ type: 'knight.chaseRobber', vertex: knight.vertex });
    if (knight.displace[0] !== undefined && !threat) tries.push({ type: 'knight.displace', from: knight.vertex, to: knight.displace[0] });
    if (knight.moves[0] !== undefined && !threat && step % 3 === 0) tries.push({ type: 'knight.move', from: knight.vertex, to: knight.moves[step % knight.moves.length]! });
  }
  const cities = hints.legalCities.length + state.board.buildings.filter((building) => building?.city && building.player === actorId).length;
  if (ck.knights.length < Math.max(2, cities + 1) && ck.recruitSites.length > 0) {
    tries.push({ type: 'knight.recruit', vertex: ck.recruitSites[step % ck.recruitSites.length]! });
  }
  for (const knight of ck.knights) if (knight.canPromote && step % 4 === 0) tries.push({ type: 'knight.promote', vertex: knight.vertex });
  if (ck.wallSites[0] !== undefined && step % 5 === 0) tries.push({ type: 'build.wall', vertex: ck.wallSites[0] });
  if (hints.legalSettlements.length === 0 && hints.legalRoads.length > 0 && step % 2 === 0) {
    tries.push({ type: 'build.road', edge: hints.legalRoads[(step >> 1) % hints.legalRoads.length]! });
  }
  // Bank trades: a surplus card kind for the commodity or resource most needed.
  const want = wantedCommodity(ck.improvements);
  const surplus = resourcesBy(state, actorId, true)[0]!;
  const short = resourcesBy(state, actorId, false)[0]!;
  for (const commodity of COMMODITIES) {
    if (commodity !== want && player.commodities[commodity] >= 4) tries.push({ type: 'trade.bank', give: commodity, receive: want ?? short });
  }
  if (player.resources[surplus] >= hints.bankRates[surplus]) {
    if (want && step % 2 === 0) tries.push({ type: 'trade.bank', give: surplus, receive: want });
    tries.push({ type: 'trade.bank', give: surplus, receive: short });
  }
  return tries;
}

export interface CkSimulation {
  state: GameState;
  counters: CkCounters;
}

export function simulateCitiesKnights(players: 3 | 4 | 5 | 6, seed: number, maxSteps = 40000): CkSimulation {
  const rng = seededRng(seed * 7919 + players);
  let { state } = ckGame(players, seed);
  const counters = Object.fromEntries(Object.values(COUNTED).map((key) => [key, 0])) as unknown as CkCounters;
  const count = (before: GameState, after: GameState) => {
    for (const event of after.log) {
      if (event.seq <= before.seq) continue;
      const key = COUNTED[event.type];
      if (key) counters[key]++;
    }
  };
  for (let step = 0; step < maxSteps && !state.result; step++) {
    const before = state;
    if (state.turn.phase === 'setup') {
      state = setupStep(state, rng, step);
      count(before, state);
      continue;
    }
    if (state.pending) {
      const next = resolvePending(state, rng, step);
      if (!next) throw new Error(`stuck on pending ${JSON.stringify(state.pending)}`);
      state = next;
      count(before, state);
      continue;
    }
    const actor = state.players[state.turn.seat]!;
    const hints = actionHints(state, actor.id);
    if (hints.canRoll) {
      state = attempt(state, actor.id, { type: 'turn.roll' }, rng)!;
      count(before, state);
      continue;
    }
    let advanced = false;
    for (const command of actionTries(state, actor.id, step)) {
      const next = attempt(state, actor.id, command, rng);
      if (next) {
        state = next;
        advanced = true;
        break;
      }
    }
    if (!advanced) {
      const ended = attempt(state, actor.id, { type: 'turn.end' }, rng);
      if (!ended) throw new Error(`cannot end turn: ${JSON.stringify(applyCommand(state, actor.id, { type: 'turn.end' }, rng))}`);
      state = ended;
    }
    count(before, state);
  }
  return { state, counters };
}
