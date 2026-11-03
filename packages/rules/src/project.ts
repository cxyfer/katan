/**
 * Per-player projections (§8.3 information visibility).
 *
 * A projection is the only game state a client ever receives. Hidden values
 * (other players' resource identities, unrevealed development cards, deck
 * order) are never serialised into another player's payload.
 */

import { scoreOf, topologyOf, totalCards } from './analysis.ts';
import { effectivePending } from './engine.ts';
import { rulesModulesOf } from './modules/registry.ts';
import type { PublicModulePendingView } from './modules/types.ts';
import { requireProfile, type ProfileDefinition } from './profiles.ts';
import { cloneGameStats, type GameStats } from './stats.ts';
import type { GameEvent, GameState, PendingFrame, PlayerState, Resource, Offer } from './types.ts';
import { RESOURCES } from './types.ts';

export interface PublicPlayerView {
  id: string;
  nickname: string;
  seat: number;
  color: string;
  handSize: number;
  devCardCount: number;
  newDevCardCount: number;
  playedKnights: number;
  publicScore: number;
  longestRoadLength: number;
  bonusPoints: number;
  cityWalls: number;
  defenders: number;
  improvements: Record<string, number>;
  /** Only for the viewing player. */
  resources?: Record<Resource, number>;
  commodities?: Record<string, number>;
  devCards?: string[];
  newDevCards?: string[];
  progressCards?: string[];
  newProgressCards?: string[];
  /** Own total score including hidden cards. */
  ownScore?: number;
}

export interface PublicBoardView {
  topologyId: string;
  terrain: string[];
  numbers: (number | null)[];
  harbors: { edge: number; type: string }[];
  islands: number[];
  robber: number;
  pirate: number | null;
  buildings: ({ player: string; city: boolean } | null)[];
  roads: ({ player: string; ship: boolean } | null)[];
}

export interface ActionHintsView {
  canRoll: boolean;
  canEndTurn: boolean;
  legalRoads: number[];
  legalSettlements: number[];
  legalCities: number[];
  bankRates: Record<Resource, number>;
  pendingKind: string | null;
  modules?: Record<string, unknown>;
}

export interface GameView {
  engineVersion: string;
  profileId: string;
  victoryTarget: number;
  players: PublicPlayerView[];
  board: PublicBoardView;
  bank: Record<Resource, number>;
  devDeckSize: number;
  turn: {
    seat: number;
    playerId: string;
    phase: string;
    dice: [number, number] | null;
    devCardPlayed: boolean;
    setup: { seat: number; stage: 'building' | 'road'; round: 1 | 2; remaining: number } | null;
    pairedActor: 1 | 2;
  };
  /** The active mandatory choice. */
  pending: PublicPendingView;
  /** Choices queued behind `pending`, in resolution order (public parts only). */
  pendingQueue: NonNullable<PublicPendingView>[];
  offers: Offer[];
  windowId: number;
  seq: number;
  result: { playerId: string | null; reason: string; score?: number } | null;
  awards: { longestRoad: string | null; largestArmy: string | null };
  events: GameEvent[];
  hints?: ActionHintsView;
  /** Viewer-filtered rules-module state keyed by module id (absent for base games). */
  modules?: Record<string, unknown>;
  /**
   * Post-game statistics. Only present once the game has a result: several
   * counters (drawn card types, stolen resources, hidden points) would leak
   * hidden information while the game is still running.
   */
  stats?: GameStats;
}

export type PublicPendingView =
  | { kind: 'discard'; required: Record<string, number>; waitingFor: string[] }
  | { kind: 'moveRobber'; actor: string; cause: string }
  | { kind: 'steal'; actor: string; hex: number; candidates: string[] }
  | { kind: 'yearOfPlenty'; actor: string; remaining: number }
  | { kind: 'freeRoads'; actor: string; remaining: number }
  | PublicModulePendingView
  | null;

export interface ProjectionOptions {
  /** Include recent public log entries. */
  events?: GameEvent[];
  /** Include advisory action hints for this viewer. */
  hints?: ActionHintsView;
}

function publicPlayerView(
  state: GameState,
  player: PlayerState,
  viewerId: string,
): PublicPlayerView {
  const isSelf = player.id === viewerId;
  const view: PublicPlayerView = {
    id: player.id,
    nickname: player.nickname,
    seat: player.seat,
    color: player.color,
    handSize: totalCards(player),
    devCardCount: player.devCards.length,
    newDevCardCount: player.newDevCards.length,
    playedKnights: player.playedKnights,
    publicScore: scoreOf(state, player.id, { includeHidden: false }),
    longestRoadLength: player.longestRoadLength,
    bonusPoints: player.bonusPoints,
    cityWalls: player.cityWalls,
    defenders: player.defenders,
    improvements: { ...player.improvements },
  };
  if (isSelf) {
    view.resources = { ...player.resources };
    view.commodities = { ...player.commodities };
    view.devCards = player.devCards.slice();
    view.newDevCards = player.newDevCards.slice();
    view.progressCards = player.progressCards.slice();
    view.newProgressCards = player.newProgressCards.slice();
    view.ownScore = scoreOf(state, player.id, { includeHidden: true });
  }
  return view;
}

