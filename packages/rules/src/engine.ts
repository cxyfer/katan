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
  isLandEdge,
  isLandHex,
  isLandVertex,
  longestRouteLength,
  moduleVertexBlocker,
  neighborsOfVertex,
  playerById,
  productionForRoll,
  recomputeAwards,
  scoreOf,
  topologyOf,
  victoryTargetOf,
  totalCards,
} from './analysis.ts';
import { buildProfileLayout } from './layout-registry.ts';
import type { CommandErrorCode } from './messages.ts';
import { moduleCommandTypes, rulesModulesOf } from './modules/registry.ts';
import type {
  BuildEvent,
  BanditMove,
  ModuleCommand,
  ModuleContext,
  ModuleViewContext,
  RollResult,
  RulesKit,
  RulesModule,
} from './modules/types.ts';
import { advancePending, clearPending, enqueuePending, normalizePending, pendingQueueOf } from './pending.ts';
import { requireProfile, type ProfileDefinition } from './profiles.ts';
import { shuffle, type Rng } from './rng.ts';
import {
  addResource,
  addResources,
  createGameStats,
  ensureStats,
  playerStats,
  type PlayerStats,
} from './stats.ts';
import { getTopology } from './topology-registry.ts';
import { verticesOfHex } from './topology.ts';
import {
  CARD_KINDS,
  COMMODITIES,
  RESOURCES,
  type BoardState,
  type CardKind,
  type Commodity,
  type CommandError,
  type CommandOutcome,
  type DevCardType,
  type GameEvent,
  type GameState,
  type HarborType,
  type Offer,
  type OfferResponse,
  type Pending,
  type PendingFrame,
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
  | { type: 'dev.playKnight'; hex: number | null }
  | { type: 'dev.playRoadBuilding' }
  | { type: 'dev.playYearOfPlenty' }
  | { type: 'dev.playMonopoly'; resource: Resource }
  | { type: 'pending.discard'; resources: CardKind[] }
  | { type: 'pending.moveRobber'; hex: number | null }
  | { type: 'pending.steal'; victim: string }
  | { type: 'pending.takeResource'; resource: Resource }
  | { type: 'trade.bank'; give: CardKind; receive: CardKind }
  | {
      type: 'trade.offer';
      to: string | 'all';
      give: Partial<Record<CardKind, number>>;
      want: Partial<Record<CardKind, number>>;
    }
  | { type: 'trade.respond'; offerId: string; response: OfferResponse }
  | {
      type: 'trade.revise';
      offerId: string;
      give: Partial<Record<CardKind, number>>;
      want: Partial<Record<CardKind, number>>;
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

  const layout = buildProfileLayout(profile, {
    mode: options.setupMode,
    playerCount: options.players.length,
    rng: options.rng,
  });
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
    engineVersion: profile.ruleVersion,
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
    stats: createGameStats(players, true),
  };

  emit(state, 'game.created', {
    profileId: profile.id,
    playerIds: players.map((player) => player.id),
    setupMode: options.setupMode,
  });
  const ctx = moduleContext(profile, options.rng);
  for (const module of rulesModulesOf(profile)) module.initGame?.(state, ctx);
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

function accept(state: GameState): CommandOutcome {
  return { ok: true, state, events: [] };
}

function modulesOf(state: GameState): readonly RulesModule[] {
  return rulesModulesOf(requireProfile(state.profileId));
}

function viewContext(state: GameState): ModuleViewContext {
  return { profile: requireProfile(state.profileId), rules: VIEW_RULES };
}

const VIEW_RULES: ModuleViewContext['rules'] = {
  canPlaceRoad: (state, playerId, edge) => canPlaceRoad(state, playerId, edge),
  canPlaceBuilding: (state, playerId, vertex, options) => canPlaceBuilding(state, playerId, vertex, options ?? {}),
};

/** Engine services handed to rules modules (see `modules/types.ts`). */
const KIT: RulesKit = {
  emit,
  fail,
  accept,
  currentPlayer,
  topology: topologyOf,
  canAfford,
  payBuild: (state, player, cost) => {
    payBuild(state, player, cost);
  },
  afterBoardChange,
  checkVictory,
  enqueuePending,
  completePending: (state, rng) => completePending(state, rng ?? null),
  resolveRollOutcome: (state, roll, rng) => resolveRollOutcome(state, roll, rng ?? null),
  finishSetupStep,
  finishTurn,
  canPlaceRoad: (state, playerId, edge) => canPlaceRoad(state, playerId, edge),
  canPlaceBuilding: (state, playerId, vertex, options) => canPlaceBuilding(state, playerId, vertex, options ?? {}),
  legalRoads: (state, playerId) => legalRoadEdges(state, playerId),
  placedFreeRoute: (state, playerId, rng) => placedFreeRoute(state, playerId, rng ?? null),
  freeRouteTargets: freeRouteCapacity,
  legalShips: moduleLegalShips,
  shipPlaced: (state, playerId, edge) => {
    const ctx = viewContext(state);
    for (const module of modulesOf(state)) module.shipPlaced?.(state, playerId, edge, ctx);
  },
};

/** Ship placements the profile's modules offer the player now. */
function moduleLegalShips(state: GameState, playerId: string): number[] {
  const modules = modulesOf(state);
  if (modules.length === 0) return [];
  const ctx = viewContext(state);
  return modules.flatMap((module) => module.legalShips?.(state, playerId, ctx) ?? []);
}

function moduleContext(profile: ProfileDefinition, rng: Rng | null, resumeAfter?: string): ModuleContext {
  const kit = resumeAfter === undefined ? KIT : {
    ...KIT,
    resolveRollOutcome: (state: GameState, roll: RollResult, continuationRng?: Rng) =>
      runBeforeProduction(state, roll, continuationRng ?? rng,
        rulesModulesOf(profile).findIndex((module) => module.id === resumeAfter) + 1),
  };
  return { profile, rng: rng ?? NO_RNG, kit };
}

/** Stand-in for transitions that must not draw (a draw would be a bug). */
const NO_RNG: Rng = {
  int() {
    throw new Error('this transition has no randomness source');
  },
};

/**
 * Finishes the active frame. A module continuation frame (no responders)
 * that becomes active is resolved straight away by its module.
 */
function completePending(state: GameState, rng: Rng | null): void {
  let next = advancePending(state);
  for (let guard = 0; next && next.kind.includes('.') && guard < 64; guard++) {
    const frame = next as Extract<typeof next, { module: string }>;
    const module = modulesOf(state).find((candidate) => candidate.id === frame.module);
    if (frame.responders.length > 0) {
      module?.activatePending?.(state, frame, moduleContext(requireProfile(state.profileId), rng));
      return;
    }
    if (!module?.resumePending) throw new Error(`no continuation for pending frame ${frame.kind}`);
    module.resumePending(state, frame, moduleContext(requireProfile(state.profileId), rng, module.id));
    if (state.pending !== frame) return;
    next = advancePending(state);
  }
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

/** 建造與購卡：付款並記入統計的「消耗」。 */
function payBuild(state: GameState, player: PlayerState, cost: Partial<Record<Resource, number>>): PlayerStats {
  payBank(state, player, cost);
  const stats = playerStats(state, player.id);
  addResources(stats.spent, cost);
  return stats;
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
  if (!isLandVertex(state, vertex)) return false;
  for (const neighbor of neighborsOfVertex(topo, vertex)) {
    if (state.board.buildings[neighbor]) return false;
  }
  if (!modulesAllowBuilding(state, playerId, vertex, !!options.setup)) return false;
  if (!modulesAllowScenarioBuilding(state, playerId, vertex, 'settlement')) return false;
  if (options.setup) {
    const profile = requireProfile(state.profileId);
    return countBuildings(state, playerId, 'settlement') < profile.pieces.settlements;
  }
  if (options.requireConnection === false) return true;
  return touchesOwnRoad(state, playerId, vertex);
}

function modulesAllowScenarioBuilding(state: GameState, playerId: string, vertex: number, kind: 'settlement' | 'city'): boolean {
  const modules = modulesOf(state);
  if (modules.length === 0) return true;
  const ctx = viewContext(state);
  return modules.every((module) => !module.buildingAllowed || module.buildingAllowed(state, playerId, vertex, kind, ctx));
}

function modulesAllowRoad(state: GameState, playerId: string, edge: number): boolean {
  const modules = modulesOf(state);
  if (modules.length === 0) return true;
  const ctx = viewContext(state);
  return modules.every((module) => !module.roadAllowed || module.roadAllowed(state, playerId, edge, ctx));
}

/** Lets the profile's modules react to a placed piece (setup included). */
function afterBuild(state: GameState, build: BuildEvent, rng: Rng | null): void {
  const profile = requireProfile(state.profileId);
  const modules = rulesModulesOf(profile);
  if (modules.length === 0) return;
  const ctx = moduleContext(profile, rng);
  for (const module of modules) module.afterBuild?.(state, build, ctx);
}

function modulesAllowBuilding(state: GameState, playerId: string, vertex: number, setup: boolean): boolean {
  const modules = modulesOf(state);
  if (modules.length === 0) return true;
  const ctx = viewContext(state);
  return modules.every((module) => module.allowBuilding?.(state, playerId, vertex, { setup }, ctx) ?? true);
}

/**
 * Whether one of the player's routes reaches the vertex. A settlement may
 * extend any route; `roadsOnly` ignores ships, because a ship hands over to a
 * road only at the player's building (SF25 p. 2).
 */
function touchesOwnRoad(state: GameState, playerId: string, vertex: number, roadsOnly = false): boolean {
  const topo = topologyOf(state);
  return topo.vertices[vertex]!.edges.some((edge) => {
    const road = state.board.roads[edge];
    return !!road && road.player === playerId && !(roadsOnly && road.ship);
  });
}

/**
 * 新道路能否從這個路口接上道路網：自己的建築一定可以；對手的建築會切斷
 * 穿越該路口的延伸；空路口則需要有自己的道路接到這裡。判斷的是路口本身，
 * 不是既有道路的另一端。
 */
function roadCanExtendFrom(state: GameState, playerId: string, vertex: number): boolean {
  const building = state.board.buildings[vertex];
  if (building) return building.player === playerId;
  // A module piece (C&K knight) of another player closes the intersection too.
  const blocker = moduleVertexBlocker(state, vertex);
  if (blocker !== null && blocker !== playerId) return false;
  return touchesOwnRoad(state, playerId, vertex, true);
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
  if (!modulesAllowRoad(state, playerId, edge)) return false;
  if (!isLandEdge(state, edge)) return false;
  if (options.setup) {
    if (options.lastVertex === null || options.lastVertex === undefined) return false;
    return info.vertices.includes(options.lastVertex);
  }
  return info.vertices.some((vertex) => roadCanExtendFrom(state, playerId, vertex));
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
  ensureStats(state).turns += 1;
  // 每輪由第一個座位開始，於此取樣一次分數。
  if (seat === 0) sampleTimeline(state);
  openActorWindow(state, seat, 1, 'preroll');
}

/** 記錄每位玩家當下的分數（含隱藏分），供結算畫面的分數走勢使用。 */
function sampleTimeline(state: GameState): void {
  ensureStats(state).timeline.push(
    state.players.map((player) => scoreOf(state, player.id, { includeHidden: true })),
  );
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
  clearPending(state);
  state.windowId += 1;
  expireOffers(state, 'window');
  playerStats(state, player.id).turns += 1;
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
  const player = currentPlayer(state);
  const score = scoreOf(state, player.id, { includeHidden: true });
  const target = victoryTargetOf(state, player.id);
  if (score >= target) {
    state.result = { playerId: player.id, reason: 'victory', atSeq: state.seq };
    state.turn.phase = 'gameOver';
    clearPending(state);
    expireOffers(state, 'gameOver');
    sampleTimeline(state);
    emit(state, 'game.finished', {
      playerId: player.id,
      reason: 'victory',
      score,
      target,
    });
  }
}

function afterBoardChange(state: GameState): void {
  const modules = modulesOf(state);
  let rules = {
    ...BASE_AWARD_RULES,
    longestRouteIncludesShips: requireProfile(state.profileId).longestRouteIncludesShips,
  };
  if (modules.length === 0) {
    recomputeAwards(state, rules);
    return;
  }
  const ctx = moduleContext(requireProfile(state.profileId), null);
  for (const module of modules) if (module.awardRules) rules = module.awardRules(state, rules, ctx);
  recomputeAwards(state, rules);
  for (const module of modules) module.afterBoardChange?.(state, ctx);
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

/** 舊快照可能要求已耗盡的棋子或銀行資源；投影、提示與執行共用此判定。 */
export function normalizedPending(state: GameState): Pending | null {
  const pending = state.pending;
  if (pending?.kind === 'freeRoads') {
    const capacity = pendingRouteCapacity(state, pending.actor);
    const remaining = Math.max(0, Math.min(pending.remaining, capacity));
    if (remaining <= 0) return null;
    if (remaining === pending.remaining) return pending;
    const placed = (pending.granted ?? 2) - pending.remaining;
    return { ...pending, remaining, granted: placed + remaining };
  }
  if (pending?.kind === 'yearOfPlenty') {
    const available = RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);
    const remaining = Math.max(0, Math.min(pending.remaining, available));
    if (remaining <= 0) return null;
    return remaining === pending.remaining ? pending : { ...pending, remaining };
  }
  return pending;
}

/** Pending grants use the matching card owner: C&K progress cards retain their
 * existing shared capacity, while base/SF/T&B development cards dispatch by
 * the stored Road Building version. */
function pendingRouteCapacity(state: GameState, playerId: string): number {
  if (grantsBothRoads(state.engineVersion)) return roadBuildingGrantCapacity(state, playerId);
  if (modulesOf(state).some((module) => module.id === 'citiesKnights')) return freeRouteCapacity(state, playerId);
  return freeRouteTargetCount(state, playerId);
}

/**
 * The active frame and queue as the next command will see them: a stalled
 * base frame (see `normalizedPending`) drops out and the next queued frame
 * takes its place. Projection and hints share this view.
 */
export function effectivePending(state: GameState): { pending: Pending; queue: readonly PendingFrame[] } {
  const queue = pendingQueueOf(state);
  const pending = normalizedPending(state) ?? null;
  if (pending || !state.pending) return { pending, queue };
  return { pending: queue[0] ?? null, queue: queue.slice(1) };
}

export function applyCommand(
  state: GameState,
  actorId: string,
  command: Command | ModuleCommand,
  rng: Rng,
): CommandOutcome {
  if (!command || typeof command.type !== 'string') return fail('E_INVALID_COMMAND');
  if (!state.players.some((player) => player.id === actorId)) {
    return fail('E_INVALID_COMMAND', { reason: 'unknown-actor' });
  }
  if (state.result) return fail('E_GAME_OVER');
  if (moduleDisabledCommand(state, command.type)) return fail('E_INVALID_COMMAND', { reason: 'not-in-ruleset' });

  const next = clone(state);
  normalizePending(next);
  ensureStats(next);
  const previousPending = next.pending;
  const normalized = normalizedPending(next);
  if (normalized !== previousPending) {
    if (normalized) {
      next.pending = normalized;
    } else {
      if (previousPending?.kind === 'freeRoads') {
        emit(next, 'dev.roadBuildingFinished', {
          playerId: previousPending.actor,
          placed: (previousPending.granted ?? 2) - previousPending.remaining,
        });
      }
      // A stalled base frame ends like an answered one: the next queued frame activates.
      completePending(next, rng);
    }
  }
  if (next.pending && !PENDING_COMMANDS.has(command.type as CommandType) && !modulePendingCommand(next, command.type)) {
    return fail('E_PENDING_EFFECT', { pending: next.pending.kind });
  }
  const veto = moduleVeto(next, actorId, command as ModuleCommand);
  if (veto) return veto;
  const outcome = dispatch(next, actorId, command, rng);
  if (!outcome.ok) return outcome;
  trackPeakHands(next);
  const events = next.log.filter((event) => event.seq > state.seq);
  return { ok: true, state: next, events };
}

/** A module's refusal of a command before dispatch (base profiles: none). */
function moduleVeto(state: GameState, actorId: string, command: ModuleCommand): CommandOutcome | undefined {
  const modules = modulesOf(state);
  if (modules.length === 0) return undefined;
  const ctx = viewContext(state);
  for (const module of modules) {
    const veto = module.vetoCommand?.(state, actorId, command, ctx);
    if (veto) return veto;
  }
  return undefined;
}

function trackPeakHands(state: GameState): void {
  for (const player of state.players) {
    const stats = playerStats(state, player.id);
    stats.peakHand = Math.max(stats.peakHand, totalCards(player));
  }
}

function modulePendingCommand(state: GameState, type: string): boolean {
  return modulesOf(state).some((module) => module.pendingCommands?.includes(type));
}

function moduleDisabledCommand(state: GameState, type: string): boolean {
  return modulesOf(state).some((module) => module.disabledCommands?.includes(type));
}

/** Cities & Knights hands and trades include commodities. */
function hasCommodities(state: GameState): boolean {
  return requireProfile(state.profileId).commodityBankPerType > 0;
}

/** The card kinds a hand, a trade or a discard may use in this game. */
function cardKindsOf(state: GameState): readonly CardKind[] {
  return hasCommodities(state) ? CARD_KINDS : RESOURCES;
}

function isCommodity(card: CardKind): card is Commodity {
  return (COMMODITIES as readonly string[]).includes(card);
}

function cardCount(player: PlayerState, card: CardKind): number {
  return isCommodity(card) ? player.commodities[card] : player.resources[card];
}

/** Moves cards between a hand and the matching supply (negative = to the supply). */
function moveCards(state: GameState, player: PlayerState, card: CardKind, amount: number): void {
  if (isCommodity(card)) {
    player.commodities[card] += amount;
    state.commodityBank[card] -= amount;
  } else {
    player.resources[card] += amount;
    state.bank[card] -= amount;
  }
}

function supplyOf(state: GameState, card: CardKind): number {
  return isCommodity(card) ? state.commodityBank[card] : state.bank[card];
}

function canAffordCards(player: PlayerState, cost: Partial<Record<CardKind, number>>): boolean {
  return CARD_KINDS.every((card) => cardCount(player, card) >= (cost[card] ?? 0));
}

function transferCards(from: PlayerState, to: PlayerState, card: CardKind, amount: number): void {
  if (isCommodity(card)) {
    from.commodities[card] -= amount;
    to.commodities[card] += amount;
  } else {
    from.resources[card] -= amount;
    to.resources[card] += amount;
  }
}

/** True while a module keeps the robber out of play (C&K before the first attack). */
function robberInactive(state: GameState): boolean {
  const modules = modulesOf(state);
  if (modules.length === 0) return false;
  const ctx = viewContext(state);
  return modules.some((module) => module.robberInactive?.(state, ctx) === true);
}

function dispatch(
  state: GameState,
  actorId: string,
  input: Command | ModuleCommand,
  rng: Rng,
): CommandOutcome {
  const command = input as Command;
  switch (command.type) {
    case 'setup.placeBuilding':
      return setupPlaceBuilding(state, actorId, command.vertex, rng);
    case 'setup.placeRoad':
      return setupPlaceRoad(state, actorId, command.edge, rng);
    case 'turn.roll':
      return rollDice(state, actorId, rng);
    case 'turn.end':
      return endTurn(state, actorId, rng);
    case 'build.road':
      return buildRoad(state, actorId, command.edge, rng);
    case 'build.settlement':
      return buildSettlement(state, actorId, command.vertex, rng);
    case 'build.city':
      return buildCity(state, actorId, command.vertex, rng);
    case 'build.devCard':
      return buyDevCard(state, actorId, rng);
    case 'dev.playKnight':
      return playKnight(state, actorId, command.hex, rng);
    case 'dev.playRoadBuilding':
      return playRoadBuilding(state, actorId);
    case 'dev.playYearOfPlenty':
      return playYearOfPlenty(state, actorId);
    case 'dev.playMonopoly':
      return playMonopoly(state, actorId, command.resource);
    case 'pending.discard':
      return submitDiscard(state, actorId, command.resources, rng);
    case 'pending.moveRobber':
      return moveRobber(state, actorId, command.hex, rng);
    case 'pending.steal':
      return stealFrom(state, actorId, command.victim, rng);
    case 'pending.takeResource':
      return takeResource(state, actorId, command.resource, rng);
    case 'trade.bank':
      return bankTrade(state, actorId, command.give, command.receive);
    case 'trade.offer':
      return createOffer(state, actorId, command as OfferCommand);
    case 'trade.respond':
      return respondToOffer(state, actorId, command.offerId, command.response);
    case 'trade.revise':
      return reviseOffer(state, actorId, command as Omit<OfferCommand, 'to'> & { offerId: string });
    case 'trade.withdraw':
      return withdrawOffer(state, actorId, command.offerId);
    case 'trade.settle':
      return settleOffer(state, actorId, command.offerId, command.counterparty);
    default:
      return dispatchModuleCommand(state, actorId, input as ModuleCommand, rng);
  }
}

function dispatchModuleCommand(
  state: GameState,
  actorId: string,
  command: ModuleCommand,
  rng: Rng,
): CommandOutcome {
  const profile = requireProfile(state.profileId);
  for (const module of rulesModulesOf(profile)) {
    const handler = module.commands?.[command.type];
    if (handler) return handler(state, actorId, command, moduleContext(profile, rng, module.id));
  }
  return fail('E_INVALID_COMMAND');
}

function requireTurnActor(state: GameState, actorId: string): CommandOutcome | null {
  if (currentPlayer(state).id !== actorId) return fail('E_NOT_YOUR_TURN');
  return null;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

function setupPlaceBuilding(state: GameState, actorId: string, vertex: number, rng: Rng): CommandOutcome {
  const setup = state.turn.setup;
  if (!setup) return fail('E_WRONG_PHASE');
  if (setup.stage !== 'building') return fail('E_WRONG_PHASE', { stage: setup.stage });
  const seat = setup.order[setup.index];
  if (seat === undefined) return fail('E_WRONG_PHASE');
  if (state.players[seat]!.id !== actorId) return fail('E_NOT_YOUR_TURN');
  if (!canPlaceBuilding(state, actorId, vertex, { setup: true })) {
    return fail('E_ILLEGAL_TARGET', { vertex });
  }
  state.board.buildings[vertex] = { player: actorId, city: setupPlacesCity(state, actorId, setup.round) };
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
    addResources(playerStats(state, actorId).startingResources, gained);
    emit(state, 'setup.startingResources', { playerId: actorId, resources: gained });
  }
  afterBoardChange(state);
  const city = state.board.buildings[vertex]!.city;
  afterBuild(state, { playerId: actorId, piece: city ? 'city' : 'settlement', vertex, setup: true, free: true }, rng);
  return { ok: true, state, events: [] };
}

function setupPlacesCity(state: GameState, playerId: string, round: 1 | 2): boolean {
  const modules = modulesOf(state);
  if (modules.length === 0) return false;
  const ctx = viewContext(state);
  return modules.some((module) => module.setupBuilding?.(state, { playerId, round }, ctx) === 'city');
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

function setupPlaceRoad(state: GameState, actorId: string, edge: number, rng: Rng): CommandOutcome {
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
  afterBuild(state, { playerId: actorId, piece: 'road', edge, setup: true, free: true }, rng);
  finishSetupStep(state);
  return { ok: true, state, events: [] };
}

/** Advances setup after a placement step's road (or a module's ship). */
function finishSetupStep(state: GameState): void {
  const setup = state.turn.setup;
  if (!setup) return;
  setup.index += 1;
  setup.stage = 'building';
  setup.lastVertex = null;
  setup.round = setup.index < state.players.length ? 1 : 2;

  if (setup.index >= setup.order.length) {
    state.turn.setup = null;
    afterBoardChange(state);
    beginTurn(state, setup.order[0]!);
    return;
  }
  state.turn.seat = setup.order[setup.index]!;
  afterBoardChange(state);
}

// ---------------------------------------------------------------------------
// turn
// ---------------------------------------------------------------------------

function rollDice(state: GameState, actorId: string, rng: Rng): CommandOutcome {
  const guard = requireTurnActor(state, actorId);
  if (guard) return guard;
  if (state.turn.phase !== 'preroll') return fail('E_WRONG_PHASE', { phase: state.turn.phase });
  const profile = requireProfile(state.profileId);
  const modules = rulesModulesOf(profile);
  const ctx = moduleContext(profile, rng);
  let roll: RollResult | undefined;
  for (const module of modules) roll ??= module.rollDice?.(state, ctx);
  if (!roll) {
    const first = rng.int(6) + 1;
    const second = rng.int(6) + 1;
    roll = { dice: [first, second], total: first + second };
  }
  const [die1, die2] = roll.dice;
  const total = roll.total;
  state.turn.dice = [die1, die2];
  state.turn.phase = 'action';
  const stats = ensureStats(state);
  stats.dice[total] = (stats.dice[total] ?? 0) + 1;
  const rollerStats = playerStats(state, actorId);
  rollerStats.rolls += 1;
  if (total === 7) rollerStats.sevens += 1;
  emit(state, 'turn.rolled', {
    playerId: actorId,
    dice: [die1, die2],
    total,
    ...(roll.extra ? { extra: roll.extra } : {}),
  });

  runBeforeProduction(state, roll, rng);
  return { ok: true, state, events: [] };
}

/** 續接模組後方的 hooks；frame 的 module 身分讓快照復原後仍能找到順序。 */
function runBeforeProduction(state: GameState, roll: RollResult, rng: Rng | null, start = 0): void {
  const profile = requireProfile(state.profileId);
  const modules = rulesModulesOf(profile);
  for (let index = start; index < modules.length; index++) {
    const module = modules[index]!;
    if (module.beforeProduction?.(state, roll, moduleContext(profile, rng, module.id)) === 'defer') return;
  }
  resolveRollOutcome(state, roll, rng);
}

/** The 7 sequence or production, then the modules' after-production stages. */
function resolveRollOutcome(state: GameState, roll: RollResult, rng: Rng | null): void {
  if (roll.total === 7) resolveSeven(state, rng);
  else resolveProduction(state, roll, rng);
  const profile = requireProfile(state.profileId);
  const modules = rulesModulesOf(profile);
  if (modules.length === 0) return;
  const ctx = moduleContext(profile, rng);
  for (const module of modules) module.afterProduction?.(state, roll, ctx);
}

function resolveProduction(state: GameState, roll: RollResult, rng: Rng | null): void {
  const total = roll.total;
  let results = productionForRoll(state, total);
  const profile = requireProfile(state.profileId);
  for (const module of rulesModulesOf(profile)) {
    if (module.modifyProduction) results = module.modifyProduction(state, results, roll, moduleContext(profile, rng));
  }
  const summary: Record<string, Partial<Record<Resource, number>>> = {};
  const blockedPlayers = new Set<string>();
  for (const result of results) {
    if (!result.resource) continue;
    const resource = result.resource;
    for (const share of result.granted) {
      const player = playerById(state, share.playerId);
      if (!player) continue;
      grant(player, resource, share.amount);
      state.bank[resource] -= share.amount;
      addResource(playerStats(state, share.playerId).produced, resource, share.amount);
      summary[share.playerId] = summary[share.playerId] ?? {};
      summary[share.playerId]![resource] = (summary[share.playerId]![resource] ?? 0) + share.amount;
    }
    for (const share of result.blocked) {
      addResource(playerStats(state, share.playerId).blockedResources, resource, share.amount);
      blockedPlayers.add(share.playerId);
    }
    // 銀行不足：每個建築應得量與實得量的差額
    for (const share of result.entitlements) {
      const paid = result.granted.find((candidate) => candidate.vertex === share.vertex)?.amount ?? 0;
      if (share.amount > paid) {
        addResource(playerStats(state, share.playerId).starvedResources, resource, share.amount - paid);
      }
    }
    if (result.starved) {
      emit(state, 'production.starved', { hex: result.hex, resource: result.resource, total });
    }
  }
  for (const playerId of blockedPlayers) playerStats(state, playerId).blockedRolls += 1;
  emit(state, 'production.resolved', { total, grants: summary });
}

function resolveSeven(state: GameState, rng: Rng | null): void {
  const required: Record<string, number> = {};
  const modules = modulesOf(state);
  const ctx = viewContext(state);
  for (const player of state.players) {
    const hand = totalCards(player);
    let limit = 7;
    for (const module of modules) if (module.discardLimit) limit = module.discardLimit(state, player, limit, ctx);
    if (hand > limit) required[player.id] = Math.floor(hand / 2);
  }
  if (Object.keys(required).length > 0) {
    enqueuePending(state, { kind: 'discard', required, submitted: {} });
    emit(state, 'discard.required', { required });
  } else {
    const replaced = moduleSevenStep(state, rng);
    if (replaced !== undefined) {
      if (replaced) enqueuePending(state, replaced);
      return;
    }
    if (robberInactive(state)) return;
    enqueuePending(state, {
      kind: 'moveRobber',
      actor: currentPlayer(state).id,
      cause: 'seven',
      pirate: false,
    });
    emit(state, 'robber.moveRequired', { playerId: currentPlayer(state).id, cause: 'seven' });
  }
}

/** A module's replacement for the robber step of a 7 (`undefined`: base step). */
function moduleSevenStep(state: GameState, rng: Rng | null): PendingFrame | null | undefined {
  const profile = requireProfile(state.profileId);
  const modules = rulesModulesOf(profile);
  if (modules.length === 0) return undefined;
  const ctx = moduleContext(profile, rng);
  for (const module of modules) {
    const frame = module.sevenRobberStep?.(state, currentPlayer(state).id, ctx);
    if (frame !== undefined) return frame;
  }
  return undefined;
}

function endTurn(state: GameState, actorId: string, rng: Rng): CommandOutcome {
  const guard = requireTurnActor(state, actorId);
  if (guard) return guard;
  if (state.turn.phase !== 'action') return fail('E_WRONG_PHASE', { phase: state.turn.phase });
  if (state.pending) return fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  const profile = requireProfile(state.profileId);
  for (const module of rulesModulesOf(profile)) {
    const veto = module.beforeEndTurn?.(state, actorId, moduleContext(profile, null));
    if (veto) return veto;
  }
  const modules = rulesModulesOf(profile);
  if (modules.length > 0) {
    const ctx = moduleContext(profile, rng);
    for (const module of modules) {
      // An end-of-turn phase owned by a module; it calls `kit.finishTurn`.
      if (module.onEndTurn?.(state, actorId, ctx) === 'defer') return { ok: true, state, events: [] };
    }
  }
  finishTurn(state);
  return { ok: true, state, events: [] };
}

/** Closes the actor's window and opens the next one. */
function finishTurn(state: GameState): void {
  if (state.result) return;
  const profile = requireProfile(state.profileId);
  const actorId = currentPlayer(state).id;
  emit(state, 'turn.ended', { playerId: actorId, pairedActor: state.turn.pairedActor });

  if (profile.paired && state.turn.pairedActor === 1) {
    // Player 2 acts next, without another production roll (§5.5).
    openActorWindow(state, partnerSeat(state, state.turn.seat), 2, 'action');
    return;
  }

  if (profile.paired) {
    // Both markers advance to the next player to their left.
    state.turn.pairIndex += 1;
    beginTurn(state, state.turn.pairIndex % state.players.length);
    return;
  }

  beginTurn(state, (state.turn.seat + 1) % state.players.length);
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

function buildRoad(state: GameState, actorId: string, edge: number, rng: Rng): CommandOutcome {
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
    payBuild(state, player, COSTS.road);
  }
  const stats = playerStats(state, actorId);
  if (free) stats.freeRoadsBuilt += 1;
  else stats.roadsBuilt += 1;
  state.board.roads[edge] = { player: actorId, ship: false };
  emit(state, 'build.road', { playerId: actorId, edge, free: !!free });
  afterBoardChange(state);
  afterBuild(state, { playerId: actorId, piece: 'road', edge, setup: false, free: !!free }, rng);

  if (free) placedFreeRoute(state, actorId, rng);
  checkVictory(state);
  return { ok: true, state, events: [] };
}

/** Books one free Road Building piece and ends the effect when done. */
function placedFreeRoute(state: GameState, actorId: string, rng: Rng | null): void {
  const free = state.pending?.kind === 'freeRoads' && state.pending.actor === actorId ? state.pending : null;
  if (!free) return;
  free.remaining -= 1;
  // As in base-2025.3 the effect ends here only when no target is left; a
  // spent piece supply is capped by `normalizedPending` on the next command.
  if (free.remaining <= 0 || legalRoadEdges(state, actorId).length + moduleFreeRouteTargets(state, actorId) === 0) {
    emit(state, 'dev.roadBuildingFinished', {
      playerId: actorId,
      placed: (free.granted ?? 2) - free.remaining,
    });
    completePending(state, rng);
  }
}

/**
 * Free Road Building placements available now: legal roads capped by the road
 * pieces left (PR #60), plus module pieces such as ships.
 */
function freeRouteTargetCount(state: GameState, playerId: string): number {
  const pieces = requireProfile(state.profileId).pieces.roads - countRoads(state, playerId);
  const roads = Math.max(0, Math.min(legalRoadEdges(state, playerId).length, pieces));
  return roads + moduleFreeRouteTargets(state, playerId);
}

/** Road Building's versioned grant: a legal route grants up to two pieces. */
function roadBuildingGrantCapacity(state: GameState, playerId: string): number {
  if (!grantsBothRoads(state.engineVersion)) return freeRouteTargetCount(state, playerId);
  const pieces = requireProfile(state.profileId).pieces.roads - countRoads(state, playerId);
  const roads = legalRoadEdges(state, playerId).length > 0 ? Math.max(0, pieces) : 0;
  return roads + moduleFreeRouteTargets(state, playerId, { grantAllAvailable: true });
}

/** C&K 授予與快照正規化共用容量；第一條道路可以打開後續地點。 */
function freeRouteCapacity(state: GameState, playerId: string): number {
  const pieces = requireProfile(state.profileId).pieces.roads - countRoads(state, playerId);
  const roads = legalRoadEdges(state, playerId).length > 0 ? Math.max(0, pieces) : 0;
  return roads + moduleFreeRouteTargets(state, playerId);
}

/** Engine versions approved for the Road Building grant introduced by PR #82. */
function grantsBothRoads(engineVersion: string): boolean {
  return ['base-2025.4', 'sf-2025.2', 'tb-2025.2'].includes(engineVersion);
}

/** Free placements the profile's modules offer (ships), supply included. */
function moduleFreeRouteTargets(
  state: GameState,
  playerId: string,
  options?: { grantAllAvailable?: boolean },
): number {
  const modules = modulesOf(state);
  if (modules.length === 0) return 0;
  const ctx = viewContext(state);
  let count = 0;
  for (const module of modules) count += module.freeRouteTargets?.(state, playerId, ctx, options) ?? 0;
  return count;
}

function buildSettlement(state: GameState, actorId: string, vertex: number, rng: Rng): CommandOutcome {
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
  payBuild(state, player, COSTS.settlement).settlementsBuilt += 1;
  state.board.buildings[vertex] = { player: actorId, city: false };
  emit(state, 'build.settlement', { playerId: actorId, vertex });
  afterBoardChange(state);
  afterBuild(state, { playerId: actorId, piece: 'settlement', vertex, setup: false, free: false }, rng);
  checkVictory(state);
  return { ok: true, state, events: [] };
}

function buildCity(state: GameState, actorId: string, vertex: number, rng: Rng): CommandOutcome {
  const guard = requireActionPhase(state, actorId);
  if (guard) return guard;
  const building = state.board.buildings[vertex];
  if (!building || building.player !== actorId || building.city || !modulesAllowCity(state, actorId, vertex)) {
    return fail('E_ILLEGAL_TARGET', { vertex });
  }
  if (!modulesAllowScenarioBuilding(state, actorId, vertex, 'city')) return fail('E_ILLEGAL_TARGET', { vertex });
  const profile = requireProfile(state.profileId);
  if (countBuildings(state, actorId, 'city') >= profile.pieces.cities) {
    return fail('E_NO_PIECES', { piece: 'city' });
  }
  const player = playerById(state, actorId)!;
  if (!canAfford(player, COSTS.city)) {
    return fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.city });
  }
  payBuild(state, player, COSTS.city).citiesBuilt += 1;
  building.city = true;
  emit(state, 'build.city', { playerId: actorId, vertex });
  afterBoardChange(state);
  afterBuild(state, { playerId: actorId, piece: 'city', vertex, setup: false, free: false }, rng);
  checkVictory(state);
  return { ok: true, state, events: [] };
}

function modulesAllowCity(state: GameState, playerId: string, vertex: number): boolean {
  const modules = modulesOf(state);
  if (modules.length === 0) return true;
  const ctx = viewContext(state);
  return modules.every((module) => module.allowCity?.(state, playerId, vertex, ctx) ?? true);
}

function buyDevCard(state: GameState, actorId: string, rng: Rng): CommandOutcome {
  const guard = requireActionPhase(state, actorId);
  if (guard) return guard;
  if (state.devDeck.length === 0) return fail('E_DECK_EMPTY');
  const player = playerById(state, actorId)!;
  if (!canAfford(player, COSTS.devCard)) {
    return fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.devCard });
  }
  const stats = payBuild(state, player, COSTS.devCard);
  const index = rng.int(state.devDeck.length);
  const card = state.devDeck.splice(index, 1)[0]!;
  player.newDevCards.push(card);
  stats.devCardsBought[card] = (stats.devCardsBought[card] ?? 0) + 1;
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

