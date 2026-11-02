/**
 * Whole-application state and its pure reducer.
 *
 * Keeping the reducer pure means the interesting rules — "a locale switch must
 * not drop a draft", "a rejected command keeps the draft", "an unknown outcome
 * blocks a retry" — are unit-testable without React, a server or a socket.
 */

import type {
  GameEvent,
  GameSnapshot,
  Locale,
  Notice,
  PlayerIdentity,
  ProfileView,
  ResumableGameView,
  RoomSummaryView,
  RoomView,
  ServerConfigView,
} from '@catan/protocol';
import type { Resource } from '@catan/rules';
import type { RoomQuery } from '../api/client.ts';
import { diceRollPresentations } from '../board/animation.ts';
import type { SocketStatus } from '../api/socket.ts';
import { chatReducer, initialChatState, type ChatEvent, type ChatState } from './chat.ts';
import { t } from '../i18n/index.ts';
import {
  commandReducer,
  type CommandEvent,
  type PendingCommand,
} from './commands.ts';

export type Screen = 'entry' | 'home' | 'lobby' | 'game' | 'result';

export interface RollHold {
  /** 擲骰前的本人手牌；手牌不可見時為 null。 */
  hand: Partial<Record<Resource, number>> | null;
  /** 擲骰前各玩家公開的手牌張數。 */
  handSizes: Readonly<Record<string, number>>;
  /** 擲骰前已知的最後事件序號。 */
  eventSeq: number;
}
export type ConnectionState = 'online' | 'offline' | 'reconnecting';
export type DrawerPanel = 'none' | 'hand' | 'trade' | 'exchange' | 'chat' | 'help';

export type GameSyncCause = 'open' | 'resume' | 'reconnect' | 'gap' | 'snapshot' | 'command' | 'refresh' | 'events';
export type GameSyncBoundary = Extract<GameSyncCause, 'open' | 'resume' | 'reconnect' | 'gap'>;
export interface GameSyncMetadata {
  generation: number;
  cause: GameSyncCause;
}

export interface Selection {
  kind: 'vertex' | 'edge' | 'hex' | null;
  index: number | null;
  commandType: string | null;
  /** Message id describing the intended action, for the preview panel. */
  labelId: string | null;
}

export const EMPTY_SELECTION: Selection = {
  kind: null,
  index: null,
  commandType: null,
  labelId: null,
};

export type SaveState =
  | { status: 'idle' }
  | { status: 'pending'; requestId: string }
  | { status: 'saved'; requestId: string; savedAt: string; revision: number }
  | { status: 'failed'; requestId: string; error: Notice | null };

export interface Announcement {
  messageId: string;
  params?: Record<string, unknown>;
}

/** Lifecycle of the public room list; only the newest request may settle it. */
export type RoomListStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TableState {
  screen: Screen;
  locale: Locale;
  bootstrapped: boolean;
  /** Committed display name; `draftNickname` is the un-submitted entry draft. */
  nickname: string;
  draftNickname: string;
  session: PlayerIdentity | null;
  config: ServerConfigView | null;
  profiles: ProfileView[];
  rooms: RoomSummaryView[];
  roomQuery: RoomQuery;
  roomsStatus: RoomListStatus;
  roomsError: Notice | null;
  room: RoomView | null;
  roomError: Notice | null;
  games: ResumableGameView[];
  game: GameSnapshot | null;
  gameSync: GameSyncMetadata;
  /** 下一個有效投影建立演出 baseline。 */
  gameSyncPending: boolean;
  connection: ConnectionState;
  socketStatus: SocketStatus;
  /** docs/SPEC.md §8.4: newest connection controls the seat. */
  activeElsewhere: boolean;
  command: PendingCommand | null;
  save: SaveState;
  chat: ChatState;
  /** 本地交易偏好：自己資源不足的提案由客戶端代為拒絕（docs/SPEC.md §4.5）。 */
  tradeAutoDecline: boolean;
  drawer: DrawerPanel;
  selection: Selection;
  /** 擲骰演出進行中（含排隊中的骰子）；後續動作選項與資源演出等它結束才出現。 */
  dicePresenting: boolean;
  /** 擲骰演出期間凍結的擲骰前狀態，點數揭曉前不從手牌、玩家列表或紀錄透露結果。 */
  rollHold: RollHold | null;
  toast: Notice | null;
  /** Monotonic identity for the current toast; a repeated message gets a new run. */
  toastId: number;
  announcement: Announcement | null;
  fatal: Notice | null;
}

