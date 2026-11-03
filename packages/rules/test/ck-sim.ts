/**
 * A simple scripted player for whole Cities & Knights games (conservation
 * checks). It plays every progress card it can, answers every card frame and
 * uses Alchemy before some rolls.
 */

import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import { COMMODITIES, RESOURCES, type CardKind, type Commodity, type GameState, type ModulePending, type Resource } from '../src/types.ts';
import type { ImprovementOption } from '../src/modules/citiesKnights/cities.ts';
import { TRACK_COMMODITY, type Track } from '../src/modules/citiesKnights/constants.ts';
import { ckView } from '../src/modules/citiesKnights/state.ts';
import type { ProgressCardHint } from '../src/modules/citiesKnights/cards.ts';
import { projectGame } from '../src/project.ts';
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
  progress: ProgressCardHint[];
  harborTargets: string[];
}

export type AnyCommand = Command | { type: string; [field: string]: unknown };

/**
 * Extension points for combined profiles (Seafarers + C&K): another game
 * factory, answers for frames this player does not know, setup moves and
 * extra action tries (ships, the pirate). Each hook may return `null` /
 * `undefined` to fall back to the C&K behaviour.
 */
export interface CkSimOptions {
  game?: (players: 3 | 4 | 5 | 6, seed: number) => GameState;
  pending?: (state: GameState, rng: Rng, step: number) => GameState | null | undefined;
  setup?: (state: GameState, rng: Rng, step: number) => GameState | null | undefined;
  tries?: (state: GameState, actorId: string, step: number) => AnyCommand[];
}

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
  progressPlayed: number;
  alchemy: number;
  harborExchanges: number;
  merchantPlaced: number;
  cardFrames: number;
  /** Distinct card types played. */
  played: Set<string>;
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
  'ck.progressPlayed': 'progressPlayed',
  'ck.alchemySet': 'alchemy',
  'ck.harborExchanged': 'harborExchanges',
  'ck.merchantPlaced': 'merchantPlaced',
};

/** The data of a module frame as its responder sees it. */
function frameView(state: GameState, viewerId: string): Record<string, any> {
  return ((projectGame(state, viewerId).pending as { data?: Record<string, any> } | null)?.data ?? {}) as Record<string, any>;
}

function pick<T>(list: readonly T[], step: number): T | undefined {
  return list.length > 0 ? list[step % list.length] : undefined;
}