/**
 * 只有先前回合持有的卡（`devCards`）可以打出；本回合新買的同類卡不影響舊卡。
 * 手上只有新買的那張時回報 E_CARD_JUST_BOUGHT。
 */
function heldCardMissing(player: PlayerState, card: DevCardType): CommandOutcome {
  if (player.newDevCards.includes(card)) return fail('E_CARD_JUST_BOUGHT', { card });
  return fail('E_CARD_NOT_HELD', { card });
}

function playKnight(state: GameState, actorId: string, hex: number | null, rng: Rng): CommandOutcome {
  const guard = canPlayDevCard(state, actorId);
  if (guard) return guard;
  const player = playerById(state, actorId)!;
  if (!player.devCards.includes('knight')) return heldCardMissing(player, 'knight');
  const pool = player.devCards;
  const bandit = moduleBanditMove(state, actorId, hex, 'knight', rng);
  if (bandit && !bandit.ok) return bandit.error;
  if (!bandit) {
    const robberCheck = robberTargetError(state, actorId, hex);
    if (robberCheck) return robberCheck;
  }

  const index = pool.indexOf('knight');
  pool.splice(index, 1);
  player.playedKnights += 1;
  state.turn.devCardPlayed = true;
  const stats = playerStats(state, actorId);
  stats.devCardsPlayed.knight += 1;
  stats.robberMoves += 1;
  if (bandit) {
    emit(state, 'dev.knight', { playerId: actorId, hex, playedKnights: player.playedKnights, pirate: true });
    afterBoardChange(state);
    if (bandit.candidates.length > 0 && bandit.hex !== null) {
      enqueuePending(state, { kind: 'steal', actor: actorId, hex: bandit.hex, candidates: bandit.candidates, pirate: true });
    }
    checkVictory(state);
    return { ok: true, state, events: [] };
  }
  state.board.robber = hex as number;
  emit(state, 'dev.knight', { playerId: actorId, hex, playedKnights: player.playedKnights });
  afterBoardChange(state);

  const candidates = stealCandidates(state, hex as number, actorId);
  if (candidates.length > 0) {
    enqueuePending(state, { kind: 'steal', actor: actorId, hex: hex as number, candidates, pirate: false });
  }
  checkVictory(state);
  return { ok: true, state, events: [] };
}