export function initialTableState(locale: Locale, nickname = ''): TableState {
  return {
    screen: 'entry',
    locale,
    bootstrapped: false,
    nickname,
    draftNickname: nickname,
    session: null,
    config: null,
    profiles: [],
    rooms: [],
    roomQuery: {},
    roomsStatus: 'idle',
    roomsError: null,
    room: null,
    roomError: null,
    games: [],
    game: null,
    gameSync: { generation: 0, cause: 'open' },
    gameSyncPending: false,
    connection: 'online',
    socketStatus: 'closed',
    activeElsewhere: false,
    command: null,
    save: { status: 'idle' },
    chat: initialChatState(),
    tradeAutoDecline: false,
    drawer: 'none',
    selection: EMPTY_SELECTION,
    dicePresenting: false,
    rollHold: null,
    toast: null,
    toastId: 0,
    announcement: null,
    fatal: null,
  };
}

export type TableAction =
  | { type: 'bootstrapped'; session: PlayerIdentity | null; config: ServerConfigView; profiles: ProfileView[]; games: ResumableGameView[]; locale: Locale; nickname: string }
  | { type: 'locale'; locale: Locale }
  | { type: 'draft-nickname'; value: string }
  | { type: 'nickname'; value: string }
  | { type: 'session'; player: PlayerIdentity | null }
  | { type: 'screen'; screen: Screen }
  | { type: 'rooms'; rooms: RoomSummaryView[] }
  | { type: 'rooms-request' }
  | { type: 'rooms-error'; error: Notice }
  | { type: 'room-query'; query: RoomQuery }
  | { type: 'room'; room: RoomView | null }
  | { type: 'room-error'; error: Notice | null }
  | { type: 'games'; games: ResumableGameView[] }
  | { type: 'game-sync'; cause: GameSyncBoundary; generation: number }
  | { type: 'snapshot'; snapshot: GameSnapshot | null; cause?: GameSyncCause; generation?: number }
  | { type: 'events'; events: GameEvent[]; gameId?: string; revision?: number }
  | { type: 'connection'; connection: ConnectionState }
  | { type: 'socket-status'; status: SocketStatus }
  | { type: 'active-elsewhere'; value: boolean }
  | { type: 'command'; event: CommandEvent }
  | { type: 'save'; state: SaveState }
  | { type: 'chat'; event: ChatEvent }
  | { type: 'trade-auto-decline'; value: boolean }
  | { type: 'drawer'; drawer: DrawerPanel }
  | { type: 'selection'; selection: Selection }
  | { type: 'dice-presenting'; value: boolean }
  | { type: 'toast'; notice: Notice | null }
  | { type: 'announce'; announcement: Announcement | null }
  | { type: 'fatal'; error: Notice | null };

/**
 * 新進的權威資料帶來尚未見過的擲骰時，先暫定進入擲骰演出並凍結擲骰前的本人手牌，
 * 讓這筆更新的第一次繪製就不會透露點數；是否真的演出由盤面動畫在同次繪製前校正。
 */
function holdForRoll(state: TableState, events: readonly GameEvent[]): Partial<TableState> {
  const current = state.game;
  if (!current) return {};
  const lastSeq = Math.max(current.view.seq, ...current.view.events.map((event) => event.seq));
  const fresh = events.filter((event) => event.seq > lastSeq);
  if (diceRollPresentations(current.gameId, fresh).length === 0) return {};
  if (state.dicePresenting) return {};
  const own = current.view.players.find((player) => player.id === state.session?.id)?.resources;
  return {
    dicePresenting: true,
    rollHold: {
      hand: own ? { ...own } : null,
      handSizes: Object.fromEntries(current.view.players.map((player) => [player.id, player.handSize])),
      eventSeq: lastSeq,
    },
  };
}

function activeHold(state: TableState): RollHold | null {
  return state.dicePresenting ? state.rollHold : null;
}

/**
 * 已收到權威事件、但投影尚未追上（事件先於投影抵達）。此時畫面上的提示與按鈕
 * 都來自過時的投影，依它送出的指令必然被拒。
 */
