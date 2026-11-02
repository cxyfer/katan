/**
 * Wire protocol between the browser client and the service.
 *
 * The protocol carries stable ids and canonical values, never localised
 * sentences: every user-facing string is produced by the client from a message
 * id plus typed parameters (§8.7).
 */

import { COMMAND_ERROR_CODES, RULE_EVENT_TYPES } from '@catan/rules';
import type { GameEvent, GameView, Resource } from '@catan/rules';

/**
 * Stable message ids a client must be able to render. Both lists come from the
 * rules package, so a new event or rejection cannot ship without a translation
 * key being required.
 */
export const ERROR_MESSAGE_IDS: readonly string[] = COMMAND_ERROR_CODES.map((code) => `error.${code}`);
export const EVENT_MESSAGE_IDS: readonly string[] = RULE_EVENT_TYPES.map((type) => `event.${type}`);

/**
 * Rejections authored by the service rather than the rules engine: room
 * lifecycle, admission, policy, chat, storage and transport failures. A server
 * test keeps this list exactly in step with the literals in `packages/server`.
 */
export const SERVER_ERROR_IDS: readonly string[] = [
  'error.E_ABANDON_DISABLED',
  'error.E_BAD_REQUEST',
  'error.E_BODY_TOO_LARGE',
  'error.E_BOTS_DISABLED',
  'error.E_CAPACITY_BELOW_SEATED',
  'error.E_CHAT_INVALID',
  'error.E_CHAT_RATE_LIMITED',
  'error.E_CHAT_TOO_LONG',
  'error.E_COLOR_TAKEN',
  'error.E_COMMAND_ID_REUSED',
  'error.E_GAME_NOT_FOUND',
  'error.E_GAME_SUSPENDED',
  'error.E_INTERNAL',
  'error.E_INVALID_BOT',
  'error.E_INVALID_COLOR',
  'error.E_INVALID_JSON',
  'error.E_INVALID_NICKNAME',
  'error.E_INVALID_POLICY',
  'error.E_INVALID_VISIBILITY',
  'error.E_MISSING_FIELD',
  'error.E_NOT_A_BOT',
  'error.E_NOT_A_MEMBER',
  'error.E_NOT_FOUND',
  'error.E_NOT_HOST',
  'error.E_NOT_SEATED',
  'error.E_NO_ABSENT_PLAYER',
  'error.E_NO_PROPOSAL',
  'error.E_NO_SESSION',
  'error.E_ROOM_CAPACITY',
  'error.E_ROOM_FULL',
  'error.E_ROOM_NOT_FOUND',
  'error.E_ROOM_STARTED',
  'error.E_SAVE_FAILED',
  'error.E_STALE_REVISION',
  'error.E_START_BLOCKED',
  'error.E_UNSUPPORTED',
  'error.E_UNSUPPORTED_COMBINATION',
];

/** Lobby notices explaining why a game cannot start yet. */
export const ROOM_NOTICE_IDS: readonly string[] = [
  'blocker.seats',
  'blocker.notReady',
  'blocker.disconnected',
  'blocker.noHost',
  'blocker.profilePlayerCount',
  'blocker.capacity',
];

/**
 * Every message id a client can be asked to render. A client that ships a
 * catalog missing one of these would show a raw internal key to a player, so
 * both locales must cover this set (§8.7).
 */
export const REQUIRED_MESSAGE_IDS: readonly string[] = [
  ...new Set([
    ...ERROR_MESSAGE_IDS,
    ...EVENT_MESSAGE_IDS,
    ...SERVER_ERROR_IDS,
    ...ROOM_NOTICE_IDS,
  ]),
];

export { COMMAND_ERROR_CODES, RULE_EVENT_TYPES };

export type Visibility = 'private' | 'public';
export type RoomStatus = 'lobby' | 'playing' | 'suspended' | 'completed' | 'abandoned';
export type Locale = 'zh-Hant' | 'en';
export const LOCALES: readonly Locale[] = ['zh-Hant', 'en'];

export interface PlayerIdentity {
  id: string;
  nickname: string;
  locale: Locale;
  createdAt: string;
}

export interface RoomPolicy {
  /** Advisory turn clock in seconds; 0 disables it. */
  turnClockSeconds: number;
  /** Disconnect grace period in seconds. */
  disconnectGraceSeconds: number;
  /** Whether the table may end an interrupted game without a winner. */
  allowAbandonment: boolean;
  /** Host succession is always enabled; kept explicit for the UI summary. */
  hostSuccession: 'automatic';
}

export const DEFAULT_POLICY: RoomPolicy = {
  turnClockSeconds: 0,
  disconnectGraceSeconds: 300,
  allowAbandonment: true,
  hostSuccession: 'automatic',
};

export interface PolicyBounds {
  turnClockSeconds: { min: number; max: number };
  disconnectGraceSeconds: { min: number; max: number };
}