/** Lets a module claim a robber target for another bandit (the pirate). */
function moduleBanditMove(
  state: GameState,
  actorId: string,
  target: number | null,
  cause: 'seven' | 'knight',
  rng: Rng,
): BanditMove | undefined {
  const profile = requireProfile(state.profileId);
  for (const module of rulesModulesOf(profile)) {
    const move = module.moveBandit?.(state, actorId, target, cause, moduleContext(profile, rng));
    if (move) return move;
  }
  return undefined;
}

function stealCandidates(state: GameState, hex: number, actorId: string): string[] {
  const topo = topologyOf(state);
  const out = new Set<string>();
  for (const vertex of verticesOfHex(topo, hex)) {
    const building = state.board.buildings[vertex];
    if (!building || building.player === actorId) continue;
    const player = playerById(state, building.player);
    if (player && totalCards(player) > 0) out.add(building.player);
  }
  let candidates = [...out];
  const modules = modulesOf(state);
  if (modules.length === 0) return candidates;
  const ctx = viewContext(state);
  for (const module of modules) {
    if (module.stealCandidates) candidates = module.stealCandidates(state, hex, actorId, candidates, ctx);
  }
  return candidates;
}

/** Hexes the robber may move to: any other hex, narrowed by the profile's modules. */
export function legalRobberHexes(state: GameState, actorId: string): number[] {
  const topo = topologyOf(state);
  let targets = topo.hexes.map((_, hex) => hex).filter((hex) => hex !== state.board.robber && isLandHex(state, hex));
  const modules = modulesOf(state);
  if (modules.length === 0) return targets;
  const ctx = viewContext(state);
  for (const module of modules) {
    if (module.robberTargets) targets = module.robberTargets(state, actorId, targets, ctx);
  }
  return targets;
}

