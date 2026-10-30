/**
 * Deterministic rules engine.
 *
 * `applyCommand` is pure: it clones the incoming state, validates the command
 * against the current revision, applies the transition and returns the new
 * state plus the emitted events. Randomness is injected through `Rng` and every
 * drawn outcome is stored in the returned state, so recovery never needs to
 * replay a draw.
 *
 * The engine has no networking, database or timer dependency.
 */

import {
  BASE_AWARD_RULES,
  countBuildings,
  countRoads,
  harborRates,
  longestRouteLength,
  neighborsOfVertex,
  playerById,
  productionForRoll,
  recomputeAwards,
  scoreOf,
  topologyOf,
  totalResources,
} from './analysis.ts';
import { buildBaseLayout } from './layout.ts';
import { ENGINE_VERSION, requireProfile, type ProfileDefinition } from './profiles.ts';
import { shuffle, type Rng } from './rng.ts';
import { getTopology } from './topology-registry.ts';
import { verticesOfHex } from './topology.ts';
import {
  RESOURCES,
  type BoardState,
  type CommandError,
  type CommandErrorCode,
  type CommandOutcome,
  type GameEvent,
  type GameState,
  type HarborType,
  type Offer,
  type OfferResponse,
  type PlayerColor,
  type PlayerState,
  type Resource,
} from './types.ts';

export type Command =
  | { type: 'setup.placeBuilding'; vertex: number }
  | { type: 'setup.placeRoad'; edge: number }
  | { type: 'turn.roll' }
  | { type: 'turn.end' }
  | { type: 'build.road'; edge: number }
  | { type: 'build.settlement'; vertex: number }
  | { type: 'build.city'; vertex: number }
  | { type: 'build.devCard' }
  | { type: 'dev.playKnight'; hex: number }
  | { type: 'dev.playRoadBuilding' }
  | { type: 'dev.playYearOfPlenty' }
  | { type: 'dev.playMonopoly'; resource: Resource }
  | { type: 'pending.discard'; resources: Resource[] }
  | { type: 'pending.moveRobber'; hex: number }
  | { type: 'pending.steal'; victim: string }
  | { type: 'pending.takeResource'; resource: Resource }
  | { type: 'trade.bank'; give: Resource; receive: Resource }
  | {
      type: 'trade.offer';
      to: string | 'all';
      give: Partial<Record<Resource, number>>;
      want: Partial<Record<Resource, number>>;
    }
  | { type: 'trade.respond'; offerId: string; response: OfferResponse }
  | {
      type: 'trade.revise';
      offerId: string;
      give: Partial<Record<Resource, number>>;
      want: Partial<Record<Resource, number>>;
    }
  | { type: 'trade.withdraw'; offerId: string }
  | { type: 'trade.settle'; offerId: string; counterparty?: string };

export type CommandType = Command['type'];

export const COSTS = {
  road: { lumber: 1, brick: 1 } as Partial<Record<Resource, number>>,
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 } as Partial<Record<Resource, number>>,
  city: { grain: 2, ore: 3 } as Partial<Record<Resource, number>>,
  devCard: { wool: 1, grain: 1, ore: 1 } as Partial<Record<Resource, number>>,
};

const LOG_LIMIT = 200;

export interface CreateGamePlayer {
  id: string;
  nickname: string;
  color: PlayerColor;
}

export interface CreateGameOptions {
  profileId: string;
  players: CreateGamePlayer[];
  setupMode: 'fixed' | 'variable';
  rng: Rng;
}

export function createGame(options: CreateGameOptions): GameState {
  const profile = requireProfile(options.profileId);
  if (!profile.implemented) throw new Error(`profile is not implemented: ${profile.id}`);
  if (!profile.playerCounts.includes(options.players.length)) {
    throw new Error(`profile ${profile.id} does not support ${options.players.length} players`);
  }
  if (!profile.setupModes.includes(options.setupMode)) {
    throw new Error(`profile ${profile.id} does not support ${options.setupMode} setup`);
  }

  const layout = buildBaseLayout({ topology: getTopology(profile.topologyId), mode: options.setupMode, rng: options.rng });
  const topo = getTopology(layout.topologyId);
  const board: BoardState = {
    layout,
    robber: layout.robber,
    pirate: layout.pirate,
    buildings: topo.vertices.map(() => null),
    roads: topo.edges.map(() => null),
  };

  const bank = {} as Record<Resource, number>;
  for (const resource of RESOURCES) bank[resource] = profile.bankPerResource;

  const players: PlayerState[] = options.players.map((player, seat) => ({
    id: player.id,
    nickname: player.nickname,
    seat,
    color: player.color,
    resources: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 },
    commodities: { paper: 0, cloth: 0, coin: 0 },
    devCards: [],
    newDevCards: [],
    progressCards: [],
    newProgressCards: [],
    playedKnights: 0,
    improvements: { trade: 0, politics: 0, science: 0 },
    cityWalls: 0,
    defenders: 0,
    bonusPoints: 0,
    hiddenBonusPoints: 0,
    longestRoadLength: 0,
  }));

  const order = [
    ...players.map((player) => player.seat),
    ...players.map((player) => player.seat).reverse(),
  ];

  const state: GameState = {
    engineVersion: ENGINE_VERSION,
    profileId: profile.id,
    seedCommitment: null,
    players,
    awards: { longestRoad: null, largestArmy: null },
    board,
    bank,
    commodityBank: { paper: 0, cloth: 0, coin: 0 },
    devDeck: shuffle(profile.devDeck, options.rng),
    progressDecks: { trade: [], politics: [], science: [] },
    turn: {
      seat: order[0]!,
      phase: 'setup',
      dice: null,
      devCardPlayed: false,
      setup: { order, index: 0, stage: 'building', round: 1, lastVertex: null },
      pairedActor: 1,
      pairIndex: 0,
    },
    pending: null,
    offers: [],
    windowId: 1,
    seq: 0,
    result: null,
    log: [],
  };

  emit(state, 'game.created', {
    profileId: profile.id,
    playerIds: players.map((player) => player.id),
    setupMode: options.setupMode,
  });
  return state;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const deepClone = (globalThis as unknown as {
  structuredClone: <T>(value: T) => T;
}).structuredClone;

