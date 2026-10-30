/**
 * Orchestration layer: the only place that talks to the API and the socket.
 *
 * Design rules enforced here:
 * - every mutation goes through `runRoom`/`submitCommand`, so a failure always
 *   lands in state as a localisable `Notice` instead of an unhandled rejection;
 * - an unknown command outcome is resolved by replaying the *same* command id,
 *   never by minting a new one;
 * - a WebSocket gap refetches the authoritative snapshot rather than patching
 *   state optimistically (docs/API.md ordering guarantee).
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, type Dispatch } from 'react';
import type {
  ApiError,
  ApiResult,
  ChatMessageView,
  CommandReceipt,
  GameEvent,
  GameSnapshot,
  Locale,
  Notice,
  RoomPolicy,
  RoomView,
  ServerConfigView,
} from '@catan/protocol';
import type { CatanApi, CreateRoomBody, RoomQuery, RoomSettingsBody } from '../api/client.ts';
import { SocketClient, type SocketFactory } from '../api/socket.ts';
import { detectLocale } from '../i18n/index.ts';
import { newChatId, newCommandId, newRequestId } from './ids.ts';
import {
  browserStorage,
  readStoredLocale,
  readStoredMutes,
  readStoredNickname,
  writeStoredLocale,
  writeStoredMutes,
  writeStoredNickname,
  type StorageLike,
} from './session.ts';
import {
  EMPTY_SELECTION,
  initialTableState,
  tableReducer,
  type DrawerPanel,
  type GameSyncBoundary,
  type GameSyncCause,
  type Selection,
  type TableAction,
  type TableState,
} from './table.ts';
import type { CommandPayload } from './commands.ts';
import { blocksNewCommands } from './commands.ts';

export interface UseTableOptions {
  api: CatanApi;
  storage?: StorageLike;
  socketFactory?: SocketFactory;
  socketUrl?: string;
  languages?: readonly string[];
  /** Connect the WebSocket. Tests pass `false`. */
  connectSocket?: boolean;
}

export interface TableActions {
  bootstrap(): Promise<void>;
  setLocale(locale: Locale): void;
  submitNickname(nickname: string): Promise<void>;
  refreshRooms(query?: RoomQuery): Promise<void>;
  createRoom(body: CreateRoomBody): Promise<void>;
  joinRoom(code: string): Promise<void>;
  takeSeat(color: string): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  updateSettings(body: RoomSettingsBody): Promise<void>;
  proposePolicy(policy: RoomPolicy): Promise<void>;
  respondPolicy(proposalId: string, approve: boolean): Promise<void>;
  startGame(): Promise<void>;
  leaveRoom(): Promise<void>;
  closeRoom(): Promise<void>;
  openGame(gameId: string): Promise<void>;
  refreshSnapshot(): Promise<void>;
  submitCommand(command: CommandPayload, labelId: string): Promise<void>;
  resolveCommand(): Promise<void>;
  retryCommand(): Promise<void>;
  clearCommand(): void;
  saveGame(): Promise<void>;
  suspendGame(): Promise<void>;
  resumeTable(ready: boolean): Promise<void>;
  loadChat(roomId?: string, before?: number): Promise<void>;
  sendChat(text: string): Promise<void>;
  retryChat(clientMessageId: string): Promise<void>;
  setChatDraft(text: string): void;
  toggleMute(playerId: string): void;
  selectTarget(selection: Selection): void;
  cancelSelection(): void;
  confirmSelection(): Promise<void>;
  setDrawer(drawer: DrawerPanel): void;
}

export interface TableController {
  state: TableState;
  dispatch: Dispatch<TableAction>;
  actions: TableActions;
}

function noticeFrom(error: ApiError): Notice {
  return { messageId: error.messageId, params: error.params };
}

function localNotice(messageId: string, params?: Record<string, unknown>): Notice {
  return { messageId, params };
}

/** Applies a receipt to state and, when accepted, refreshes the projection. */
function receiptNotice(receipt: CommandReceipt): Notice | null {
  if (receipt.outcome === 'accepted') return null;
  return receipt.error ?? localNotice('command.rejected', { reason: '—' });
}

