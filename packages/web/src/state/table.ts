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
import type { RoomQuery } from '../api/client.ts';
import type { SocketStatus } from '../api/socket.ts';
import { chatReducer, initialChatState, type ChatEvent, type ChatState } from './chat.ts';
import {
  commandReducer,
  type CommandEvent,
  type PendingCommand,
} from './commands.ts';

export type Screen = 'entry' | 'home' | 'lobby' | 'game' | 'result';
export type ConnectionState = 'online' | 'offline' | 'reconnecting';
export type DrawerPanel = 'none' | 'hand' | 'trade' | 'chat' | 'help';

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
  room: RoomView | null;
  roomError: Notice | null;
  games: ResumableGameView[];
  game: GameSnapshot | null;
  connection: ConnectionState;
  socketStatus: SocketStatus;
  /** docs/SPEC.md §8.4: newest connection controls the seat. */
  activeElsewhere: boolean;
  command: PendingCommand | null;
  save: SaveState;
  chat: ChatState;
  drawer: DrawerPanel;
  selection: Selection;
  toast: Notice | null;
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
    room: null,
    roomError: null,
    games: [],
    game: null,
    connection: 'online',
    socketStatus: 'closed',
    activeElsewhere: false,
    command: null,
    save: { status: 'idle' },
    chat: initialChatState(),
    drawer: 'none',
    selection: EMPTY_SELECTION,
    toast: null,
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
  | { type: 'room-query'; query: RoomQuery }
  | { type: 'room'; room: RoomView | null }
  | { type: 'room-error'; error: Notice | null }
  | { type: 'games'; games: ResumableGameView[] }
  | { type: 'snapshot'; snapshot: GameSnapshot | null }
  | { type: 'events'; events: GameEvent[] }
  | { type: 'connection'; connection: ConnectionState }
  | { type: 'socket-status'; status: SocketStatus }
  | { type: 'active-elsewhere'; value: boolean }
  | { type: 'command'; event: CommandEvent }
  | { type: 'save'; state: SaveState }
  | { type: 'chat'; event: ChatEvent }
  | { type: 'drawer'; drawer: DrawerPanel }
  | { type: 'selection'; selection: Selection }
  | { type: 'toast'; notice: Notice | null }
  | { type: 'announce'; announcement: Announcement | null }
  | { type: 'fatal'; error: Notice | null };

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
      return { ...state, rooms: action.rooms };
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
    case 'snapshot': {
      const snapshot = action.snapshot;
      const terminal = snapshot?.view.result != null;
      return {
        ...state,
        game: snapshot,
        screen: snapshot ? (terminal ? 'result' : 'game') : state.screen,
      };
    }
    case 'events': {
      const current = state.game;
      if (!current) return state;
      const lastSeq = current.view.events.at(-1)?.seq ?? 0;
      const incoming = action.events.filter((event) => event.seq > lastSeq);
      if (incoming.length === 0) return state;
      const events = [...current.view.events, ...incoming].slice(-200);
      return {
        ...state,
        game: {
          ...current,
          revision: Math.max(current.revision, incoming.at(-1)?.seq ?? current.revision),
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
    case 'drawer':
      return {
        ...state,
        drawer: action.drawer,
        chat: action.drawer === 'chat' ? chatReducer(state.chat, { kind: 'open' }) : state.chat,
      };
    case 'selection':
      return { ...state, selection: action.selection };
    case 'toast':
      return { ...state, toast: action.notice };
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

export function nameOf(state: TableState): (playerId: string) => string {
  const players = state.game?.view.players ?? [];
  const room = state.room;
  return (playerId: string) => {
    const player = players.find((candidate) => candidate.id === playerId);
    if (player) return player.nickname;
    const member = room?.members.find((candidate) => candidate.playerId === playerId);
    if (member) return member.nickname;
    return playerId;
  };
}