function clone<T>(value: T): T {
  return deepClone(value);
}

function emit(
  state: GameState,
  type: string,
  params: Record<string, unknown> = {},
  priv?: { to: string[]; params: Record<string, unknown> },
): GameEvent {
  state.seq += 1;
  const event: GameEvent = { seq: state.seq, type, params };
  if (priv) event.private = priv;
  state.log.push(event);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  return event;
}

function fail(code: CommandErrorCode, params?: Record<string, unknown>): CommandOutcome {
  const error: CommandError = params ? { code, params } : { code };
  return { ok: false, error };
}

function currentPlayer(state: GameState): PlayerState {
  return state.players[state.turn.seat]!;
}

function canAfford(player: PlayerState, cost: Partial<Record<Resource, number>>): boolean {
  return RESOURCES.every((resource) => player.resources[resource] >= (cost[resource] ?? 0));
}

function pay(player: PlayerState, cost: Partial<Record<Resource, number>>): void {
  for (const resource of RESOURCES) {
    const amount = cost[resource] ?? 0;
    if (amount > 0) player.resources[resource] -= amount;
  }
}

/** 建造與購卡的花費回到銀行，維持每種資源「銀行 + 手牌」總量守恆。 */
function payBank(state: GameState, player: PlayerState, cost: Partial<Record<Resource, number>>): void {
  pay(player, cost);
  for (const resource of RESOURCES) {
    const amount = cost[resource] ?? 0;
    if (amount > 0) state.bank[resource] += amount;
  }
}

function grant(player: PlayerState, resource: Resource, amount: number): void {
  player.resources[resource] += amount;
}

export function legalBuildingVertices(
  state: GameState,
  playerId: string,
  options: { setup?: boolean; lastVertex?: number | null; requireConnection?: boolean } = {},
): number[] {
  const topo = topologyOf(state);
  const out: number[] = [];
  for (let vertex = 0; vertex < topo.vertices.length; vertex++) {
    if (canPlaceBuilding(state, playerId, vertex, options)) out.push(vertex);
  }
  return out;
}

export function canPlaceBuilding(
  state: GameState,
  playerId: string,
  vertex: number,
  options: { setup?: boolean; lastVertex?: number | null; requireConnection?: boolean } = {},
): boolean {
  const topo = topologyOf(state);
  if (!topo.vertices[vertex]) return false;
  if (state.board.buildings[vertex]) return false;
  for (const neighbor of neighborsOfVertex(topo, vertex)) {
    if (state.board.buildings[neighbor]) return false;
  }
  if (options.setup) {
    const profile = requireProfile(state.profileId);
    return countBuildings(state, playerId, 'settlement') < profile.pieces.settlements;
  }
  if (options.requireConnection === false) return true;
  return vertexConnectsToNetwork(state, playerId, vertex);
}

function vertexConnectsToNetwork(state: GameState, playerId: string, vertex: number): boolean {
  const topo = topologyOf(state);
  const building = state.board.buildings[vertex];
  if (building && building.player === playerId) return true;
  for (const edge of topo.vertices[vertex]!.edges) {
    const road = state.board.roads[edge];
    if (!road || road.player !== playerId) continue;
    const [a, b] = topo.edges[edge]!.vertices;
    const other = a === vertex ? b : a;
    const otherBuilding = state.board.buildings[other];
    if (otherBuilding && otherBuilding.player !== playerId) continue;
    return true;
  }
  return false;
}

export function legalRoadEdges(
  state: GameState,
  playerId: string,
  options: { setup?: boolean; lastVertex?: number | null } = {},
): number[] {
  const topo = topologyOf(state);
  const out: number[] = [];
  for (let edge = 0; edge < topo.edges.length; edge++) {
    if (canPlaceRoad(state, playerId, edge, options)) out.push(edge);
  }
  return out;
}

export function canPlaceRoad(
  state: GameState,
  playerId: string,
  edge: number,
  options: { setup?: boolean; lastVertex?: number | null } = {},
): boolean {
  const topo = topologyOf(state);
  const info = topo.edges[edge];
  if (!info) return false;
  if (state.board.roads[edge]) return false;
  if (options.setup) {
    if (options.lastVertex === null || options.lastVertex === undefined) return false;
    return info.vertices.includes(options.lastVertex);
  }
  return info.vertices.some((vertex) => vertexConnectsToNetwork(state, playerId, vertex));
}

// ---------------------------------------------------------------------------
// turn lifecycle
// ---------------------------------------------------------------------------

function expireOffers(state: GameState, reason: 'window' | 'withdrawn' | 'gameOver'): void {
  for (const offer of state.offers) {
    if (offer.status === 'open' || offer.status === 'agreed') {
      offer.status = 'expired';
      emit(state, 'trade.expired', { offerId: offer.id, reason });
    }
  }
}

function beginTurn(state: GameState, seat: number): void {
  openActorWindow(state, seat, 1, 'preroll');
}

/**
 * Opens an action window for one actor. `pairedActor` distinguishes the
 * production actor (1) from the second actor (2) of a 5-6 player pair.
 */
function openActorWindow(
  state: GameState,
  seat: number,
  pairedActor: 1 | 2,
  phase: 'preroll' | 'action',
): void {
  const player = state.players[seat]!;
  // Cards bought on an earlier turn become playable when that seat next acts.
  player.devCards.push(...player.newDevCards);
  player.newDevCards = [];
  player.progressCards.push(...player.newProgressCards);
  player.newProgressCards = [];
  state.turn.seat = seat;
  state.turn.phase = phase;
  state.turn.dice = null;
  state.turn.devCardPlayed = false;
  state.turn.setup = null;
  state.turn.pairedActor = pairedActor;
  state.pending = null;
  state.windowId += 1;
  expireOffers(state, 'window');
  emit(state, 'turn.started', {
    playerId: player.id,
    windowId: state.windowId,
    pairedActor,
  });
  checkVictory(state);
}

/** The partner of a seat in a 5-6 player game: the third player to their left. */
export function partnerSeat(state: GameState, seat: number): number {
  const count = state.players.length;
  return (seat + 3) % count;
}