function robberTargetError(state: GameState, actorId: string, hex: number | null): CommandOutcome | null {
  const topo = topologyOf(state);
  if (typeof hex !== 'number' || !topo.hexes[hex] || !isLandHex(state, hex)) return fail('E_ILLEGAL_TARGET', { hex });
  if (modulesOf(state).length === 0) {
    return hex === state.board.robber ? fail('E_ROBBER_SAME_HEX', { hex }) : null;
  }
  if (legalRobberHexes(state, actorId).includes(hex)) return null;
  return hex === state.board.robber ? fail('E_ROBBER_SAME_HEX', { hex }) : fail('E_ILLEGAL_TARGET', { hex });
}

function playRoadBuilding(state: GameState, actorId: string): CommandOutcome {
  const guard = canPlayDevCard(state, actorId);
  if (guard) return guard;
  const player = playerById(state, actorId)!;
  if (!player.devCards.includes('roadBuilding')) return heldCardMissing(player, 'roadBuilding');
  player.devCards.splice(player.devCards.indexOf('roadBuilding'), 1);
  state.turn.devCardPlayed = true;
  playerStats(state, actorId).devCardsPlayed.roadBuilding += 1;
  emit(state, 'dev.roadBuilding', { playerId: actorId });
  // 新版只要求打出時至少有一條合法道路，之後每次放置再檢查目標。
  const capacity = roadBuildingGrantCapacity(state, actorId);
  const remaining = Math.min(2, capacity);
  if (remaining > 0) {
    enqueuePending(state, { kind: 'freeRoads', actor: actorId, remaining, granted: remaining });
  }
  return { ok: true, state, events: [] };
}

