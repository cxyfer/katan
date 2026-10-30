import type { GameStats } from './stats.ts';

/**
 * Authoritative game-state types. Everything here must be JSON-serialisable:
 * snapshots are persisted verbatim and replayed through the rules engine.
 */

export type Resource = 'lumber' | 'brick' | 'wool' | 'grain' | 'ore';
export const RESOURCES: readonly Resource[] = ['lumber', 'brick', 'wool', 'grain', 'ore'];

export type Commodity = 'paper' | 'cloth' | 'coin';
export const COMMODITIES: readonly Commodity[] = ['paper', 'cloth', 'coin'];

export type Terrain =
  | 'forest'
  | 'hills'
  | 'pasture'
  | 'fields'
  | 'mountains'
  | 'desert'
  | 'gold'
  | 'sea';

export const TERRAIN_RESOURCE: Partial<Record<Terrain, Resource>> = {
  forest: 'lumber',
  hills: 'brick',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
};

export const TERRAIN_COMMODITY: Partial<Record<Terrain, Commodity>> = {
  forest: 'paper',
  pasture: 'cloth',
  mountains: 'coin',
};

export type HarborType = 'generic' | Resource;

export type PlayerColor = 'red' | 'blue' | 'orange' | 'white' | 'green' | 'brown';
export const PLAYER_COLORS: readonly PlayerColor[] = [
  'red',
  'blue',
  'orange',
  'white',
  'green',
  'brown',
];

export type DevCardType = 'knight' | 'victoryPoint' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';

export type ProgressCardType =
  | 'alchemist'
  | 'crane'
  | 'engineer'
  | 'irrigation'
  | 'mining'
  | 'roadBuilding'
  | 'smith'
  | 'tradeMonopoly'
  | 'commercialHarbor'
  | 'masterMerchant'
  | 'merchantFleet'
  | 'resourceMonopoly'
  | 'bishop'
  | 'constitution'
  | 'deserter'
  | 'diplomat'
  | 'intrigue'
  | 'saboteur'
  | 'spy'
  | 'warlord'
  | 'wedding'
  | 'medicine'
  | 'printing'
  | 'science';

export interface Harbor {
  edge: number;
  type: HarborType;
}

export interface BoardLayout {
  topologyId: string;
  /** Terrain per hex index. */
  terrain: Terrain[];
  /** Production number per hex index (`null` for desert/sea). */
  numbers: (number | null)[];
  harbors: Harbor[];
  /** Island id per hex index (Seafarers). */
  islands: number[];
  /** Hex index of the robber at setup. */
  robber: number;
  /** Hex index of the pirate, when the profile has one. */
  pirate: number | null;
}

export interface BuildingRef {
  player: string;
  city: boolean;
}

export interface RoadRef {
  player: string;
  ship: boolean;
}

export interface BoardState {
  layout: BoardLayout;
  robber: number;
  pirate: number | null;
  /** Indexed by topology vertex index. */
  buildings: (BuildingRef | null)[];
  /** Indexed by topology edge index. */
  roads: (RoadRef | null)[];
}

export interface PlayerState {
  id: string;
  nickname: string;
  seat: number;
  color: PlayerColor;
  resources: Record<Resource, number>;
  commodities: Record<Commodity, number>;
  /** Development/progress cards bought on an earlier turn. */
  devCards: DevCardType[];
  /** Cards bought during the current turn (not playable yet). */
  newDevCards: DevCardType[];
  progressCards: ProgressCardType[];
  newProgressCards: ProgressCardType[];
  playedKnights: number;
  /** Metropolis level per city-improvement track, 0..3 (Cities & Knights). */
  improvements: Record<'trade' | 'politics' | 'science', number>;
  cityWalls: number;
  defenders: number;
  /** VP tokens from expansion effects that are public. */
  bonusPoints: number;
  /** VP tokens that stay hidden until the end (e.g. C&K progress VP). */
  hiddenBonusPoints: number;
  /** Longest-road length last computed for this player (public). */
  longestRoadLength: number;
}

export type Phase = 'setup' | 'preroll' | 'action' | 'gameOver';

export interface SetupState {
  /** Seat indices in placement order: forward round then reverse round. */
  order: number[];
  index: number;
  stage: 'building' | 'road';
  round: 1 | 2;
  /** Vertex of the building placed in the current setup step. */
  lastVertex: number | null;
}

export interface TurnState {
  /** Seat index of the player whose action window is open. */
  seat: number;
  phase: Phase;
  dice: [number, number] | null;
  devCardPlayed: boolean;
  setup: SetupState | null;
  /** Set when the current 5-6 player pair is on its second actor. */
  pairedActor: 1 | 2;
  /** Index of the current Player 1 / Player 2 pair (paired profiles only). */
  pairIndex: number;
}

export interface DiscardPending {
  kind: 'discard';
  required: Record<string, number>;
  submitted: Record<string, Resource[]>;
}

export interface MoveRobberPending {
  kind: 'moveRobber';
  actor: string;
  cause: 'seven' | 'knight';
  /** When true the pirate is moved instead of the robber (Seafarers). */
  pirate: boolean;
}