function checkVictory(state: GameState): void {
  if (state.result || state.turn.phase === 'setup' || state.turn.phase === 'gameOver') return;
  const profile = requireProfile(state.profileId);
  const player = currentPlayer(state);
  const score = scoreOf(state, player.id, { includeHidden: true });
  if (score >= profile.victoryTarget) {
    state.result = { playerId: player.id, reason: 'victory', atSeq: state.seq };
    state.turn.phase = 'gameOver';
    state.pending = null;
    expireOffers(state, 'gameOver');
    emit(state, 'game.finished', {
      playerId: player.id,
      reason: 'victory',
      score,
      target: profile.victoryTarget,
    });
  }
}

function afterBoardChange(state: GameState): void {
  recomputeAwards(state, {
    ...BASE_AWARD_RULES,
    longestRouteIncludesShips: requireProfile(state.profileId).longestRouteIncludesShips,
  });
}

// ---------------------------------------------------------------------------
// command dispatch
// ---------------------------------------------------------------------------

const PENDING_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>([
  'pending.discard',
  'pending.moveRobber',
  'pending.steal',
  'pending.takeResource',
  'build.road',
]);

export function applyCommand(
  state: GameState,
  actorId: string,
  command: Command,
  rng: Rng,
): CommandOutcome {
  if (!command || typeof command.type !== 'string') return fail('E_INVALID_COMMAND');
  if (!state.players.some((player) => player.id === actorId)) {
    return fail('E_INVALID_COMMAND', { reason: 'unknown-actor' });
  }
  if (state.result) return fail('E_GAME_OVER');

  if (state.pending && !PENDING_COMMANDS.has(command.type)) {
    return fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  }

  const next = clone(state);
  const outcome = dispatch(next, actorId, command, rng);
  if (!outcome.ok) return outcome;
  const events = next.log.filter((event) => event.seq > state.seq);
  return { ok: true, state: next, events };
}

function dispatch(
  state: GameState,
  actorId: string,
  command: Command,
  rng: Rng,
): CommandOutcome {
  switch (command.type) {
    case 'setup.placeBuilding':
      return setupPlaceBuilding(state, actorId, command.vertex);
    case 'setup.placeRoad':
      return setupPlaceRoad(state, actorId, command.edge);
    case 'turn.roll':
      return rollDice(state, actorId, rng);
    case 'turn.end':
      return endTurn(state, actorId);
    case 'build.road':
      return buildRoad(state, actorId, command.edge);
    case 'build.settlement':
      return buildSettlement(state, actorId, command.vertex);
    case 'build.city':
      return buildCity(state, actorId, command.vertex);
    case 'build.devCard':
      return buyDevCard(state, actorId, rng);
    case 'dev.playKnight':
      return playKnight(state, actorId, command.hex);
    case 'dev.playRoadBuilding':
      return playRoadBuilding(state, actorId);
    case 'dev.playYearOfPlenty':
      return playYearOfPlenty(state, actorId);
    case 'dev.playMonopoly':
      return playMonopoly(state, actorId, command.resource);
    case 'pending.discard':
      return submitDiscard(state, actorId, command.resources);
    case 'pending.moveRobber':
      return moveRobber(state, actorId, command.hex);
    case 'pending.steal':
      return stealFrom(state, actorId, command.victim, rng);
    case 'pending.takeResource':
      return takeResource(state, actorId, command.resource);
    case 'trade.bank':
      return bankTrade(state, actorId, command.give, command.receive);
    case 'trade.offer':
      return createOffer(state, actorId, command);
    case 'trade.respond':
      return respondToOffer(state, actorId, command.offerId, command.response);
    case 'trade.revise':
      return reviseOffer(state, actorId, command);
    case 'trade.withdraw':
      return withdrawOffer(state, actorId, command.offerId);
    case 'trade.settle':
      return settleOffer(state, actorId, command.offerId, command.counterparty);
    default:
      return fail('E_INVALID_COMMAND');
  }
}