function playYearOfPlenty(state: GameState, actorId: string): CommandOutcome {
  const guard = canPlayDevCard(state, actorId);
  if (guard) return guard;
  const player = playerById(state, actorId)!;
  if (!player.devCards.includes('yearOfPlenty')) return heldCardMissing(player, 'yearOfPlenty');
  // 銀行不足兩張時只給得出現有的張數；完全沒有時不能打出，卡片留在手上。
  const available = RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);
  if (available <= 0) return fail('E_BANK_EMPTY', { card: 'yearOfPlenty' });
  player.devCards.splice(player.devCards.indexOf('yearOfPlenty'), 1);
  state.turn.devCardPlayed = true;
  playerStats(state, actorId).devCardsPlayed.yearOfPlenty += 1;
  enqueuePending(state, { kind: 'yearOfPlenty', actor: actorId, remaining: Math.min(2, available) });
  emit(state, 'dev.yearOfPlenty', { playerId: actorId });
  return { ok: true, state, events: [] };
}

function takeResource(state: GameState, actorId: string, resource: Resource, rng: Rng): CommandOutcome {
  const pending = state.pending;
  if (!pending || pending.kind !== 'yearOfPlenty') return fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' });
  if (pending.actor !== actorId) return fail('E_NOT_ACTOR');
  if (!RESOURCES.includes(resource)) return fail('E_INVALID_SELECTION');
  if (state.bank[resource] <= 0) return fail('E_BANK_EMPTY', { resource });
  grant(playerById(state, actorId)!, resource, 1);
  state.bank[resource] -= 1;
  pending.remaining -= 1;
  addResource(playerStats(state, actorId).yearOfPlenty, resource);
  emit(state, 'dev.yearOfPlentyPick', { playerId: actorId, resource });
  if (pending.remaining <= 0) completePending(state, rng);
  return { ok: true, state, events: [] };
}

