/**
 * Wire protocol between the browser client and the service.
 *
 * The protocol carries stable ids and canonical values, never localised
 * sentences: every user-facing string is produced by the client from a message
 * id plus typed parameters (§8.7).
 */

import type { GameEvent, GameView, Resource } from '@catan/rules';

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

export interface RoomMemberView {
  playerId: string;
  nickname: string;
  seat: number;
  color: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
  joinedAt: string;
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
  players: { playerId: string; nickname: string; color: string }[];
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
}

export type { GameEvent, GameView, Resource };