function requireTurnActor(state: GameState, actorId: string): CommandOutcome | null {
  if (currentPlayer(state).id !== actorId) return fail('E_NOT_YOUR_TURN');
  return null;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

function setupPlaceBuilding(state: GameState, actorId: string, vertex: number): CommandOutcome {
  const setup = state.turn.setup;
  if (!setup) return fail('E_WRONG_PHASE');
  if (setup.stage !== 'building') return fail('E_WRONG_PHASE', { stage: setup.stage });
  const seat = setup.order[setup.index];
  if (seat === undefined) return fail('E_WRONG_PHASE');
  if (state.players[seat]!.id !== actorId) return fail('E_NOT_YOUR_TURN');
  if (!canPlaceBuilding(state, actorId, vertex, { setup: true })) {
    return fail('E_ILLEGAL_TARGET', { vertex });
  }
  state.board.buildings[vertex] = { player: actorId, city: false };
  setup.stage = 'road';
  setup.lastVertex = vertex;
  emit(state, 'setup.building', { playerId: actorId, vertex, round: setup.round });

  if (setup.round === 2) {
    const topo = topologyOf(state);
    const hexes = topo.vertices[vertex]!.hexes;
    const gained: Partial<Record<Resource, number>> = {};
    for (const hex of hexes) {
      const terrain = state.board.layout.terrain[hex];
      const resource = terrain ? terrainToResource(terrain) : null;
      if (!resource) continue;
      if (state.bank[resource] <= 0) continue;
      grant(playerById(state, actorId)!, resource, 1);
      state.bank[resource] -= 1;
      gained[resource] = (gained[resource] ?? 0) + 1;
    }
    emit(state, 'setup.startingResources', { playerId: actorId, resources: gained });
  }
  afterBoardChange(state);
  return { ok: true, state, events: [] };
}

function terrainToResource(terrain: string): Resource | null {
  switch (terrain) {
    case 'forest':
      return 'lumber';
    case 'hills':
      return 'brick';
    case 'pasture':
      return 'wool';
    case 'fields':
      return 'grain';
    case 'mountains':
      return 'ore';
    default:
      return null;
  }
}

function setupPlaceRoad(state: GameState, actorId: string, edge: number): CommandOutcome {
  const setup = state.turn.setup;
  if (!setup) return fail('E_WRONG_PHASE');
  if (setup.stage !== 'road') return fail('E_WRONG_PHASE', { stage: setup.stage });
  const seat = setup.order[setup.index];
  if (seat === undefined) return fail('E_WRONG_PHASE');
  if (state.players[seat]!.id !== actorId) return fail('E_NOT_YOUR_TURN');
  if (!canPlaceRoad(state, actorId, edge, { setup: true, lastVertex: setup.lastVertex })) {
    return fail('E_ILLEGAL_TARGET', { edge });
  }
  state.board.roads[edge] = { player: actorId, ship: false };
  emit(state, 'setup.road', { playerId: actorId, edge });

  setup.index += 1;
  setup.stage = 'building';
  setup.lastVertex = null;
  setup.round = setup.index < state.players.length ? 1 : 2;

  if (setup.index >= setup.order.length) {
    state.turn.setup = null;
    afterBoardChange(state);
    beginTurn(state, setup.order[0]!);
    return { ok: true, state, events: [] };
  }
  state.turn.seat = setup.order[setup.index]!;
  afterBoardChange(state);
  return { ok: true, state, events: [] };
}

// ---------------------------------------------------------------------------
// turn
// ---------------------------------------------------------------------------

function rollDice(state: GameState, actorId: string, rng: Rng): CommandOutcome {
  const guard = requireTurnActor(state, actorId);
  if (guard) return guard;
  if (state.turn.phase !== 'preroll') return fail('E_WRONG_PHASE', { phase: state.turn.phase });
  const die1 = rng.int(6) + 1;
  const die2 = rng.int(6) + 1;
  const total = die1 + die2;
  state.turn.dice = [die1, die2];
  state.turn.phase = 'action';
  emit(state, 'turn.rolled', { playerId: actorId, dice: [die1, die2], total });

  if (total === 7) {
    resolveSeven(state);
    return { ok: true, state, events: [] };
  }
  resolveProduction(state, total);
  return { ok: true, state, events: [] };
}

function resolveProduction(state: GameState, total: number): void {
  const results = productionForRoll(state, total);
  const summary: Record<string, Partial<Record<Resource, number>>> = {};
  for (const result of results) {
    if (!result.resource) continue;
    for (const share of result.granted) {
      const player = playerById(state, share.playerId);
      if (!player) continue;
      grant(player, result.resource, share.amount);
      state.bank[result.resource] -= share.amount;
      summary[share.playerId] = summary[share.playerId] ?? {};
      summary[share.playerId]![result.resource] =
        (summary[share.playerId]![result.resource] ?? 0) + share.amount;
    }
    if (result.starved) {
      emit(state, 'production.starved', { hex: result.hex, resource: result.resource, total });
    }
  }
  emit(state, 'production.resolved', { total, grants: summary });
}

function resolveSeven(state: GameState): void {
  const required: Record<string, number> = {};
  for (const player of state.players) {
    const hand = totalResources(player);
    if (hand > 7) required[player.id] = Math.floor(hand / 2);
  }
  if (Object.keys(required).length > 0) {
    state.pending = { kind: 'discard', required, submitted: {} };
    emit(state, 'discard.required', { required });
  } else {
    state.pending = {
      kind: 'moveRobber',
      actor: currentPlayer(state).id,
      cause: 'seven',
      pirate: false,
    };
    emit(state, 'robber.moveRequired', { playerId: currentPlayer(state).id, cause: 'seven' });
  }
}

function endTurn(state: GameState, actorId: string): CommandOutcome {
  const guard = requireTurnActor(state, actorId);
  if (guard) return guard;
  if (state.turn.phase !== 'action') return fail('E_WRONG_PHASE', { phase: state.turn.phase });
  if (state.pending) return fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  const profile = requireProfile(state.profileId);
  emit(state, 'turn.ended', { playerId: actorId, pairedActor: state.turn.pairedActor });

  if (profile.paired && state.turn.pairedActor === 1) {
    // Player 2 acts next, without another production roll (§5.5).
    openActorWindow(state, partnerSeat(state, state.turn.seat), 2, 'action');
    return { ok: true, state, events: [] };
  }

  if (profile.paired) {
    // Both markers advance to the next player to their left.
    state.turn.pairIndex += 1;
    beginTurn(state, state.turn.pairIndex % state.players.length);
    return { ok: true, state, events: [] };
  }

  beginTurn(state, (state.turn.seat + 1) % state.players.length);
  return { ok: true, state, events: [] };
}

/** Paired Player 2 may not start or settle a domestic exchange. */
function pairedTradeBlocked(state: GameState, actorId: string): CommandOutcome | null {
  const profile = requireProfile(state.profileId);
  if (!profile.paired) return null;
  if (state.turn.pairedActor !== 2) return null;
  if (currentPlayer(state).id !== actorId) return null;
  return fail('E_PAIRED_NO_DOMESTIC_TRADE');
}

// ---------------------------------------------------------------------------
// building
// ---------------------------------------------------------------------------

function requireActionPhase(state: GameState, actorId: string): CommandOutcome | null {
  const guard = requireTurnActor(state, actorId);
  if (guard) return guard;
  if (state.turn.phase !== 'action') return fail('E_WRONG_PHASE', { phase: state.turn.phase });
  return null;
}

/**
 * Negotiation happens inside the action window but is not limited to the turn
 * owner: recipients respond and may counteroffer while the window is open.
 */
function requireOpenWindow(state: GameState): CommandOutcome | null {
  if (state.turn.phase !== 'action') return fail('E_WRONG_PHASE', { phase: state.turn.phase });
  return null;
}

function buildRoad(state: GameState, actorId: string, edge: number): CommandOutcome {
  if (state.pending && state.pending.kind !== 'freeRoads') {
    return fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  }
  const free = state.pending?.kind === 'freeRoads' ? state.pending : null;
  if (free) {
    if (free.actor !== actorId) return fail('E_NOT_ACTOR');
  } else {
    const guard = requireActionPhase(state, actorId);
    if (guard) return guard;
  }
  if (!canPlaceRoad(state, actorId, edge)) return fail('E_ILLEGAL_TARGET', { edge });
  const player = playerById(state, actorId)!;
  const profile = requireProfile(state.profileId);
  if (countRoads(state, actorId) >= profile.pieces.roads) return fail('E_NO_PIECES', { piece: 'road' });

  if (!free) {
    if (!canAfford(player, COSTS.road)) {
      return fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.road });
    }
    payBank(state, player, COSTS.road);
  }
  state.board.roads[edge] = { player: actorId, ship: false };
  emit(state, 'build.road', { playerId: actorId, edge, free: !!free });
  afterBoardChange(state);

  if (free) {
    free.remaining -= 1;
    if (free.remaining <= 0 || legalRoadEdges(state, actorId).length === 0) {
      emit(state, 'dev.roadBuildingFinished', { playerId: actorId, placed: 2 - free.remaining });
      state.pending = null;
    }
  }
  checkVictory(state);
  return { ok: true, state, events: [] };
}