function playMonopoly(state: GameState, actorId: string, resource: Resource): CommandOutcome {
  const guard = canPlayDevCard(state, actorId);
  if (guard) return guard;
  if (!RESOURCES.includes(resource)) return fail('E_INVALID_SELECTION');
  const player = playerById(state, actorId)!;
  if (!player.devCards.includes('monopoly')) return heldCardMissing(player, 'monopoly');
  player.devCards.splice(player.devCards.indexOf('monopoly'), 1);
  state.turn.devCardPlayed = true;
  const stats = playerStats(state, actorId);
  stats.devCardsPlayed.monopoly += 1;
  const taken: Record<string, number> = {};
  for (const other of state.players) {
    if (other.id === actorId) continue;
    const amount = other.resources[resource];
    if (amount <= 0) continue;
    other.resources[resource] = 0;
    grant(player, resource, amount);
    taken[other.id] = amount;
    addResource(stats.monopolyGained, resource, amount);
    addResource(playerStats(state, other.id).monopolyLost, resource, amount);
  }
  emit(state, 'dev.monopoly', { playerId: actorId, resource, taken });
  checkVictory(state);
  return { ok: true, state, events: [] };
}

// ---------------------------------------------------------------------------
// pending effects
// ---------------------------------------------------------------------------

function submitDiscard(state: GameState, actorId: string, resources: CardKind[], rng: Rng): CommandOutcome {
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
  const kinds = cardKindsOf(state);
  const counts: Partial<Record<CardKind, number>> = {};
  for (const resource of resources) {
    if (!kinds.includes(resource)) return fail('E_INVALID_SELECTION', { resource });
    counts[resource] = (counts[resource] ?? 0) + 1;
  }
  for (const [resource, amount] of Object.entries(counts) as [CardKind, number][]) {
    if (cardCount(player, resource) < amount) {
      return fail('E_INVALID_SELECTION', { resource, available: cardCount(player, resource) });
    }
  }
  const discardedResources: Partial<Record<Resource, number>> = {};
  for (const [resource, amount] of Object.entries(counts) as [CardKind, number][]) {
    moveCards(state, player, resource, -amount);
    if (!isCommodity(resource)) discardedResources[resource] = amount;
  }
  addResources(playerStats(state, actorId).discarded, discardedResources);
  pending.submitted[actorId] = resources.slice();
  emit(state, 'discard.submitted', { playerId: actorId, count: resources.length });

  const outstanding = Object.keys(pending.required).filter((id) => !pending.submitted[id]);
  if (outstanding.length === 0) {
    if (robberInactive(state)) {
      completePending(state, rng);
      return { ok: true, state, events: [] };
    }
    const roller = currentPlayer(state).id;
    const replaced = moduleSevenStep(state, rng);
    if (replaced === null) {
      completePending(state, rng);
    } else if (replaced) {
      state.pending = replaced;
    } else {
      state.pending = { kind: 'moveRobber', actor: roller, cause: 'seven', pirate: false };
      emit(state, 'robber.moveRequired', { playerId: roller, cause: 'seven' });
    }
  }
  return { ok: true, state, events: [] };
}