export function awaitingProjection(state: TableState): boolean {
  const game = state.game;
  return !!game && game.view.events.some((event) => event.seq > game.view.seq);
}

/** 後續操作是否暫停：擲骰演出中，或投影尚未追上已知事件。 */
export function followUpsHeld(state: TableState): boolean {
  return state.dicePresenting || awaitingProjection(state);
}

/** 畫面上顯示的本人手牌：擲骰演出期間用擲骰前的數量。手牌不可見時為 undefined。 */
export function shownHand(state: TableState): Partial<Record<Resource, number>> | undefined {
  const own = state.game?.view.players.find((player) => player.id === state.session?.id)?.resources;
  const held = activeHold(state)?.hand;
  return own && held ? held : own;
}

/** 玩家公開的手牌張數：擲骰演出期間用擲骰前的張數。 */
export function shownHandSize(state: TableState, player: { id: string; handSize: number }): number {
  return activeHold(state)?.handSizes[player.id] ?? player.handSize;
}

/** 事件紀錄：擲骰演出期間只列出擲骰前已知的事件，並隱藏最新點數。 */
export function shownEvents(state: TableState): { events: readonly GameEvent[]; diceHidden: boolean } {
  const events = state.game?.view.events ?? [];
  const hold = activeHold(state);
  return hold ? { events: events.filter((event) => event.seq <= hold.eventSeq), diceHidden: true } : { events, diceHidden: false };
}

/** Screens are derived from authoritative room/game status, never guessed. */
export function screenForRoom(room: RoomView | null): Screen {
  if (!room) return 'home';
  switch (room.status) {
    case 'lobby':
      return 'lobby';
    case 'playing':
    case 'suspended':
      return 'game';
    case 'completed':
    case 'abandoned':
      return 'result';
    default:
      return 'lobby';
  }
}