function buildSettlement(state: GameState, actorId: string, vertex: number): CommandOutcome {
  const guard = requireActionPhase(state, actorId);
  if (guard) return guard;
  if (!canPlaceBuilding(state, actorId, vertex)) {
    return fail('E_ILLEGAL_TARGET', { vertex });
  }
  const profile = requireProfile(state.profileId);
  if (countBuildings(state, actorId, 'settlement') >= profile.pieces.settlements) {
    return fail('E_NO_PIECES', { piece: 'settlement' });
  }
  const player = playerById(state, actorId)!;
  if (!canAfford(player, COSTS.settlement)) {
    return fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.settlement });
  }
  payBank(state, player, COSTS.settlement);
  state.board.buildings[vertex] = { player: actorId, city: false };
  emit(state, 'build.settlement', { playerId: actorId, vertex });
  afterBoardChange(state);
  checkVictory(state);
  return { ok: true, state, events: [] };
}

function buildCity(state: GameState, actorId: string, vertex: number): CommandOutcome {
  const guard = requireActionPhase(state, actorId);
  if (guard) return guard;
  const building = state.board.buildings[vertex];
  if (!building || building.player !== actorId || building.city) {
    return fail('E_ILLEGAL_TARGET', { vertex });
  }
  const profile = requireProfile(state.profileId);
  if (countBuildings(state, actorId, 'city') >= profile.pieces.cities) {
    return fail('E_NO_PIECES', { piece: 'city' });
  }
  const player = playerById(state, actorId)!;
  if (!canAfford(player, COSTS.city)) {
    return fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.city });
  }
  payBank(state, player, COSTS.city);
  building.city = true;
  emit(state, 'build.city', { playerId: actorId, vertex });
  afterBoardChange(state);
  checkVictory(state);
  return { ok: true, state, events: [] };
}

function buyDevCard(state: GameState, actorId: string, rng: Rng): CommandOutcome {
  const guard = requireActionPhase(state, actorId);
  if (guard) return guard;
  if (state.devDeck.length === 0) return fail('E_DECK_EMPTY');
  const player = playerById(state, actorId)!;
  if (!canAfford(player, COSTS.devCard)) {
    return fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.devCard });
  }
  payBank(state, player, COSTS.devCard);
  const index = rng.int(state.devDeck.length);
  const card = state.devDeck.splice(index, 1)[0]!;
  player.newDevCards.push(card);
  emit(
    state,
    'build.devCard',
    { playerId: actorId, remaining: state.devDeck.length },
    { to: [actorId], params: { card } },
  );
  checkVictory(state);
  return { ok: true, state, events: [] };
}

// ---------------------------------------------------------------------------
// development cards
// ---------------------------------------------------------------------------

function canPlayDevCard(state: GameState, actorId: string): CommandOutcome | null {
  const guard = requireTurnActor(state, actorId);
  if (guard) return guard;
  if (state.turn.phase !== 'preroll' && state.turn.phase !== 'action') {
    return fail('E_WRONG_PHASE', { phase: state.turn.phase });
  }
  if (state.turn.devCardPlayed) return fail('E_CARD_ALREADY_PLAYED');
  return null;
}

function playKnight(state: GameState, actorId: string, hex: number): CommandOutcome {
  const guard = canPlayDevCard(state, actorId);
  if (guard) return guard;
  const player = playerById(state, actorId)!;
  if (!player.devCards.includes('knight')) {
    if (player.newDevCards.includes('knight')) return fail('E_CARD_JUST_BOUGHT', { card: 'knight' });
    return fail('E_CARD_NOT_HELD', { card: 'knight' });
  }
  const pool = player.devCards;
  const topo = topologyOf(state);
  if (!topo.hexes[hex]) return fail('E_ILLEGAL_TARGET', { hex });
  if (hex === state.board.robber) return fail('E_ROBBER_SAME_HEX', { hex });

  const index = pool.indexOf('knight');
  pool.splice(index, 1);
  player.playedKnights += 1;
  state.turn.devCardPlayed = true;
  state.board.robber = hex;
  emit(state, 'dev.knight', { playerId: actorId, hex, playedKnights: player.playedKnights });
  afterBoardChange(state);

  const candidates = stealCandidates(state, hex, actorId);
  if (candidates.length > 0) {
    state.pending = { kind: 'steal', actor: actorId, hex, candidates, pirate: false };
  }
  checkVictory(state);
  return { ok: true, state, events: [] };
}

function stealCandidates(state: GameState, hex: number, actorId: string): string[] {
  const topo = topologyOf(state);
  const out = new Set<string>();
  for (const vertex of verticesOfHex(topo, hex)) {
    const building = state.board.buildings[vertex];
    if (!building || building.player === actorId) continue;
    const player = playerById(state, building.player);
    if (player && totalResources(player) > 0) out.add(building.player);
  }
  return [...out];
}

function playRoadBuilding(state: GameState, actorId: string): CommandOutcome {
  const guard = canPlayDevCard(state, actorId);
  if (guard) return guard;
  const player = playerById(state, actorId)!;
  if (!player.devCards.includes('roadBuilding')) return fail('E_CARD_NOT_HELD', { card: 'roadBuilding' });
  if (player.newDevCards.includes('roadBuilding')) return fail('E_CARD_JUST_BOUGHT', { card: 'roadBuilding' });
  player.devCards.splice(player.devCards.indexOf('roadBuilding'), 1);
  state.turn.devCardPlayed = true;
  emit(state, 'dev.roadBuilding', { playerId: actorId });
  const available = legalRoadEdges(state, actorId).length;
  const remaining = Math.min(2, available);
  if (remaining > 0) {
    state.pending = { kind: 'freeRoads', actor: actorId, remaining };
  }
  return { ok: true, state, events: [] };
}