/** A `progress.play` command for a playable card, built from its advisory targets. */
function cardCommand(state: GameState, actorId: string, hint: ProgressCardHint, step: number): AnyCommand | null {
  const targets = hint.targets as Record<string, any[]>;
  const play = (fields: Record<string, unknown> = {}): AnyCommand => ({ type: 'progress.play', card: hint.card, ...fields });
  switch (hint.card) {
    case 'alchemy':
      return null;
    case 'crane': {
      const option = pick(targets.tracks!, step) as { track: Track; metropolis: boolean; sites: number[] };
      return play({ track: option.track, ...(option.metropolis ? { vertex: option.sites[0] } : {}) });
    }
    case 'invention':
      return play({ hexes: [targets.hexes![step % targets.hexes!.length], targets.hexes![(step + 1) % targets.hexes!.length]] });
    case 'smithing':
      return play({ vertices: targets.vertices!.slice(0, 2) });
    case 'engineering':
    case 'medicine':
    case 'intrigue':
      return targets.vertices!.length > 0 ? play({ vertex: pick(targets.vertices!, step) }) : null;
    case 'merchant':
    case 'taxation':
      return targets.hexes!.length > 0 ? play({ hex: pick(targets.hexes!, step) }) : null;
    case 'diplomacy':
      return play({ edge: pick(targets.edges!, step) });
    case 'merchantFleet':
    case 'resourceMonopoly':
    case 'tradeMonopoly': {
      // Name what the others hold most of.
      const kinds = targets.kinds as CardKind[];
      const others = state.players.filter((player) => player.id !== actorId);
      const held = (kind: CardKind) => others.reduce((sum, player) => sum + ((player.resources as Record<string, number>)[kind] ?? (player.commodities as Record<string, number>)[kind] ?? 0), 0);
      return play({ kind: kinds.slice().sort((a, b) => held(b) - held(a))[0] });
    }
    case 'guildDues':
    case 'espionage':
    case 'treason':
      return targets.players!.length > 0 ? play({ target: pick(targets.players!, step) }) : null;
    default:
      return play();
  }
}

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
    case 'freeRoads': {
      for (const edge of actionHints(state, pending.actor).legalRoads) {
        const next = attempt(state, pending.actor, { type: 'build.road', edge }, rng);
        if (next) return next;
      }
      return null;
    }
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
        case 'citiesKnights.harborExchange': {
          const held = COMMODITIES.find((commodity) => playerOf(state, id).commodities[commodity] > 0)!;
          return attempt(state, id, { type: 'progress.harborAnswer', commodity: held }, rng);
        }
        case 'citiesKnights.guildDues': {
          const data = frameView(state, id);
          return attempt(state, id, { type: 'progress.takeCards', cards: cardPool(state, data.victim).slice(0, data.count) }, rng);
        }
        case 'citiesKnights.espionage': {
          const cards = frameView(state, id).cards as string[];
          return attempt(state, id, { type: 'progress.takeProgress', card: step % 3 === 0 ? null : (cards[0] ?? null) }, rng);
        }
        case 'citiesKnights.sabotage':
        case 'citiesKnights.wedding': {
          const required = (frame.data.required as Record<string, number>)[id]!;
          const type = frame.kind === 'citiesKnights.sabotage' ? 'progress.sabotageDiscard' : 'progress.weddingGive';
          return attempt(state, id, { type, cards: cardPool(state, id).slice(0, required) }, rng);
        }
        case 'citiesKnights.treasonRemove':
          return attempt(state, id, { type: 'progress.treasonRemove', vertex: frameView(state, id).knights[step % frameView(state, id).knights.length] }, rng);
        case 'citiesKnights.treasonPlace': {
          const data = frameView(state, id);
          const vertex = pick(data.sites as number[], step) ?? null;
          return attempt(state, id, { type: 'progress.treasonPlace', vertex, level: vertex === null ? null : data.levels[0] }, rng);
        }
        case 'citiesKnights.diplomacyRoad': {
          const edges = frameView(state, id).edges as number[];
          return attempt(state, id, { type: 'progress.diplomacyRoad', edge: step % 2 === 0 ? null : (pick(edges, step) ?? null) }, rng);
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

function actionTries(state: GameState, actorId: string, step: number, extra: AnyCommand[] = []): AnyCommand[] {
  const hints = actionHints(state, actorId);
  const ck = ckHints(state, actorId);
  const player = playerOf(state, actorId);
  const view = ckView(state);
  const tries: AnyCommand[] = [];
  if (ck.progressExcess > 0) {
    tries.push({ type: 'progress.discard', cards: player.progressCards.slice(0, ck.progressExcess) });
    return tries;
  }
  for (const hint of ck.progress) {
    if (!hint.playable) continue;
    const command = cardCommand(state, actorId, hint, step);
    if (command) tries.push(command);
  }
  const offered = resourcesBy(state, actorId, true)[0]!;
  for (const to of ck.harborTargets) {
    if (player.resources[offered] > 0) tries.push({ type: 'progress.harborOffer', to, resource: offered });
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
  tries.push(...extra);
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

export function simulateCitiesKnights(players: 3 | 4 | 5 | 6, seed: number, maxSteps = 40000, options: CkSimOptions = {}): CkSimulation {
  const rng = seededRng(seed * 7919 + players);
  let state = options.game ? options.game(players, seed) : ckGame(players, seed).state;
  const counters = { ...Object.fromEntries(Object.values(COUNTED).map((key) => [key, 0])), cardFrames: 0, played: new Set<string>() } as unknown as CkCounters;
  const count = (before: GameState, after: GameState) => {
    for (const event of after.log) {
      if (event.seq <= before.seq) continue;
      const key = COUNTED[event.type];
      if (key) (counters[key] as number)++;
      if (event.type === 'ck.progressPlayed') counters.played.add(event.params.card as string);
    }
  };
  for (let step = 0; step < maxSteps && !state.result; step++) {
    const before = state;
    if (state.turn.phase === 'setup') {
      state = options.setup?.(state, rng, step) ?? setupStep(state, rng, step);
      count(before, state);
      continue;
    }
    if (state.pending) {
      if (state.pending.kind.startsWith('citiesKnights.') && state.pending.kind !== 'citiesKnights.resolveRoll') counters.cardFrames++;
      const next = options.pending?.(state, rng, step) ?? resolvePending(state, rng, step);
      if (!next) throw new Error(`stuck on pending ${JSON.stringify(state.pending)}`);
      state = next;
      count(before, state);
      continue;
    }
    const actor = state.players[state.turn.seat]!;
    const hints = actionHints(state, actor.id);
    if (hints.canRoll) {
      const alchemy = ckHints(state, actor.id).progress.find((hint) => hint.card === 'alchemy' && hint.playable);
      if (alchemy && step % 2 === 0) {
        const dice = [(step % 6) + 1, ((step >> 3) % 6) + 1];
        const next = attempt(state, actor.id, { type: 'progress.play', card: 'alchemy', dice }, rng);
        if (next) {
          state = next;
          count(before, state);
          continue;
        }
      }
      state = attempt(state, actor.id, { type: 'turn.roll' }, rng)!;
      count(before, state);
      continue;
    }
    let advanced = false;
    for (const command of actionTries(state, actor.id, step, options.tries?.(state, actor.id, step) ?? [])) {
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