function moveRobber(state: GameState, actorId: string, hex: number | null, rng: Rng): CommandOutcome {
  const pending = state.pending;
  if (!pending || pending.kind !== 'moveRobber') {
    return fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' });
  }
  if (pending.actor !== actorId) return fail('E_NOT_ACTOR');
  const bandit = moduleBanditMove(state, actorId, hex, pending.cause, rng);
  if (bandit) {
    if (!bandit.ok) return bandit.error;
    afterBoardChange(state);
    if (bandit.candidates.length > 0 && bandit.hex !== null) {
      state.pending = { kind: 'steal', actor: actorId, hex: bandit.hex, candidates: bandit.candidates, pirate: true };
    } else {
      completePending(state, rng);
    }
    return { ok: true, state, events: [] };
  }
  const robberCheck = robberTargetError(state, actorId, hex);
  if (robberCheck) return robberCheck;
  if (hex === null) return fail('E_ILLEGAL_TARGET', { hex });
  state.board.robber = hex;
  playerStats(state, actorId).robberMoves += 1;
  emit(state, 'robber.moved', { playerId: actorId, hex, cause: pending.cause });
  afterBoardChange(state);

  const candidates = stealCandidates(state, hex, actorId);
  if (candidates.length > 0) {
    state.pending = { kind: 'steal', actor: actorId, hex, candidates, pirate: false };
  } else {
    completePending(state, rng);
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
  // Resources first, then commodities (always none outside C&K), so a base
  // hand draws exactly as before.
  const pool: CardKind[] = [];
  for (const card of CARD_KINDS) {
    for (let i = 0; i < cardCount(victimPlayer, card); i++) pool.push(card);
  }
  if (pool.length === 0) return fail('E_NO_ELIGIBLE_VICTIM', { victim });
  const resource = pool[rng.int(pool.length)]!;
  transferCards(victimPlayer, playerById(state, actorId)!, resource, 1);
  if (!isCommodity(resource)) {
    addResource(playerStats(state, actorId).stolen, resource);
    addResource(playerStats(state, victim).robbed, resource);
  }
  completePending(state, rng);
  emit(
    state,
    'robber.stole',
    pending.pirate ? { playerId: actorId, victim, pirate: true } : { playerId: actorId, victim },
    { to: [actorId, victim], params: { resource } },
  );
  return { ok: true, state, events: [] };
}

// ---------------------------------------------------------------------------
// trading
// ---------------------------------------------------------------------------

function bankTrade(state: GameState, actorId: string, give: CardKind, receive: CardKind): CommandOutcome {
  const guard = requireActionPhase(state, actorId);
  if (guard) return guard;
  const kinds = cardKindsOf(state);
  if (!kinds.includes(give) || !kinds.includes(receive)) return fail('E_INVALID_SELECTION');
  if (give === receive) return fail('E_INVALID_SELECTION', { reason: 'same-resource' });
  if (supplyOf(state, receive) <= 0) return fail('E_BANK_EMPTY', { resource: receive });
  const rate = bankRateFor(state, actorId, give);
  const player = playerById(state, actorId)!;
  if (cardCount(player, give) < rate) {
    return fail('E_INSUFFICIENT_RESOURCES', { resource: give, required: rate });
  }
  moveCards(state, player, give, -rate);
  moveCards(state, player, receive, 1);
  const stats = playerStats(state, actorId);
  stats.bankTrades += 1;
  if (!isCommodity(give)) addResource(stats.bankGiven, give, rate);
  if (!isCommodity(receive)) addResource(stats.bankReceived, receive);
  emit(state, 'trade.bank', { playerId: actorId, give, receive, rate });
  return { ok: true, state, events: [] };
}

/**
 * Supply rate for giving one card kind: the port rate for a resource; a
 * commodity (C&K p. 7) only at 4:1 or a 3:1 port. Modules adjust it last
 * (C&K trade level 3 lowers commodities to 2:1).
 */
function bankRateFor(state: GameState, playerId: string, give: CardKind): number {
  const rates = harborRates(state, playerId);
  let rate = isCommodity(give) ? (ownsGenericHarbor(state, playerId) ? 3 : 4) : rates[give];
  const modules = modulesOf(state);
  if (modules.length === 0) return rate;
  const ctx = viewContext(state);
  for (const module of modules) if (module.bankRate) rate = module.bankRate(state, playerId, give, rate, ctx);
  return rate;
}

function ownsGenericHarbor(state: GameState, playerId: string): boolean {
  const topo = topologyOf(state);
  return state.board.layout.harbors.some((harbor) =>
    harbor.type === 'generic' &&
    (topo.edges[harbor.edge]?.vertices.some((vertex) => state.board.buildings[vertex]?.player === playerId) ?? false));
}

/** Resource bank rates after module adjustments (base: the port rates). */
function bankRatesFor(state: GameState, playerId: string): Record<Resource, number> {
  if (modulesOf(state).length === 0) return harborRates(state, playerId);
  const out = {} as Record<Resource, number>;
  for (const resource of RESOURCES) out[resource] = bankRateFor(state, playerId, resource);
  return out;
}

function normalizeTerms(state: GameState, terms: Partial<Record<CardKind, number>>): Partial<Record<CardKind, number>> {
  const out: Partial<Record<CardKind, number>> = {};
  for (const resource of cardKindsOf(state)) {
    const amount = terms[resource] ?? 0;
    if (amount > 0) out[resource] = amount;
  }
  return out;
}

function termsTotal(terms: Partial<Record<CardKind, number>>): number {
  return CARD_KINDS.reduce((sum, resource) => sum + (terms[resource] ?? 0), 0);
}

interface OfferCommand {
  to: string | 'all';
  give: Partial<Record<CardKind, number>>;
  want: Partial<Record<CardKind, number>>;
  /** Module goods (e.g. gold), only where the profile's modules allow them. */
  giveGoods?: Record<string, number>;
  wantGoods?: Record<string, number>;
}

/** The profile's tradeable goods module, if any. */
function tradeGoodsOf(state: GameState): RulesModule['tradeGoods'] | undefined {
  return modulesOf(state).find((module) => module.tradeGoods)?.tradeGoods;
}

/** Keeps positive whole amounts of goods the profile allows; `null` for an unknown good. */
function normalizeGoods(state: GameState, goods: unknown): Record<string, number> | null {
  if (goods === undefined || goods === null) return {};
  if (typeof goods !== 'object' || Array.isArray(goods)) return null;
  const allowed = tradeGoodsOf(state)?.ids(state) ?? [];
  const out: Record<string, number> = {};
  for (const [good, amount] of Object.entries(goods as Record<string, unknown>)) {
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return null;
    if (amount === 0) continue;
    if (!allowed.includes(good)) return null;
    out[good] = amount;
  }
  return out;
}

function goodsTotal(goods: Record<string, number> | undefined): number {
  return Object.values(goods ?? {}).reduce((sum, amount) => sum + amount, 0);
}

function setOfferGoods(offer: Offer, giveGoods: Record<string, number>, wantGoods: Record<string, number>): void {
  if (goodsTotal(giveGoods) > 0) offer.giveGoods = giveGoods;
  else delete offer.giveGoods;
  if (goodsTotal(wantGoods) > 0) offer.wantGoods = wantGoods;
  else delete offer.wantGoods;
}

/** 公開的 module goods 不可承諾超過持有量；結算時仍須重查，不預留庫存。 */
function requireTradeGoods(state: GameState, playerId: string, terms: Record<string, number> | undefined): CommandOutcome | null {
  if (goodsTotal(terms) === 0) return null;
  const goods = tradeGoodsOf(state);
  if (!goods) return fail('E_INVALID_SELECTION', { reason: 'goods' });
  for (const [good, amount] of Object.entries(terms ?? {})) {
    if (goods.balance(state, playerId, good) < amount) return fail('E_INSUFFICIENT_RESOURCES', { playerId, good });
  }
  return null;
}

function createOffer(
  state: GameState,
  actorId: string,
  command: OfferCommand,
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
  const give = normalizeTerms(state, command.give ?? {});
  const want = normalizeTerms(state, command.want ?? {});
  const giveGoods = normalizeGoods(state, command.giveGoods);
  const wantGoods = normalizeGoods(state, command.wantGoods);
  if (!giveGoods || !wantGoods) return fail('E_INVALID_SELECTION', { reason: 'goods' });
  if (termsTotal(give) + goodsTotal(giveGoods) === 0 || termsTotal(want) + goodsTotal(wantGoods) === 0) {
    return fail('E_INVALID_SELECTION', { reason: 'empty-terms' });
  }
  if (command.to !== 'all') {
    if (command.to === actorId) return fail('E_INVALID_SELECTION', { reason: 'self-offer' });
    if (!playerById(state, command.to)) return fail('E_ILLEGAL_TARGET', { to: command.to });
  }
  const goodsError = requireTradeGoods(state, actorId, giveGoods);
  if (goodsError) return goodsError;
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
  setOfferGoods(offer, giveGoods, wantGoods);
  state.offers.push(offer);
  emit(state, 'trade.offered', {
    offerId: offer.id,
    from: actorId,
    to: offer.to,
    give,
    want,
    ...(offer.giveGoods ? { giveGoods: offer.giveGoods } : {}),
    ...(offer.wantGoods ? { wantGoods: offer.wantGoods } : {}),
  });
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
  if (response === 'consented') {
    const goodsError = requireTradeGoods(state, offer.from, offer.giveGoods) ?? requireTradeGoods(state, actorId, offer.wantGoods);
    if (goodsError) return goodsError;
  }
  offer.responses[actorId] = response;
  emit(state, 'trade.responded', { offerId, playerId: actorId, response });
  return { ok: true, state, events: [] };
}

function reviseOffer(
  state: GameState,
  actorId: string,
  command: Omit<OfferCommand, 'to'> & { offerId: string },
): CommandOutcome {
  const guard = requireOpenWindow(state);
  if (guard) return guard;
  const offer = state.offers.find((candidate) => candidate.id === command.offerId);
  if (!offer) return fail('E_UNKNOWN_OFFER', { offerId: command.offerId });
  if (offer.from !== actorId) return fail('E_NOT_ACTOR');
  if (offer.status !== 'open') return fail('E_OFFER_CLOSED', { status: offer.status });
  const give = normalizeTerms(state, command.give ?? {});
  const want = normalizeTerms(state, command.want ?? {});
  const giveGoods = normalizeGoods(state, command.giveGoods);
  const wantGoods = normalizeGoods(state, command.wantGoods);
  if (!giveGoods || !wantGoods) return fail('E_INVALID_SELECTION', { reason: 'goods' });
  if (termsTotal(give) + goodsTotal(giveGoods) === 0 || termsTotal(want) + goodsTotal(wantGoods) === 0) {
    return fail('E_INVALID_SELECTION', { reason: 'empty-terms' });
  }
  const goodsError = requireTradeGoods(state, actorId, giveGoods);
  if (goodsError) return goodsError;
  offer.give = give;
  offer.want = want;
  setOfferGoods(offer, giveGoods, wantGoods);
  offer.revision += 1;
  offer.responses = {};
  offer.agreedWith = null;
  emit(state, 'trade.revised', {
    offerId: offer.id,
    revision: offer.revision,
    give,
    want,
    ...(offer.giveGoods ? { giveGoods: offer.giveGoods } : {}),
    ...(offer.wantGoods ? { wantGoods: offer.wantGoods } : {}),
  });
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
  if (!canAffordCards(proposer, offer.give)) {
    return fail('E_INSUFFICIENT_RESOURCES', { playerId: proposer.id });
  }
  if (!canAffordCards(partner, offer.want)) {
    return fail('E_INSUFFICIENT_RESOURCES', { playerId: partner.id });
  }
  const goods = offer.giveGoods || offer.wantGoods ? tradeGoodsOf(state) : undefined;
  const goodsError = requireTradeGoods(state, proposer.id, offer.giveGoods) ?? requireTradeGoods(state, partner.id, offer.wantGoods);
  if (goodsError) return goodsError;
  for (const card of CARD_KINDS) {
    const toPartner = offer.give[card] ?? 0;
    const toProposer = offer.want[card] ?? 0;
    if (toPartner > 0) transferCards(proposer, partner, card, toPartner);
    if (toProposer > 0) transferCards(partner, proposer, card, toProposer);
  }
  if (goods) {
    for (const [good, amount] of Object.entries(offer.giveGoods ?? {})) goods.transfer(state, proposer.id, partner.id, good, amount);
    for (const [good, amount] of Object.entries(offer.wantGoods ?? {})) goods.transfer(state, partner.id, proposer.id, good, amount);
  }
  const proposerStats = playerStats(state, proposer.id);
  const partnerStats = playerStats(state, partner.id);
  proposerStats.playerTrades += 1;
  partnerStats.playerTrades += 1;
  const give = resourceTerms(offer.give);
  const want = resourceTerms(offer.want);
  addResources(proposerStats.tradeGiven, give);
  addResources(proposerStats.tradeReceived, want);
  addResources(partnerStats.tradeGiven, want);
  addResources(partnerStats.tradeReceived, give);
  offer.status = 'completed';
  offer.agreedWith = other;
  emit(state, 'trade.completed', {
    offerId,
    revision: offer.revision,
    from: offer.from,
    to: other,
    give: offer.give,
    want: offer.want,
    ...(offer.giveGoods ? { giveGoods: offer.giveGoods } : {}),
    ...(offer.wantGoods ? { wantGoods: offer.wantGoods } : {}),
  });
  checkVictory(state);
  return { ok: true, state, events: [] };
}

/** The resource part of trade terms (statistics count resources only). */
function resourceTerms(terms: Partial<Record<CardKind, number>>): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = {};
  for (const resource of RESOURCES) if (terms[resource]) out[resource] = terms[resource];
  return out;
}