function playYearOfPlenty(state: GameState, actorId: string): CommandOutcome {
  const guard = canPlayDevCard(state, actorId);
  if (guard) return guard;
  const player = playerById(state, actorId)!;
  if (!player.devCards.includes('yearOfPlenty')) return fail('E_CARD_NOT_HELD', { card: 'yearOfPlenty' });
  if (player.newDevCards.includes('yearOfPlenty')) return fail('E_CARD_JUST_BOUGHT', { card: 'yearOfPlenty' });
  player.devCards.splice(player.devCards.indexOf('yearOfPlenty'), 1);
  state.turn.devCardPlayed = true;
  state.pending = { kind: 'yearOfPlenty', actor: actorId, remaining: 2 };
  emit(state, 'dev.yearOfPlenty', { playerId: actorId });
  return { ok: true, state, events: [] };
}

function takeResource(state: GameState, actorId: string, resource: Resource): CommandOutcome {
  const pending = state.pending;
  if (!pending || pending.kind !== 'yearOfPlenty') return fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' });
  if (pending.actor !== actorId) return fail('E_NOT_ACTOR');
  if (!RESOURCES.includes(resource)) return fail('E_INVALID_SELECTION');
  if (state.bank[resource] <= 0) return fail('E_BANK_EMPTY', { resource });
  grant(playerById(state, actorId)!, resource, 1);
  state.bank[resource] -= 1;
  pending.remaining -= 1;
  emit(state, 'dev.yearOfPlentyPick', { playerId: actorId, resource });
  if (pending.remaining <= 0) state.pending = null;
  return { ok: true, state, events: [] };
}

function playMonopoly(state: GameState, actorId: string, resource: Resource): CommandOutcome {
  const guard = canPlayDevCard(state, actorId);
  if (guard) return guard;
  if (!RESOURCES.includes(resource)) return fail('E_INVALID_SELECTION');
  const player = playerById(state, actorId)!;
  if (!player.devCards.includes('monopoly')) return fail('E_CARD_NOT_HELD', { card: 'monopoly' });
  if (player.newDevCards.includes('monopoly')) return fail('E_CARD_JUST_BOUGHT', { card: 'monopoly' });
  player.devCards.splice(player.devCards.indexOf('monopoly'), 1);
  state.turn.devCardPlayed = true;
  const taken: Record<string, number> = {};
  for (const other of state.players) {
    if (other.id === actorId) continue;
    const amount = other.resources[resource];
    if (amount <= 0) continue;
    other.resources[resource] = 0;
    grant(player, resource, amount);
    taken[other.id] = amount;
  }
  emit(state, 'dev.monopoly', { playerId: actorId, resource, taken });
  checkVictory(state);
  return { ok: true, state, events: [] };
}

// ---------------------------------------------------------------------------
// pending effects
// ---------------------------------------------------------------------------

function submitDiscard(state: GameState, actorId: string, resources: Resource[]): CommandOutcome {
  const pending = state.pending;
  if (!pending || pending.kind !== 'discard') {
    return fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' });
  }
  const required = pending.required[actorId];
  if (required === undefined) return fail('E_NOT_ACTOR');
  if (pending.submitted[actorId]) return fail('E_INVALID_SELECTION', { reason: 'already-submitted' });
  if (!Array.isArray(resources) || resources.length !== required) {
    return fail('E_INVALID_DISCARD_COUNT', { required });
  }
  const player = playerById(state, actorId)!;
  const counts: Partial<Record<Resource, number>> = {};
  for (const resource of resources) {
    if (!RESOURCES.includes(resource)) return fail('E_INVALID_SELECTION', { resource });
    counts[resource] = (counts[resource] ?? 0) + 1;
  }
  for (const [resource, amount] of Object.entries(counts) as [Resource, number][]) {
    if (player.resources[resource] < amount) {
      return fail('E_INVALID_SELECTION', { resource, available: player.resources[resource] });
    }
  }
  for (const [resource, amount] of Object.entries(counts) as [Resource, number][]) {
    player.resources[resource] -= amount;
    state.bank[resource] += amount;
  }
  pending.submitted[actorId] = resources.slice();
  emit(state, 'discard.submitted', { playerId: actorId, count: resources.length });

  const outstanding = Object.keys(pending.required).filter((id) => !pending.submitted[id]);
  if (outstanding.length === 0) {
    const roller = currentPlayer(state).id;
    state.pending = { kind: 'moveRobber', actor: roller, cause: 'seven', pirate: false };
    emit(state, 'robber.moveRequired', { playerId: roller, cause: 'seven' });
  }
  return { ok: true, state, events: [] };
}

function moveRobber(state: GameState, actorId: string, hex: number): CommandOutcome {
  const pending = state.pending;
  if (!pending || pending.kind !== 'moveRobber') {
    return fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' });
  }
  if (pending.actor !== actorId) return fail('E_NOT_ACTOR');
  const topo = topologyOf(state);
  if (!topo.hexes[hex]) return fail('E_ILLEGAL_TARGET', { hex });
  if (hex === state.board.robber) return fail('E_ROBBER_SAME_HEX', { hex });
  state.board.robber = hex;
  emit(state, 'robber.moved', { playerId: actorId, hex, cause: pending.cause });

  const candidates = stealCandidates(state, hex, actorId);
  if (candidates.length > 0) {
    state.pending = { kind: 'steal', actor: actorId, hex, candidates, pirate: false };
  } else {
    state.pending = null;
  }
  return { ok: true, state, events: [] };
}