export function tableReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case 'bootstrapped':
      return {
        ...state,
        bootstrapped: true,
        session: action.session,
        config: action.config,
        profiles: action.profiles,
        games: action.games,
        locale: action.locale,
        nickname: action.nickname,
        draftNickname: state.draftNickname === '' ? action.nickname : state.draftNickname,
        screen: action.session ? 'home' : 'entry',
      };
    case 'locale':
      // Locale is display-only: drafts, selections and command ids survive.
      return { ...state, locale: action.locale };
    case 'draft-nickname':
      return { ...state, draftNickname: action.value };
    case 'nickname':
      return { ...state, nickname: action.value, draftNickname: action.value };
    case 'session':
      return {
        ...state,
        session: action.player,
        nickname: action.player?.nickname ?? state.nickname,
        draftNickname: action.player?.nickname ?? state.draftNickname,
        screen: action.player ? (state.screen === 'entry' ? 'home' : state.screen) : 'entry',
      };
    case 'screen':
      return { ...state, screen: action.screen };
    case 'rooms':
      return { ...state, rooms: action.rooms, roomsStatus: 'ready', roomsError: null };
    case 'rooms-request':
      return { ...state, roomsStatus: 'loading', roomsError: null };
    case 'rooms-error':
      return { ...state, roomsStatus: 'error', roomsError: action.error };
    case 'room-query':
      return { ...state, roomQuery: action.query };
    case 'room': {
      const room = action.room;
      const nextScreen: Screen = room
        ? room.status === 'lobby'
          ? 'lobby'
          : room.status === 'completed' || room.status === 'abandoned'
            ? 'result'
            : 'game'
        : 'home';
      return {
        ...state,
        room,
        roomError: null,
        screen: state.screen === 'entry' ? state.screen : nextScreen,
      };
    }
    case 'room-error':
      return { ...state, roomError: action.error };
    case 'games':
      return { ...state, games: action.games };
    case 'game-sync':
      if (action.generation <= state.gameSync.generation) return state;
      return { ...state, gameSync: { generation: action.generation, cause: action.cause }, gameSyncPending: true };
    case 'snapshot': {
      const snapshot = action.snapshot;
      const generation = action.generation ?? state.gameSync.generation;
      if (generation < state.gameSync.generation) return state;
      const current = state.game;
      if (snapshot && current?.gameId === snapshot.gameId &&
          (snapshot.revision < current.revision || snapshot.view.seq < current.view.seq)) return state;
      const terminal = snapshot?.view.result != null;
      return {
        ...state,
        ...holdForRoll(state, snapshot && current?.gameId === snapshot.gameId ? snapshot.view.events : []),
        game: snapshot,
        gameSync: { generation, cause: state.gameSyncPending ? state.gameSync.cause : (action.cause ?? 'snapshot') },
        gameSyncPending: false,
        screen: snapshot ? (terminal ? 'result' : 'game') : state.screen,
      };
    }
    case 'events': {
      const current = state.game;
      if (!current) return state;
      if (action.gameId && action.gameId !== current.gameId) return state;
      if (action.revision !== undefined && action.revision < current.revision) return state;
      const lastSeq = Math.max(current.view.seq, ...current.view.events.map((event) => event.seq));
      const incoming = [...new Map(action.events.filter((event) => event.seq > lastSeq)
        .map((event) => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
      if (incoming.length === 0) return state;
      const events = [...current.view.events, ...incoming].slice(-200);
      return {
        ...state,
        ...holdForRoll(state, incoming),
        gameSync: state.gameSyncPending ? state.gameSync : { ...state.gameSync, cause: 'events' },
        game: {
          ...current,
          revision: action.revision ?? current.revision,
          view: { ...current.view, events },
        },
      };
    }
    case 'connection':
      return { ...state, connection: action.connection };
    case 'socket-status':
      return { ...state, socketStatus: action.status };
    case 'active-elsewhere':
      return { ...state, activeElsewhere: action.value };
    case 'command':
      return { ...state, command: commandReducer(state.command, action.event) };
    case 'save':
      return { ...state, save: action.state };
    case 'chat':
      return { ...state, chat: chatReducer(state.chat, action.event) };
    case 'trade-auto-decline':
      return state.tradeAutoDecline === action.value ? state : { ...state, tradeAutoDecline: action.value };
    case 'drawer':
      return {
        ...state,
        drawer: action.drawer,
        chat: chatReducer(state.chat, { kind: action.drawer === 'chat' ? 'open' : 'close' }),
      };
    case 'selection':
      return { ...state, selection: action.selection };
    case 'dice-presenting':
      if (state.dicePresenting === action.value) return state;
      return action.value ? { ...state, dicePresenting: true } : { ...state, dicePresenting: false, rollHold: null };
    case 'toast':
      return { ...state, toast: action.notice, toastId: state.toastId + 1 };
    case 'announce':
      return { ...state, announcement: action.announcement };
    case 'fatal':
      return { ...state, fatal: action.error };
    default:
      return state;
  }
}

/** Convenience selectors used by several components. */
export function selfPlayerId(state: TableState): string | null {
  return state.session?.id ?? null;
}

export function selfPlayer(state: TableState) {
  const id = selfPlayerId(state);
  if (!id || !state.game) return null;
  return state.game.view.players.find((player) => player.id === id) ?? null;
}

/** Identity of the active turn instance; feedback from an older turn clears. */
export function activeTurnKey(state: TableState): string | null {
  const game = state.game;
  if (!game) return null;
  // `windowId` advances on every normal action window (including paired actors
  // and a reconnect that skipped a round). Setup does not open a window, so its
  // decreasing remaining-step count supplies the same boundary.
  const setup = game.view.turn.setup;
  const setupStep = setup ? `${setup.round}:${setup.remaining}` : 'play';
  return `${game.gameId}:${game.view.windowId}:${setupStep}`;
}

/**
 * 事件、提示與棋盤說明共用的名稱解析。電腦座位顯示為「Ada（電腦）」；房間資料
 * 尚未載入時（例如離線恢復）無從得知是否為電腦，維持原名。
 */
export function nameOf(state: TableState): (playerId: string) => string {
  const players = state.game?.view.players ?? [];
  const room = state.room;
  return (playerId: string) => {
    const member = room?.members.find((candidate) => candidate.playerId === playerId);
    const player = players.find((candidate) => candidate.id === playerId);
    const nickname = player?.nickname ?? member?.nickname;
    if (nickname === undefined) return playerId;
    return member?.bot ? t(state.locale, 'bot.playerName', { name: nickname }) : nickname;
  };
}