/**
 * Terminal transition for a table that agreed to end an interrupted game.
 *
 * This is a lifecycle transition, not a rule: it produces no winner, cancels
 * outstanding negotiation and rejects every later strategic command (§4.6).
 * `expired` marks a table the operator retention process closed (§4.6).
 */
export function abandonGame(state: GameState, reason: 'abandoned' | 'expired' = 'abandoned'): GameState {
  if (state.result) return state;
  const next = clone(state);
  next.result = { playerId: null, reason, atSeq: next.seq };
  next.turn.phase = 'gameOver';
  clearPending(next);
  expireOffers(next, 'gameOver');
  sampleTimeline(next);
  emit(next, 'game.abandoned', { reason });
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
  /** Module-specific hints, keyed by module id (absent for base games). */
  modules?: Record<string, unknown>;
}

/** Legal-action hints for the acting player's UI. Advisory only. */
export function actionHints(state: GameState, playerId: string): ActionHints {
  const { pending } = effectivePending(state);
  const isTurn = currentPlayer(state).id === playerId;
  const inAction = isTurn && state.turn.phase === 'action' && !pending;
  const freeRoads = pending?.kind === 'freeRoads' && pending.actor === playerId;
  const setup = state.turn.setup;
  const setupIsMine = !!setup && state.players[setup.order[setup.index] ?? -1]?.id === playerId;
  const setupBuilding = setupIsMine && setup!.stage === 'building';
  const setupRoad = setupIsMine && setup!.stage === 'road';
  return {
    canRoll: isTurn && state.turn.phase === 'preroll' && !pending,
    canEndTurn: inAction && !moduleEndTurnVeto(state, playerId),
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
          .filter((vertex) => modulesAllowCity(state, playerId, vertex))
          .filter((vertex) => modulesAllowScenarioBuilding(state, playerId, vertex, 'city'))
      : [],
    bankRates: bankRatesFor(state, playerId),
    pendingKind: pending ? pending.kind : null,
    ...moduleHints(state, playerId),
  };
}

/** Whether a rules module would reject `turn.end` right now (advisory hint only). */
function moduleEndTurnVeto(state: GameState, playerId: string): boolean {
  const profile = requireProfile(state.profileId);
  return rulesModulesOf(profile).some((module) => !!module.beforeEndTurn?.(state, playerId, moduleContext(profile, null)));
}

function moduleHints(state: GameState, playerId: string): { modules?: Record<string, unknown> } {
  const modules = modulesOf(state).filter((module) => module.actionHints);
  if (modules.length === 0) return {};
  const ctx = viewContext(state);
  return { modules: Object.fromEntries(modules.map((module) => [module.id, module.actionHints!(state, playerId, ctx)])) };
}

/** Command types the profile's rules modules handle, for protocol validation. */
export function moduleCommandTypesOf(state: GameState): string[] {
  return moduleCommandTypes(requireProfile(state.profileId));
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