function stealFrom(state: GameState, actorId: string, victim: string, rng: Rng): CommandOutcome {
  const pending = state.pending;
  if (!pending || pending.kind !== 'steal') {
    return fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' });
  }
  if (pending.actor !== actorId) return fail('E_NOT_ACTOR');
  if (!pending.candidates.includes(victim)) return fail('E_NO_ELIGIBLE_VICTIM', { victim });
  const victimPlayer = playerById(state, victim);
  if (!victimPlayer) return fail('E_ILLEGAL_TARGET', { victim });
  const pool: Resource[] = [];
  for (const resource of RESOURCES) {
    for (let i = 0; i < victimPlayer.resources[resource]; i++) pool.push(resource);
  }
  if (pool.length === 0) return fail('E_NO_ELIGIBLE_VICTIM', { victim });
  const resource = pool[rng.int(pool.length)]!;
  victimPlayer.resources[resource] -= 1;
  grant(playerById(state, actorId)!, resource, 1);
  state.pending = null;
  emit(
    state,
    'robber.stole',
    { playerId: actorId, victim },
    { to: [actorId, victim], params: { resource } },
  );
  return { ok: true, state, events: [] };
}

// ---------------------------------------------------------------------------
// trading
// ---------------------------------------------------------------------------

function bankTrade(state: GameState, actorId: string, give: Resource, receive: Resource): CommandOutcome {
  const guard = requireActionPhase(state, actorId);
  if (guard) return guard;
  if (!RESOURCES.includes(give) || !RESOURCES.includes(receive)) return fail('E_INVALID_SELECTION');
  if (give === receive) return fail('E_INVALID_SELECTION', { reason: 'same-resource' });
  if (state.bank[receive] <= 0) return fail('E_BANK_EMPTY', { resource: receive });
  const rates = harborRates(state, actorId);
  const rate = rates[give];
  const player = playerById(state, actorId)!;
  if (player.resources[give] < rate) {
    return fail('E_INSUFFICIENT_RESOURCES', { resource: give, required: rate });
  }
  player.resources[give] -= rate;
  state.bank[give] += rate;
  player.resources[receive] += 1;
  state.bank[receive] -= 1;
  emit(state, 'trade.bank', { playerId: actorId, give, receive, rate });
  return { ok: true, state, events: [] };
}

function normalizeTerms(terms: Partial<Record<Resource, number>>): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = {};
  for (const resource of RESOURCES) {
    const amount = terms[resource] ?? 0;
    if (amount > 0) out[resource] = amount;
  }
  return out;
}

function termsTotal(terms: Partial<Record<Resource, number>>): number {
  return RESOURCES.reduce((sum, resource) => sum + (terms[resource] ?? 0), 0);
}

function createOffer(
  state: GameState,
  actorId: string,
  command: { to: string | 'all'; give: Partial<Record<Resource, number>>; want: Partial<Record<Resource, number>> },
): CommandOutcome {
  const guard = requireOpenWindow(state);
  if (guard) return guard;
  const tradeBlock = pairedTradeBlocked(state, actorId);
  if (tradeBlock) return tradeBlock;
  const turnActor = currentPlayer(state).id;
  // Anyone may propose during the open window, but an offer from a non-actor
  // must be a counteroffer addressed to the action-window actor.
  if (actorId !== turnActor && command.to !== turnActor) {
    return fail('E_NOT_YOUR_TURN', { counterofferTo: turnActor });
  }
  const give = normalizeTerms(command.give ?? {});
  const want = normalizeTerms(command.want ?? {});
  if (termsTotal(give) === 0 || termsTotal(want) === 0) {
    return fail('E_INVALID_SELECTION', { reason: 'empty-terms' });
  }
  if (command.to !== 'all') {
    if (command.to === actorId) return fail('E_INVALID_SELECTION', { reason: 'self-offer' });
    if (!playerById(state, command.to)) return fail('E_ILLEGAL_TARGET', { to: command.to });
  }
  const offer: Offer = {
    id: `offer-${state.seq + 1}-${state.offers.length + 1}`,
    revision: 1,
    from: actorId,
    to: command.to,
    give,
    want,
    windowId: state.windowId,
    status: 'open',
    responses: {},
    agreedWith: null,
    createdSeq: state.seq + 1,
  };
  state.offers.push(offer);
  emit(state, 'trade.offered', { offerId: offer.id, from: actorId, to: offer.to, give, want });
  return { ok: true, state, events: [] };
}

function respondToOffer(
  state: GameState,
  actorId: string,
  offerId: string,
  response: OfferResponse,
): CommandOutcome {
  const guard = requireOpenWindow(state);
  if (guard) return guard;
  const offer = state.offers.find((candidate) => candidate.id === offerId);
  if (!offer) return fail('E_UNKNOWN_OFFER', { offerId });
  if (offer.status !== 'open') return fail('E_OFFER_CLOSED', { status: offer.status });
  if (offer.from === actorId) return fail('E_NOT_RECIPIENT');
  if (offer.to !== 'all' && offer.to !== actorId) return fail('E_NOT_RECIPIENT');
  if (response !== 'declined' && response !== 'interested' && response !== 'consented') {
    return fail('E_INVALID_SELECTION', { response });
  }
  offer.responses[actorId] = response;
  emit(state, 'trade.responded', { offerId, playerId: actorId, response });
  return { ok: true, state, events: [] };
}

function reviseOffer(
  state: GameState,
  actorId: string,
  command: { offerId: string; give: Partial<Record<Resource, number>>; want: Partial<Record<Resource, number>> },
): CommandOutcome {
  const guard = requireOpenWindow(state);
  if (guard) return guard;
  const offer = state.offers.find((candidate) => candidate.id === command.offerId);
  if (!offer) return fail('E_UNKNOWN_OFFER', { offerId: command.offerId });
  if (offer.from !== actorId) return fail('E_NOT_ACTOR');
  if (offer.status !== 'open') return fail('E_OFFER_CLOSED', { status: offer.status });
  const give = normalizeTerms(command.give ?? {});
  const want = normalizeTerms(command.want ?? {});
  if (termsTotal(give) === 0 || termsTotal(want) === 0) {
    return fail('E_INVALID_SELECTION', { reason: 'empty-terms' });
  }
  offer.give = give;
  offer.want = want;
  offer.revision += 1;
  offer.responses = {};
  offer.agreedWith = null;
  emit(state, 'trade.revised', { offerId: offer.id, revision: offer.revision, give, want });
  return { ok: true, state, events: [] };
}

