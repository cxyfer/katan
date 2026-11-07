/**
 * Wire protocol between the browser client and the service.
 *
 * The protocol carries stable ids and canonical values, never localised
 * sentences: every user-facing string is produced by the client from a message
 * id plus typed parameters (§8.7).
 */

import {
  BOX_IDS,
  COMMAND_ERROR_CODES,
  EXPANSION_IDS,
  PROFILES,
  RULE_EVENT_TYPES,
  SCENARIO_IDS,
  VARIANT_IDS,
} from '@catan/rules';
import type {
  BoxId,
  ExpansionId,
  GameEvent,
  GameView,
  ProfileDefinition,
  Resource,
  ScenarioId,
  VariantId,
} from '@catan/rules';

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
  'error.E_BOT_NAME_TAKEN',
  'error.E_CAPACITY_BELOW_SEATED',
  'error.E_CHAT_INVALID',
  'error.E_CHAT_RATE_LIMITED',
  'error.E_CHAT_TOO_LONG',
  'error.E_COLOR_TAKEN',
  'error.E_COMMAND_ID_REUSED',
  'error.E_GAME_NOT_FOUND',
  'error.E_GAME_NOT_STARTED',
  'error.E_GAME_SUSPENDED',
  'error.E_INTERNAL',
  'error.E_INVALID_BOT',
  'error.E_INVALID_COLOR',
  'error.E_INVALID_JSON',
  'error.E_INVALID_NICKNAME',
  'error.E_INVALID_ORDER_MODE',
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
  'error.E_SEAT_WITHDRAWN',
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
  'blocker.botsUnsupported',
];

/**
 * Ruleset vocabulary the lobby renders: every registered profile's name and
 * unavailability reason, plus the expansion, scenario, variant and box names
 * the registry can describe. Derived from the registry, so registering a new
 * profile or scenario requires both locales to name it.
 */
export const RULESET_MESSAGE_IDS: readonly string[] = [
  ...new Set([
    ...PROFILES.map((profile) => profile.labelKey),
    ...PROFILES.flatMap((profile) => (profile.unavailableReasonKey ? [profile.unavailableReasonKey] : [])),
    'expansion.none',
    ...EXPANSION_IDS.map((id) => `expansion.${id}`),
    'scenario.standard',
    ...SCENARIO_IDS.map((id) => `scenario.${id}`),
    ...VARIANT_IDS.map((id) => `variant.${id}`),
    ...BOX_IDS.map((id) => `box.${id}`),
  ]),
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
    ...RULESET_MESSAGE_IDS,
  ]),
];

export { COMMAND_ERROR_CODES, RULE_EVENT_TYPES };

export type Visibility = 'private' | 'public';
export type RoomStatus = 'lobby' | 'playing' | 'suspended' | 'completed' | 'abandoned';
/**
 * How the host decides the game's seat/turn order when starting a lobby.
 * `join` keeps the current seat order (join order); `random` shuffles it once
 * at start.
 */
export type GameOrderMode = 'join' | 'random';
export const GAME_ORDER_MODES: readonly GameOrderMode[] = ['join', 'random'];
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
  /** 席位已明確退出（§4.6）；需撤回才能再行動。Bot 恆為 false。 */
  withdrawn?: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  visibility: Visibility;
  status: RoomStatus;
  hostId: string;
  profileId: string;
  setupMode: 'fixed' | 'variable';
  orderMode: GameOrderMode;
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
  /** 進行中對局的 open 放棄提案；沒有提案或沒有對局時為 null。 */
  pendingAbandon?: AbandonProposalView | null;
  /** 進行中（`playing`）對局的 open 全桌保存並暫停提案（§4.8）；沒有時為 null。 */
  pendingSuspend?: SuspendProposalView | null;
  /** 暫停中（`suspended`）對局已表示準備繼續的真人 playerId；不是暫停中時為 null。 */
  resumeReady?: string[] | null;
  /**
   * 檢視者在這個房間目前的進房世代（每次 HTTP join 或 socket 訂閱都會變大）。
   * 沒有 `unsubscribed` 確認可用時，離開請求以它當備援。只在有檢視者時出現。
   */
  viewerEntryEpoch?: number;
}

/** 放棄（無勝者終局）提案：同意者與缺席者，供確認畫面點名（§4.6）。 */
export interface AbandonProposalView {
  id: string;
  proposedBy: string;
  /** 已同意的真人 playerId。 */
  consents: string[];
  /** 目前缺席或已退出的真人 playerId。 */
  absent: string[];
  createdAt: string;
}

/** `POST /api/games/:gameId/abandon`（提案）的回應。 */
export interface AbandonProposeResult {
  proposalId: string;
  /** 提案即同意；唯一真人或同意者已齊時為 true，對局已以無勝者終局。 */
  abandoned: boolean;
}