export interface StealPending {
  kind: 'steal';
  actor: string;
  hex: number;
  candidates: string[];
  pirate: boolean;
}

export interface YearOfPlentyPending {
  kind: 'yearOfPlenty';
  actor: string;
  remaining: number;
}

export interface FreeRoadsPending {
  kind: 'freeRoads';
  actor: string;
  remaining: number;
}

export type Pending =
  | DiscardPending
  | MoveRobberPending
  | StealPending
  | YearOfPlentyPending
  | FreeRoadsPending
  | null;

export type OfferStatus = 'open' | 'agreed' | 'completed' | 'withdrawn' | 'expired';
export type OfferResponse = 'declined' | 'interested' | 'consented';

export interface Offer {
  id: string;
  revision: number;
  from: string;
  to: string | 'all';
  /** Resources the proposer gives, from the proposer's perspective. */
  give: Partial<Record<Resource, number>>;
  /** Resources the proposer receives. */
  want: Partial<Record<Resource, number>>;
  windowId: number;
  status: OfferStatus;
  responses: Record<string, OfferResponse>;
  agreedWith: string | null;
  createdSeq: number;
}

export interface GameEvent {
  seq: number;
  /** Stable message id for i18n; parameters are canonical values. */
  type: string;
  params: Record<string, unknown>;
  /**
   * Parameters only the listed players may receive (e.g. a stolen card's
   * identity is visible to the thief and the victim, nobody else).
   */
  private?: { to: string[]; params: Record<string, unknown> };
}

export interface GameResult {
  playerId: string | null;
  reason: 'victory' | 'abandoned';
  atSeq: number;
}

export interface Awards {
  longestRoad: string | null;
  largestArmy: string | null;
}

export interface GameState {
  engineVersion: string;
  profileId: string;
  seedCommitment: string | null;
  players: PlayerState[];
  awards: Awards;
  board: BoardState;
  bank: Record<Resource, number>;
  commodityBank: Record<Commodity, number>;
  devDeck: DevCardType[];
  progressDecks: Record<'trade' | 'politics' | 'science', ProgressCardType[]>;
  turn: TurnState;
  pending: Pending;
  offers: Offer[];
  /** Monotonic action-window counter; offers expire when it changes. */
  windowId: number;
  seq: number;
  result: GameResult | null;
  /** Public log kept inside the snapshot for deterministic recovery. */
  log: GameEvent[];
  /**
   * Post-game statistics. Absent from snapshots written before statistics
   * existed; the engine then initialises them on the next transition.
   */
  stats?: GameStats;
}

/**
 * Every rejection the engine can actually produce. This array is the single
 * source of truth: the union type is derived from it so clients can assert
 * that their localisation catalogs cover all of them. A test keeps it exactly
 * in step with the `fail(...)` calls in `engine.ts`.
 */
export const COMMAND_ERROR_CODES = [
  'E_NOT_YOUR_TURN',
  'E_NOT_ACTOR',
  'E_WRONG_PHASE',
  'E_PENDING_EFFECT',
  'E_NO_PIECES',
  'E_INSUFFICIENT_RESOURCES',
  'E_BANK_EMPTY',
  'E_DECK_EMPTY',
  'E_ILLEGAL_TARGET',
  'E_CARD_NOT_HELD',
  'E_CARD_JUST_BOUGHT',
  'E_CARD_ALREADY_PLAYED',
  'E_PAIRED_NO_DOMESTIC_TRADE',
  'E_NO_ELIGIBLE_VICTIM',
  'E_ROBBER_SAME_HEX',
  'E_INVALID_DISCARD_COUNT',
  'E_INVALID_SELECTION',
  'E_UNKNOWN_OFFER',
  'E_OFFER_CLOSED',
  'E_NOT_RECIPIENT',
  'E_NOT_CONSENTED',
  'E_GAME_OVER',
  'E_INVALID_COMMAND',
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/**
 * Every event the engine emits. Kept in step with `emit(...)` by a test that
 * scans the engine source, so a new event cannot ship without a message id.
 */
export const RULE_EVENT_TYPES = [
  'game.created',
  'game.finished',
  'game.abandoned',
  'setup.building',
  'setup.road',
  'setup.startingResources',
  'turn.started',
  'turn.ended',
  'turn.rolled',
  'production.resolved',
  'production.starved',
  'discard.required',
  'discard.submitted',
  'robber.moveRequired',
  'robber.moved',
  'robber.stole',
  'build.road',
  'build.settlement',
  'build.city',
  'build.devCard',
  'dev.knight',
  'dev.roadBuilding',
  'dev.roadBuildingFinished',
  'dev.yearOfPlenty',
  'dev.yearOfPlentyPick',
  'dev.monopoly',
  'trade.offered',
  'trade.responded',
  'trade.revised',
  'trade.withdrawn',
  'trade.expired',
  'trade.bank',
  'trade.completed',
] as const;

export type RuleEventType = (typeof RULE_EVENT_TYPES)[number];

export interface CommandError {
  code: CommandErrorCode;
  params?: Record<string, unknown>;
}

export type CommandOutcome =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: CommandError };