export function useTable(options: UseTableOptions): TableController {
  const { api } = options;
  const storage = useMemo(() => options.storage ?? browserStorage(), [options.storage]);
  const languages = useMemo(
    () => options.languages ?? (globalThis.navigator?.languages ?? []),
    [options.languages],
  );
  const socketUrl =
    options.socketUrl ??
    (typeof globalThis.location !== 'undefined'
      ? `${globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${globalThis.location.host}/ws`
      : '/ws');

  const [state, dispatch] = useReducer(
    tableReducer,
    undefined,
    () =>
      initialTableState(
        readStoredLocale(storage) ?? detectLocale(languages),
        readStoredNickname(storage),
      ),
  );

  const stateRef = useRef(state);
  stateRef.current = state;
  const socketRef = useRef<SocketClient | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const gameIdRef = useRef<string | null>(null);
  const syncGenerationRef = useRef(0);
  /** Late-bound so `joinRoom` can fetch history without a declaration cycle. */
  const loadChatRef = useRef<TableActions['loadChat'] | null>(null);

  const currentRoomId = state.room?.id ?? null;
  const currentGameId = state.game?.gameId ?? state.room?.gameId ?? null;

  // Refs mirror authoritative ids for use inside async callbacks. They are
  // updated in effects (never during render) and only ever *set*, so a render
  // triggered by an unrelated slice of state cannot clear a live id.
  useEffect(() => {
    if (currentRoomId) roomIdRef.current = currentRoomId;
  }, [currentRoomId]);
  useEffect(() => {
    if (currentGameId) gameIdRef.current = currentGameId;
  }, [currentGameId]);

  // ---------------------------------------------------------------------
  // low level helpers
  // ---------------------------------------------------------------------

  const applyRoom = useCallback(
    (result: ApiResult<RoomView>, context: string) => {
      if (result.ok) {
        dispatch({ type: 'room', room: result.data });
        return result.data;
      }
      dispatch({ type: 'room-error', error: noticeFrom(result.error) });
      dispatch({ type: 'toast', notice: noticeFrom(result.error) });
      if (context === 'join' || context === 'create') {
        dispatch({ type: 'screen', screen: 'home' });
      }
      return null;
    },
    [dispatch],
  );

  const beginGameSync = useCallback((cause: GameSyncBoundary): number => {
    const generation = ++syncGenerationRef.current;
    dispatch({ type: 'game-sync', cause, generation });
    return generation;
  }, []);

  const receiveSnapshot = useCallback((snapshot: GameSnapshot, generation: number, cause: GameSyncCause) => {
    if (generation !== syncGenerationRef.current || snapshot.gameId !== gameIdRef.current) return;
    dispatch({ type: 'snapshot', snapshot, generation, cause });
  }, []);

  const refreshGame = useCallback(async (cause: GameSyncCause = 'refresh'): Promise<void> => {
    if (cause === 'reconnect' || cause === 'gap' || cause === 'resume') beginGameSync(cause);
    const generation = syncGenerationRef.current;
    const gameId = gameIdRef.current;
    if (!gameId) return;
    const result = await api.getGame(gameId);
    if (generation !== syncGenerationRef.current || gameId !== gameIdRef.current) return;
    if (result.ok) {
      receiveSnapshot(result.data, generation,
        cause === 'reconnect' || cause === 'gap' || cause === 'resume' ? 'refresh' : cause);
      dispatch({ type: 'room-error', error: null });
      dispatch({ type: 'command', event: { kind: 'refreshed' } });
    } else if (result.error.code === 'E_NETWORK') {
      dispatch({ type: 'connection', connection: 'offline' });
    } else {
      dispatch({ type: 'room-error', error: noticeFrom(result.error) });
    }
  }, [api, dispatch, beginGameSync, receiveSnapshot]);

  const refreshSnapshot = useCallback(() => refreshGame(), [refreshGame]);

  const openGame = useCallback(
    async (gameId: string): Promise<void> => {
      gameIdRef.current = gameId;
      const generation = beginGameSync('open');
      const result = await api.getGame(gameId);
      if (result.ok) {
        if (generation !== syncGenerationRef.current || gameId !== gameIdRef.current) return;
        receiveSnapshot(result.data, generation, 'refresh');
        if (result.data.roomId) {
          roomIdRef.current = result.data.roomId;
          // Resume/reconnect: recover authorized recent chat history.
          void loadChatRef.current?.(result.data.roomId);
        }
      } else {
        dispatch({ type: 'room-error', error: noticeFrom(result.error) });
      }
    },
    [api, dispatch, beginGameSync, receiveSnapshot],
  );

  const refreshRooms = useCallback(
    async (query?: RoomQuery): Promise<void> => {
      if (query) dispatch({ type: 'room-query', query });
      const result = await api.listRooms(query ?? stateRef.current.roomQuery);
      if (result.ok) dispatch({ type: 'rooms', rooms: result.data.rooms });
    },
    [api, dispatch],
  );

  // ---------------------------------------------------------------------
  // bootstrap
  // ---------------------------------------------------------------------

  const bootstrap = useCallback(async (): Promise<void> => {
    // `listGames` is an authenticated endpoint, so it is only requested once a
    // session is known to exist; otherwise a first visit would fire a
    // guaranteed 401 and log a spurious console error.
    const [configResult, sessionResult, profilesResult] = await Promise.all([
      api.getConfig(),
      api.getSession(),
      api.listProfiles(),
    ]);
    const knownSession = sessionResult.ok ? sessionResult.data.player : null;
    const gamesResult = knownSession ? await api.listGames() : null;
    const config: ServerConfigView = configResult.ok
      ? configResult.data
      : {
          locales: ['zh-Hant', 'en'],
          policyBounds: {
            turnClockSeconds: { min: 0, max: 3600 },
            disconnectGraceSeconds: { min: 30, max: 3600 },
          },
          defaultPolicy: {
            turnClockSeconds: 0,
            disconnectGraceSeconds: 300,
            allowAbandonment: true,
            hostSuccession: 'automatic',
          },
          limits: {
            nicknameMaxLength: 24,
            chatMaxLength: 400,
            chatRatePerMinute: 30,
            roomCapacityMax: 6,
          },
        };
    const stored = readStoredLocale(storage);
    const session = knownSession;
    const locale = stored ?? session?.locale ?? detectLocale(languages);
    dispatch({
      type: 'bootstrapped',
      session,
      config,
      profiles: profilesResult.ok ? profilesResult.data.profiles : [],
      games: gamesResult?.ok ? gamesResult.data.games : [],
      locale,
      nickname: session?.nickname ?? readStoredNickname(storage),
    });
    dispatch({
      type: 'chat',
      event: { kind: 'page', messages: [], nextSeq: 0, hasMore: false },
    });
    const mutes = readStoredMutes(storage);
    for (const playerId of mutes) dispatch({ type: 'chat', event: { kind: 'mute', playerId } });
  }, [api, dispatch, languages, storage]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // ---------------------------------------------------------------------
  // locale + identity
  // ---------------------------------------------------------------------

  const setLocale = useCallback(
    (locale: Locale): void => {
      dispatch({ type: 'locale', locale });
      writeStoredLocale(storage, locale);
      if (stateRef.current.session) void api.updateSession({ locale });
    },
    [api, dispatch, storage],
  );

  const submitNickname = useCallback(
    async (nickname: string): Promise<void> => {
      const trimmed = nickname.trim();
      if (trimmed.length === 0) return;
      writeStoredNickname(storage, trimmed);
      const result = stateRef.current.session
        ? await api.updateSession({ nickname: trimmed, locale: stateRef.current.locale })
        : await api.createSession({ nickname: trimmed, locale: stateRef.current.locale });
      if (result.ok) {
        dispatch({ type: 'session', player: result.data.player });
        dispatch({ type: 'nickname', value: result.data.player.nickname });
      } else {
        dispatch({ type: 'toast', notice: noticeFrom(result.error) });
      }
    },
    [api, dispatch, storage],
  );

  // ---------------------------------------------------------------------
  // lobby
  // ---------------------------------------------------------------------

  const createRoom = useCallback(
    async (body: CreateRoomBody): Promise<void> => {
      applyRoom(await api.createRoom(body), 'create');
    },
    [api, applyRoom],
  );

  const joinRoom = useCallback(
    async (code: string): Promise<void> => {
      const result = await api.joinRoom({ code: code.trim() });
      if (result.ok) {
        roomIdRef.current = result.data.id;
        applyRoom(result, 'join');
        void loadChatRef.current?.(result.data.id);
      } else {
        applyRoom(result, 'join');
      }
    },
    [api, applyRoom],
  );

  const takeSeat = useCallback(
    async (color: string): Promise<void> => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      applyRoom(await api.takeSeat(roomId, color), 'seat');
    },
    [api, applyRoom],
  );

  const setReady = useCallback(
    async (ready: boolean): Promise<void> => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      applyRoom(await api.setReady(roomId, ready), 'ready');
    },
    [api, applyRoom],
  );

  const updateSettings = useCallback(
    async (body: RoomSettingsBody): Promise<void> => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      const result = await api.updateSettings(roomId, body);
      if (result.ok) {
        applyRoom(result, 'settings');
        dispatch({ type: 'toast', notice: localNotice('lobby.settingsSaved') });
      } else {
        applyRoom(result, 'settings');
      }
    },
    [api, applyRoom, dispatch],
  );

  const proposePolicy = useCallback(
    async (policy: RoomPolicy): Promise<void> => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      const result = await api.proposePolicy(roomId, policy);
      if (result.ok) {
        applyRoom(result, 'policy');
        dispatch({ type: 'toast', notice: localNotice('lobby.policySaved') });
      } else {
        applyRoom(result, 'policy');
      }
    },
    [api, applyRoom, dispatch],
  );

  const respondPolicy = useCallback(
    async (proposalId: string, approve: boolean): Promise<void> => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      applyRoom(await api.respondPolicy(roomId, { proposalId, approve }), 'policy');
    },
    [api, applyRoom],
  );

  const startGame = useCallback(async (): Promise<void> => {
    const roomId = roomIdRef.current;
    if (!roomId) return;
    const result = await api.startGame(roomId);
    if (result.ok) {
      await openGame(result.data.gameId);
      const room = await api.getRoom(roomId);
      if (room.ok) applyRoom(room, 'start');
    } else {
      dispatch({ type: 'room-error', error: noticeFrom(result.error) });
      dispatch({ type: 'toast', notice: noticeFrom(result.error) });
    }
  }, [api, applyRoom, dispatch, openGame]);

  const leaveRoom = useCallback(async (): Promise<void> => {
    const roomId = roomIdRef.current;
    if (!roomId) return;
    const result = await api.leaveRoom(roomId);
    if (result.ok) {
      if (result.data.hostTransferredTo) {
        dispatch({
          type: 'toast',
          notice: localNotice('lobby.hostTransferredTo', { player: result.data.hostTransferredTo }),
        });
      }
      roomIdRef.current = null;
      gameIdRef.current = null;
      dispatch({ type: 'room', room: null });
      dispatch({ type: 'snapshot', snapshot: null });
      dispatch({ type: 'screen', screen: 'home' });
      const games = await api.listGames();
      if (games.ok) dispatch({ type: 'games', games: games.data.games });
    } else {
      dispatch({ type: 'toast', notice: noticeFrom(result.error) });
    }
  }, [api, dispatch]);

  const closeRoom = useCallback(async (): Promise<void> => {
    const roomId = roomIdRef.current;
    if (!roomId) return;
    const result = await api.closeRoom(roomId);
    if (result.ok) {
      roomIdRef.current = null;
      dispatch({ type: 'room', room: null });
      dispatch({ type: 'screen', screen: 'home' });
    } else {
      dispatch({ type: 'toast', notice: noticeFrom(result.error) });
    }
  }, [api, dispatch]);

  // ---------------------------------------------------------------------
  // commands
  // ---------------------------------------------------------------------

  const refreshAfterAccepted = useCallback(async (): Promise<void> => {
    await refreshGame('command');
  }, [refreshGame]);

  const runCommand = useCallback(
    async (commandId: string, command: CommandPayload, expectedRevision: number): Promise<void> => {
      const gameId = gameIdRef.current;
      if (!gameId) return;
      const result = await api.sendCommand(gameId, {
        commandId,
        expectedRevision,
        command,
      });
      if (result.ok) {
        dispatch({ type: 'command', event: { kind: 'receipt', receipt: result.data } });
        const notice = receiptNotice(result.data);
        if (notice) {
          dispatch({ type: 'toast', notice });
          dispatch({
            type: 'announce',
            announcement: { messageId: 'a11y.actionRejected', params: notice.params },
          });
        } else {
          dispatch({
            type: 'announce',
            announcement: { messageId: 'a11y.actionAccepted', params: {} },
          });
          // Clear the local preview only once the server confirmed the move.
          dispatch({ type: 'selection', selection: EMPTY_SELECTION });
          await refreshAfterAccepted();
        }
      } else {
        dispatch({
          type: 'command',
          event: { kind: 'transport-failure', error: noticeFrom(result.error) },
        });
        dispatch({ type: 'connection', connection: 'offline' });
        dispatch({ type: 'toast', notice: noticeFrom(result.error) });
      }
    },
    [api, dispatch, refreshAfterAccepted],
  );

  const submitCommand = useCallback(
    async (command: CommandPayload, labelId: string): Promise<void> => {
      const current = stateRef.current;
      if (blocksNewCommands(current.command)) return;
      const snapshot: GameSnapshot | null = current.game;
      if (!snapshot) return;
      // 所有指令入口（動作列、交易、兌換、發展卡、棋盤）共用：點數揭曉前不送出後續指令。
      if (current.dicePresenting) {
        dispatch({ type: 'toast', notice: localNotice('play.disabled.rolling') });
        return;
      }
      if (current.activeElsewhere) {
        dispatch({ type: 'toast', notice: localNotice('app.activeInAnotherTab') });
        return;
      }
      const commandId = newCommandId();
      dispatch({
        type: 'command',
        event: {
          kind: 'begin',
          commandId,
          labelId,
          command,
          baseRevision: snapshot.revision,
        },
      });
      await runCommand(commandId, command, snapshot.revision);
    },
    [dispatch, runCommand],
  );

  /** Replays the pending command id to recover a lost receipt (idempotent). */
  const resolveCommand = useCallback(async (): Promise<void> => {
    const pending = stateRef.current.command;
    if (!pending || pending.status !== 'unknown') return;
    await runCommand(pending.commandId, pending.command, pending.baseRevision);
  }, [runCommand]);

  const clearCommand = useCallback((): void => {
    dispatch({ type: 'command', event: { kind: 'clear' } });
  }, [dispatch]);

  /**
   * Retry after a definitive rejection. A *new* command id is minted here: the
   * rejected id already has a stored receipt and must not be replayed as if it
   * were a fresh attempt.
   */
  const retryCommand = useCallback(async (): Promise<void> => {
    const pending = stateRef.current.command;
    if (!pending || pending.status !== 'rejected') return;
    await submitCommand(pending.command, pending.labelId);
  }, [submitCommand]);

  // ---------------------------------------------------------------------
  // save / suspend / resume
  // ---------------------------------------------------------------------

  const saveGame = useCallback(async (): Promise<void> => {
    const gameId = gameIdRef.current;
    if (!gameId) return;
    const requestId = newRequestId();
    dispatch({ type: 'save', state: { status: 'pending', requestId } });
    const result = await api.saveGame(gameId, requestId);
    if (result.ok && result.data.outcome === 'saved') {
      dispatch({
        type: 'save',
        state: {
          status: 'saved',
          requestId,
          savedAt: result.data.savedAt,
          revision: result.data.revision,
        },
      });
      dispatch({ type: 'screen', screen: 'home' });
      const games = await api.listGames();
      if (games.ok) dispatch({ type: 'games', games: games.data.games });
    } else {
      const error = result.ok ? (result.data.error ?? null) : noticeFrom(result.error);
      dispatch({ type: 'save', state: { status: 'failed', requestId, error } });
    }
  }, [api, dispatch]);

  const suspendGame = useCallback(async (): Promise<void> => {
    const gameId = gameIdRef.current;
    if (!gameId) return;
    const result = await api.suspendGame(gameId);
    if (result.ok) applyRoom(result, 'suspend');
    else dispatch({ type: 'toast', notice: noticeFrom(result.error) });
  }, [api, applyRoom, dispatch]);

  const resumeTable = useCallback(
    async (ready: boolean): Promise<void> => {
      const gameId = gameIdRef.current;
      if (!gameId) return;
      const result = await api.resumeGame(gameId, ready);
      if (result.ok) {
        applyRoom(result, 'resume');
        await refreshGame('resume');
      }
      else dispatch({ type: 'toast', notice: noticeFrom(result.error) });
    },
    [api, applyRoom, dispatch, refreshGame],
  );

  // ---------------------------------------------------------------------
  // chat
  // ---------------------------------------------------------------------

  const loadChat = useCallback(
    async (roomId?: string, before?: number): Promise<void> => {
      const id = roomId ?? roomIdRef.current;
      if (!id) return;
      dispatch({ type: 'chat', event: { kind: 'loading', loading: true } });
      const result = await api.getChat(id, before === undefined ? { limit: 50 } : { limit: 50 });
      if (result.ok) {
        dispatch({
          type: 'chat',
          event: {
            kind: 'page',
            messages: result.data.messages,
            nextSeq: result.data.nextSeq,
            hasMore: result.data.hasMore,
          },
        });
      } else {
        dispatch({ type: 'chat', event: { kind: 'loading', loading: false } });
      }
    },
    [api, dispatch],
  );
  loadChatRef.current = loadChat;

  const deliverChat = useCallback(
    async (clientMessageId: string, text: string): Promise<void> => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      const result = await api.sendChat(roomId, { clientMessageId, text });
      if (result.ok) {
        dispatch({
          type: 'chat',
          event: { kind: 'send-accepted', clientMessageId, message: result.data },
        });
      } else if (result.error.code === 'E_NETWORK') {
        dispatch({
          type: 'chat',
          event: { kind: 'send-unknown', clientMessageId, error: noticeFrom(result.error) },
        });
      } else {
        dispatch({
          type: 'chat',
          event: { kind: 'send-rejected', clientMessageId, error: noticeFrom(result.error) },
        });
      }
    },
    [api, dispatch],
  );

  const sendChat = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      const clientMessageId = newChatId();
      dispatch({ type: 'chat', event: { kind: 'local-send', clientMessageId, text: trimmed } });
      await deliverChat(clientMessageId, trimmed);
    },
    [deliverChat, dispatch],
  );

  const retryChat = useCallback(
    async (clientMessageId: string): Promise<void> => {
      const entry = stateRef.current.chat.entries.find(
        (candidate) => candidate.clientMessageId === clientMessageId,
      );
      if (!entry) return;
      dispatch({ type: 'chat', event: { kind: 'retry-send', clientMessageId } });
      await deliverChat(clientMessageId, entry.text);
    },
    [deliverChat, dispatch],
  );

  const setChatDraft = useCallback(
    (text: string): void => {
      dispatch({ type: 'chat', event: { kind: 'draft', text } });
    },
    [dispatch],
  );

  const toggleMute = useCallback(
    (playerId: string): void => {
      const muted = stateRef.current.chat.muted.includes(playerId);
      dispatch({ type: 'chat', event: { kind: muted ? 'unmute' : 'mute', playerId } });
      const next = muted
        ? stateRef.current.chat.muted.filter((id) => id !== playerId)
        : [...stateRef.current.chat.muted, playerId];
      writeStoredMutes(storage, next);
    },
    [dispatch, storage],
  );

  // ---------------------------------------------------------------------
  // selection
  // ---------------------------------------------------------------------

  const selectTarget = useCallback(
    (selection: Selection): void => {
      dispatch({ type: 'selection', selection });
    },
    [dispatch],
  );

  const cancelSelection = useCallback((): void => {
    dispatch({ type: 'selection', selection: EMPTY_SELECTION });
  }, [dispatch]);

  const confirmSelection = useCallback(async (): Promise<void> => {
    const { selection } = stateRef.current;
    if (!selection.commandType || selection.index === null || !selection.kind) return;
    const payload: CommandPayload =
      selection.kind === 'vertex'
        ? { type: selection.commandType, vertex: selection.index }
        : selection.kind === 'edge'
          ? { type: selection.commandType, edge: selection.index }
          : { type: selection.commandType, hex: selection.index };
    await submitCommand(payload, selection.labelId ?? selection.commandType);
  }, [submitCommand]);

  const setDrawer = useCallback(
    (drawer: DrawerPanel): void => {
      dispatch({ type: 'drawer', drawer });
    },
    [dispatch],
  );

  const actions = useMemo<TableActions>(
    () => ({
      bootstrap,
      setLocale,
      submitNickname,
      refreshRooms,
      createRoom,
      joinRoom,
      takeSeat,
      setReady,
      updateSettings,
      proposePolicy,
      respondPolicy,
      startGame,
      leaveRoom,
      closeRoom,
      openGame,
      refreshSnapshot,
      submitCommand,
      resolveCommand,
      retryCommand,
      clearCommand,
      saveGame,
      suspendGame,
      resumeTable,
      loadChat,
      sendChat,
      retryChat,
      setChatDraft,
      toggleMute,
      selectTarget,
      cancelSelection,
      confirmSelection,
      setDrawer,
    }),
    [
      bootstrap,
      setLocale,
      submitNickname,
      refreshRooms,
      createRoom,
      joinRoom,
      takeSeat,
      setReady,
      updateSettings,
      proposePolicy,
      respondPolicy,
      startGame,
      leaveRoom,
      closeRoom,
      openGame,
      refreshSnapshot,
      submitCommand,
      resolveCommand,
      retryCommand,
      clearCommand,
      saveGame,
      suspendGame,
      resumeTable,
      loadChat,
      sendChat,
      retryChat,
      setChatDraft,
      toggleMute,
      selectTarget,
      cancelSelection,
      confirmSelection,
      setDrawer,
    ],
  );

  // ---------------------------------------------------------------------
  // websocket
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (options.connectSocket === false) return;
    const client = new SocketClient({
      url: socketUrl,
      ...(options.socketFactory ? { factory: options.socketFactory } : {}),
      onStatus: (status) => {
        dispatch({ type: 'socket-status', status });
        if (status === 'open') dispatch({ type: 'connection', connection: 'online' });
        if (status === 'closed') dispatch({ type: 'connection', connection: 'reconnecting' });
        if (status === 'open') void refreshGame('reconnect');
      },
      onMessage: (message) => {
        switch (message.type) {
          case 'room':
            dispatch({ type: 'room', room: message.payload });
            break;
          case 'snapshot':
            receiveSnapshot(message.payload, syncGenerationRef.current, 'snapshot');
            break;
          case 'events': {
            const payload = message.payload as { gameId: string; revision: number; events: GameEvent[] };
            const current = stateRef.current.game;
            if (!current || current.gameId !== payload.gameId) break;
            const lastSeq = Math.max(current.view.seq, ...current.view.events.map((event) => event.seq));
            const incoming = [...new Set(payload.events.map((event) => event.seq))]
              .filter((seq) => seq > lastSeq).sort((a, b) => a - b);
            if (incoming.some((seq, index) => seq !== lastSeq + index + 1)) {
              // Gap: the ordering guarantee says refetch, never patch.
              void refreshGame('gap');
            } else {
              dispatch({ type: 'events', gameId: payload.gameId, revision: payload.revision, events: payload.events });
            }
            break;
          }
          case 'chat': {
            const messageView = message.payload as ChatMessageView;
            dispatch({
              type: 'chat',
              event: {
                kind: 'server-message',
                message: messageView,
                selfId: stateRef.current.session?.id ?? null,
              },
            });
            break;
          }
          case 'presence':
            if (stateRef.current.room) {
              dispatch({
                type: 'room',
                room: {
                  ...stateRef.current.room,
                  members: (message.payload as { members: RoomView['members'] }).members,
                },
              });
            }
            break;
          case 'notice':
            dispatch({ type: 'toast', notice: message.payload });
            break;
          case 'error':
            dispatch({ type: 'toast', notice: message.payload });
            break;
          default:
            break;
        }
      },
    });
    socketRef.current = client;
    client.connect();
    return () => {
      client.close();
      socketRef.current = null;
    };
  }, [options.connectSocket, options.socketFactory, refreshGame, receiveSnapshot, socketUrl, dispatch]);

  useEffect(() => {
    const client = socketRef.current;
    if (!client) return;
    if (currentRoomId || currentGameId) {
      client.subscribe({
        ...(currentRoomId ? { roomId: currentRoomId } : {}),
        ...(currentGameId ? { gameId: currentGameId } : {}),
      });
    }
  }, [currentRoomId, currentGameId]);

  // A room that is already playing (join, reconnect, resume) must pull the
  // authoritative projection rather than assume the client has one.
  const roomGameId = state.room?.gameId ?? null;
  useEffect(() => {
    if (!roomGameId) return;
    if (stateRef.current.game?.gameId === roomGameId) return;
    void openGame(roomGameId);
  }, [roomGameId, openGame]);

  return { state, dispatch, actions };
}

export type { ApiResult, Notice };