export const POLICY_BOUNDS: PolicyBounds = {
  turnClockSeconds: { min: 0, max: 3600 },
  disconnectGraceSeconds: { min: 30, max: 3600 },
};

/**
 * Computer-opponent difficulty (SPEC §4.9). Difficulty changes strategy
 * quality only, never what the bot may see.
 */
export type BotLevel = 'easy' | 'standard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'standard'];

export interface RoomMemberView {
  playerId: string;
  nickname: string;
  seat: number;
  color: string;
  /** Always true for a bot seat. */
  ready: boolean;
  /** Always true for a bot seat. */
  connected: boolean;
  host: boolean;
  joinedAt: string;
  /** True when the seat is played by the built-in strategy. */
  bot: boolean;
  /** Present for bot seats only. */
  botLevel?: BotLevel;
  /** True when the member is the viewer (control decisions). */
  self?: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  visibility: Visibility;
  status: RoomStatus;
  hostId: string;
  profileId: string;
  setupMode: 'fixed' | 'variable';
  capacity: number;
  policy: RoomPolicy;
  policyRevision: number;
  members: RoomMemberView[];
  gameId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Viewer-specific start blockers, as message ids with parameters. */
  startBlockers: Notice[];
  pendingPolicy: PolicyProposalView | null;
}

export interface PolicyProposalView {
  id: string;
  baseRevision: number;
  before: RoomPolicy;
  after: RoomPolicy;
  proposedBy: string;
  consents: string[];
  createdAt: string;
}

export interface RoomSummaryView {
  id: string;
  code: string | null;
  visibility: Visibility;
  status: RoomStatus;
  profileId: string;
  playerCount: number;
  /** Seats of `playerCount` that are bots. */
  botCount: number;
  capacity: number;
  openSeats: number;
  createdAt: string;
}

export interface ProfileView {
  id: string;
  labelKey: string;
  playerCounts: number[];
  paired: boolean;
  modules: { seafarers: boolean; citiesKnights: boolean };
  scenario: string | null;
  victoryTarget: number;
  setupModes: ('fixed' | 'variable')[];
  enabled: boolean;
  unavailableReasonKey?: string;
}

/** A localisable notice: message id plus canonical parameters. */
export interface Notice {
  messageId: string;
  params?: Record<string, unknown>;
}

export interface CommandRequest {
  commandId: string;
  expectedRevision: number;
  command: { type: string } & Record<string, unknown>;
}

export interface CommandReceipt {
  commandId: string;
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: Notice;
  events: GameEvent[];
}

export interface GameSnapshot {
  gameId: string;
  roomId: string;
  revision: number;
  view: GameView;
}

export interface ChatMessageView {
  id: string;
  seq: number;
  playerId: string;
  nickname: string;
  seat: number;
  color: string;
  text: string;
  createdAt: string;
  kind: 'player' | 'system';
  /** Client send id echoed back for deduplication. */
  clientMessageId?: string;
}

export interface ChatPage {
  messages: ChatMessageView[];
  nextSeq: number;
  hasMore: boolean;
}

export interface SaveReceipt {
  requestId: string;
  gameId: string;
  revision: number;
  savedAt: string;
  outcome: 'saved' | 'failed';
  error?: Notice;
}

export interface ResumableGameView {
  gameId: string;
  roomId: string;
  roomCode: string;
  profileId: string;
  status: RoomStatus;
  players: { playerId: string; nickname: string; color: string; bot?: boolean }[];
  lastSavedAt: string;
  revision: number;
  allSeatsNeeded: boolean;
}

// ---------------------------------------------------------------------------
// WebSocket envelopes
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'hello'; payload: { playerId: string; locale: Locale } }
  | { type: 'room'; payload: RoomView }
  | { type: 'snapshot'; payload: GameSnapshot }
  | { type: 'events'; payload: { gameId: string; revision: number; events: GameEvent[] } }
  | { type: 'chat'; payload: ChatMessageView }
  | { type: 'presence'; payload: { roomId: string; members: RoomMemberView[] } }
  | { type: 'notice'; payload: Notice }
  | { type: 'error'; payload: Notice & { code: string } }
  | { type: 'pong'; payload: { at: string } };

export type ClientMessage =
  | { type: 'ping' }
  | { type: 'subscribe'; payload: { roomId?: string; gameId?: string } }
  | { type: 'command'; payload: { gameId: string } & CommandRequest }
  | { type: 'chat'; payload: { roomId: string; clientMessageId: string; text: string } };

export interface ApiError {
  code: string;
  messageId: string;
  params?: Record<string, unknown>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface ServerConfigView {
  locales: Locale[];
  policyBounds: PolicyBounds;
  defaultPolicy: RoomPolicy;
  limits: {
    nicknameMaxLength: number;
    chatMaxLength: number;
    chatRatePerMinute: number;
    roomCapacityMax: number;
  };
  /** Whether hosts may add computer opponents, and the levels offered. */
  bots: { enabled: boolean; levels: BotLevel[] };
}

export type { GameEvent, GameView, Resource };