function publicPending(
  state: GameState,
  pending: PendingFrame | null,
  viewerId: string,
  profile: ProfileDefinition,
): PublicPendingView {
  if (!pending) return null;
  switch (pending.kind) {
    case 'discard':
      return {
        kind: 'discard',
        required: { ...pending.required },
        waitingFor: Object.keys(pending.required).filter((id) => !pending.submitted[id]),
      };
    case 'moveRobber':
      return { kind: 'moveRobber', actor: pending.actor, cause: pending.cause };
    case 'steal':
      return { kind: 'steal', actor: pending.actor, hex: pending.hex, candidates: pending.candidates.slice() };
    case 'yearOfPlenty':
      return { kind: 'yearOfPlenty', actor: pending.actor, remaining: pending.remaining };
    case 'freeRoads':
      return { kind: 'freeRoads', actor: pending.actor, remaining: pending.remaining };
    default: {
      // Module data is server-only unless the owning module projects it.
      const module = rulesModulesOf(profile).find((candidate) => candidate.id === pending.module);
      if (module?.projectPending) return module.projectPending(state, pending, viewerId, { profile });
      return { kind: pending.kind, module: pending.module, responders: pending.responders.slice(), data: {} };
    }
  }
}

function moduleProjections(state: GameState, viewerId: string, profile: ProfileDefinition): Record<string, unknown> | null {
  const modules = rulesModulesOf(profile).filter((module) => module.project);
  if (modules.length === 0) return null;
  return Object.fromEntries(modules.map((module) => [module.id, module.project!(state, viewerId, { profile })]));
}

/**
 * Filters an event for a viewer: public parameters always pass, private
 * parameters only reach the listed players.
 */
export function projectEvent(event: GameEvent, viewerId: string): GameEvent {
  if (!event.private) return { seq: event.seq, type: event.type, params: event.params };
  const allowed = event.private.to.includes(viewerId);
  const params = allowed
    ? { ...event.params, ...event.private.params }
    : { ...event.params };
  return { seq: event.seq, type: event.type, params };
}

export function projectGame(
  state: GameState,
  viewerId: string,
  options: ProjectionOptions = {},
): GameView {
  const profile = requireProfile(state.profileId);
  const pending = effectivePending(state);
  const viewer = state.players.find((player) => player.id === viewerId);
  const setup = state.turn.setup;
  const result = state.result
    ? {
        playerId: state.result.playerId,
        reason: state.result.reason,
        score:
          state.result.playerId !== null
            ? scoreOf(state, state.result.playerId, { includeHidden: true })
            : undefined,
      }
    : null;

  const view: GameView = {
    engineVersion: state.engineVersion,
    profileId: state.profileId,
    victoryTarget: profile.victoryTarget,
    players: state.players.map((player) => publicPlayerView(state, player, viewerId)),
    board: {
      topologyId: state.board.layout.topologyId,
      terrain: state.board.layout.terrain.slice(),
      numbers: state.board.layout.numbers.slice(),
      harbors: state.board.layout.harbors.map((harbor) => ({ edge: harbor.edge, type: harbor.type })),
      islands: state.board.layout.islands.slice(),
      robber: state.board.robber,
      pirate: state.board.pirate,
      buildings: state.board.buildings.map((building) =>
        building ? { player: building.player, city: building.city } : null,
      ),
      roads: state.board.roads.map((road) => (road ? { player: road.player, ship: road.ship } : null)),
    },
    bank: { ...state.bank },
    devDeckSize: state.devDeck.length,
    turn: {
      seat: state.turn.seat,
      playerId: state.players[state.turn.seat]!.id,
      phase: state.turn.phase,
      dice: state.turn.dice ? [state.turn.dice[0], state.turn.dice[1]] : null,
      devCardPlayed: state.turn.devCardPlayed,
      setup: setup
        ? {
            seat: setup.order[setup.index] ?? -1,
            stage: setup.stage,
            round: setup.round,
            remaining: setup.order.length - setup.index,
          }
        : null,
      pairedActor: state.turn.pairedActor,
    },
    pending: publicPending(state, pending.pending, viewerId, profile),
    pendingQueue: pending.queue.map((frame) => publicPending(state, frame, viewerId, profile)!),
    offers: state.offers.map((offer) => ({ ...offer, responses: { ...offer.responses } })),
    windowId: state.windowId,
    seq: state.seq,
    result,
    awards: { ...state.awards },
    events: (options.events ?? []).map((event) => projectEvent(event, viewerId)),
  };
  if (options.hints && viewer) view.hints = options.hints;
  const modules = moduleProjections(state, viewerId, profile);
  if (modules) view.modules = modules;
  if (state.result && state.stats) view.stats = cloneGameStats(state.stats);
  return view;
}

/** Room-discovery metadata only; never includes seated-player state (§8.3). */
export function projectRoomSummary(room: {
  id: string;
  code: string;
  visibility: 'private' | 'public';
  status: string;
  hostId: string;
  profileId: string;
  playerCount: number;
  capacity: number;
  createdAt: string;
}): Record<string, unknown> {
  return {
    id: room.id,
    code: room.visibility === 'public' ? room.code : undefined,
    visibility: room.visibility,
    status: room.status,
    profileId: room.profileId,
    playerCount: room.playerCount,
    capacity: room.capacity,
    openSeats: Math.max(0, room.capacity - room.playerCount),
    createdAt: room.createdAt,
  };
}

export function resourceList(player: PlayerState): Resource[] {
  const out: Resource[] = [];
  for (const resource of RESOURCES) {
    for (let i = 0; i < player.resources[resource]; i++) out.push(resource);
  }
  return out;
}

export { topologyOf };