function withdrawOffer(state: GameState, actorId: string, offerId: string): CommandOutcome {
  const guard = requireOpenWindow(state);
  if (guard) return guard;
  const offer = state.offers.find((candidate) => candidate.id === offerId);
  if (!offer) return fail('E_UNKNOWN_OFFER', { offerId });
  if (offer.from !== actorId) return fail('E_NOT_ACTOR');
  if (offer.status !== 'open' && offer.status !== 'agreed') {
    return fail('E_OFFER_CLOSED', { status: offer.status });
  }
  offer.status = 'withdrawn';
  emit(state, 'trade.withdrawn', { offerId });
  return { ok: true, state, events: [] };
}

function settleOffer(
  state: GameState,
  actorId: string,
  offerId: string,
  counterparty?: string,
): CommandOutcome {
  const guard = requireActionPhase(state, actorId);
  if (guard) return guard;
  const tradeBlock = pairedTradeBlocked(state, actorId);
  if (tradeBlock) return tradeBlock;
  const offer = state.offers.find((candidate) => candidate.id === offerId);
  if (!offer) return fail('E_UNKNOWN_OFFER', { offerId });
  if (offer.status !== 'open') return fail('E_OFFER_CLOSED', { status: offer.status });

  // `offer.give` is always stated from the proposer's (`offer.from`) point of
  // view; the counterparty is the named recipient, or the consenting partner
  // chosen for a table-wide offer.
  let other: string;
  if (offer.to === 'all') {
    if (offer.from !== actorId) return fail('E_NOT_ACTOR');
    if (!counterparty) return fail('E_INVALID_SELECTION', { reason: 'counterparty-required' });
    if (offer.responses[counterparty] !== 'consented') {
      return fail('E_NOT_CONSENTED', { counterparty });
    }
    other = counterparty;
  } else if (offer.from === actorId) {
    other = offer.to;
    if (offer.responses[other] !== 'consented') return fail('E_NOT_CONSENTED', { counterparty: other });
  } else if (offer.to === actorId) {
    // The recipient confirms the counteroffer addressed to them; proposing it
    // is the originator's consent.
    other = offer.from;
  } else {
    return fail('E_NOT_ACTOR');
  }

  const proposer = playerById(state, offer.from)!;
  const partnerId = offer.to === 'all' ? other : offer.to;
  const partner = playerById(state, partnerId)!;
  if (!canAfford(proposer, offer.give)) {
    return fail('E_INSUFFICIENT_RESOURCES', { playerId: proposer.id });
  }
  if (!canAfford(partner, offer.want)) {
    return fail('E_INSUFFICIENT_RESOURCES', { playerId: partner.id });
  }
  pay(proposer, offer.give);
  pay(partner, offer.want);
  for (const resource of RESOURCES) {
    const toPartner = offer.give[resource] ?? 0;
    const toProposer = offer.want[resource] ?? 0;
    if (toPartner > 0) grant(partner, resource, toPartner);
    if (toProposer > 0) grant(proposer, resource, toProposer);
  }
  offer.status = 'completed';
  offer.agreedWith = other;
  emit(state, 'trade.completed', {
    offerId,
    revision: offer.revision,
    from: offer.from,
    to: other,
    give: offer.give,
    want: offer.want,
  });
  checkVictory(state);
  return { ok: true, state, events: [] };
}

/**
 * Terminal transition for a table that agreed to end an interrupted game.
 *
 * This is a lifecycle transition, not a rule: it produces no winner, cancels
 * outstanding negotiation and rejects every later strategic command (§4.6).
 */
export function abandonGame(state: GameState): GameState {
  if (state.result) return state;
  const next = clone(state);
  next.result = { playerId: null, reason: 'abandoned', atSeq: next.seq };
  next.turn.phase = 'gameOver';
  next.pending = null;
  expireOffers(next, 'gameOver');
  emit(next, 'game.abandoned', { reason: 'abandoned' });
  return next;
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

export interface ActionHints {
  canRoll: boolean;
  canEndTurn: boolean;
  legalRoads: number[];
  legalSettlements: number[];
  legalCities: number[];
  bankRates: Record<Resource, number>;
  pendingKind: string | null;
}

/** Legal-action hints for the acting player's UI. Advisory only. */
export function actionHints(state: GameState, playerId: string): ActionHints {
  const isTurn = currentPlayer(state).id === playerId;
  const inAction = isTurn && state.turn.phase === 'action' && !state.pending;
  const freeRoads = state.pending?.kind === 'freeRoads' && state.pending.actor === playerId;
  const setup = state.turn.setup;
  const setupIsMine = !!setup && state.players[setup.order[setup.index] ?? -1]?.id === playerId;
  const setupBuilding = setupIsMine && setup!.stage === 'building';
  const setupRoad = setupIsMine && setup!.stage === 'road';
  return {
    canRoll: isTurn && state.turn.phase === 'preroll' && !state.pending,
    canEndTurn: inAction,
    legalRoads:
      inAction || freeRoads
        ? legalRoadEdges(state, playerId)
        : setupRoad
          ? legalRoadEdges(state, playerId, { setup: true, lastVertex: setup!.lastVertex })
          : [],
    legalSettlements: inAction
      ? legalBuildingVertices(state, playerId)
      : setupBuilding
        ? legalBuildingVertices(state, playerId, { setup: true })
        : [],
    legalCities: inAction
      ? state.board.buildings
          .map((building, vertex) => ({ building, vertex }))
          .filter(({ building }) => !!building && building.player === playerId && !building.city)
          .map(({ vertex }) => vertex)
      : [],
    bankRates: harborRates(state, playerId),
    pendingKind: state.pending ? state.pending.kind : null,
  };
}

export function profileOf(state: GameState): ProfileDefinition {
  return requireProfile(state.profileId);
}

export function harborTypeAt(state: GameState, edge: number): HarborType | null {
  const harbor = state.board.layout.harbors.find((candidate) => candidate.edge === edge);
  return harbor ? harbor.type : null;
}

export function routeLength(state: GameState, playerId: string): number {
  return longestRouteLength(state, playerId, requireProfile(state.profileId).longestRouteIncludesShips);
}