/** `POST /api/games/:gameId/abandon`（附 proposalId 表態）的回應。 */
export interface AbandonConsentResult {
  abandoned: boolean;
}

/** 全桌保存並暫停提案（§4.8）：所有真人座位都同意才成立，缺席者不視為同意。 */
export interface SuspendProposalView {
  id: string;
  proposedBy: string;
  /** 已同意的真人 playerId（提案者本身算一票）。 */
  consents: string[];
  createdAt: string;
}

/** `POST /api/games/:gameId/suspend`（提案）的回應。 */
export interface SuspendProposeResult {
  proposalId: string;
  /** 提案即同意；唯一真人或同意者已齊時為 true，對局已暫停。 */
  suspended: boolean;
}

/** `POST /api/games/:gameId/suspend`（附 proposalId 表態）的回應。 */
export interface SuspendConsentResult {
  suspended: boolean;
}

/** `POST /api/games/:gameId/resume` 的回應。 */
export interface ResumeReadyResult {
  resumed: boolean;
  /** 尚未連線或尚未準備好的真人 playerId；`resumed` 為 true 時為空陣列。 */
  waitingFor: string[];
}

/**
 * `POST /api/rooms/:roomId/leave` 的回應。`left: false` 表示這次離開被忽略
 * （同一身分在該房仍有 live 訂閱連線，多半是遲到或重複的請求），沒有任何變更。
 */
export interface LeaveRoomResult {
  left: boolean;
  hostTransferredTo: string | null;
  /**
   * 只在 `left: false` 時出現：`present` 同一身分在該房仍有 live 訂閱連線；
   * `stale` 請求帶的 `entryEpoch` 比目前的進房世代舊（離開之後又重新進入）。
   */
  reason?: 'present' | 'stale';
}

/** `POST /api/rooms/:roomId/leave` 的選用 body。 */
export interface LeaveRoomRequest {
  /** 取自 `unsubscribed` 確認或 `RoomView.viewerEntryEpoch`；比目前世代舊就不離開。 */
  entryEpoch?: number;
}

/** `POST /api/games/:gameId/withdraw` 的回應。 */
export interface WithdrawResult {
  /** 套用後該席位是否處於退出狀態。 */
  withdrawn: boolean;
  /** 這次退出讓所有真人都已退出，對局因此以無勝者終局。 */
  abandoned: boolean;
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

/** Public registry entry (`GET /api/profiles`). */
export interface ProfileView {
  id: string;
  labelKey: string;
  /** Rules version new games of this profile are created under. */
  ruleVersion: string;
  /** Expansion set on top of the base rules; empty for the base game. */
  expansions: ExpansionId[];
  scenario: ScenarioId | null;
  variants: VariantId[];
  /** Boxes the table needs; display only, never validated. */
  requiredBoxes: BoxId[];
  playerCounts: number[];
  paired: boolean;
  victoryTarget: number;
  setupModes: ('fixed' | 'variable')[];
  enabled: boolean;
  unavailableReasonKey?: string;
  /**
   * Whether hosts may seat computer opponents (SPEC §4.9). The service decides
   * from the bot strategies' supported rules modules.
   */
  botSeats: boolean;
}

export function profileView(profile: ProfileDefinition, support: { botSeats: boolean }): ProfileView {
  return {
    id: profile.id,
    labelKey: profile.labelKey,
    ruleVersion: profile.ruleVersion,
    expansions: [...profile.expansions],
    scenario: profile.scenario,
    variants: [...profile.variants],
    requiredBoxes: [...profile.requiredBoxes],
    playerCounts: [...profile.playerCounts],
    paired: profile.paired,
    victoryTarget: profile.victoryTarget,
    setupModes: [...profile.setupModes],
    enabled: profile.enabled,
    botSeats: support.botSeats,
    ...(profile.unavailableReasonKey ? { unavailableReasonKey: profile.unavailableReasonKey } : {}),
  };
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
  /** 檢視者自己的席位已退出時為 true；對局仍可恢復，因為可以撤回。 */
  withdrawn?: boolean;
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
  | { type: 'pong'; payload: { at: string } }
  /**
   * 取消訂閱（`subscribe` 不帶 `roomId`）處理完成後的確認；未訂閱時 `roomId` 與
   * `entryEpoch` 都是 null。`entryEpoch` 是這個身分在該房「目前」的進房世代，
   * 離開時帶回 `POST /api/rooms/:roomId/leave` 的 body。
   */
  | { type: 'unsubscribed'; payload: { roomId: string | null; entryEpoch: number | null } };

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
  /**
   * Operator retention policy (SPEC §4.6). Unfinished games idle for more than
   * `gameRetentionDays` days are ended without a winner; `0` means disabled.
   */
  retention?: { gameRetentionDays: number };
}

export type { BoxId, ExpansionId, GameEvent, GameView, Resource, ScenarioId, VariantId };
