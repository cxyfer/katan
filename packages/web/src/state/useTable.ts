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
  BotLevel,
  ChatMessageView,
  CommandReceipt,
  GameEvent,
  GameSnapshot,
  LeaveRoomResult,
  Locale,
  Notice,
  RoomPolicy,
  RoomView,
  ServerConfigView,
} from '@catan/protocol';
import type { CatanApi, CreateRoomBody, RoomQuery, RoomSettingsBody } from '../api/client.ts';
import { FORCED_CLOSE_WAIT_MS, SocketClient, type SocketFactory } from '../api/socket.ts';
import { detectLocale } from '../i18n/index.ts';
import { bootAssetsFailed, type BootStepId } from './boot.ts';
import { newChatId, newCommandId, newRequestId } from './ids.ts';
import {
  browserStorage,
  readStoredLocale,
  readStoredMutes,
  readStoredNickname,
  readStoredTradeAutoDecline,
  writeStoredLocale,
  writeStoredMutes,
  writeStoredNickname,
  writeStoredTradeAutoDecline,
  type StorageLike,
} from './session.ts';
import { DICE_PRESENTATION_DURATION_MS } from '../board/animation.ts';
import {
  awaitingProjection,
  EMPTY_SELECTION,
  initialTableState,
  tableReducer,
  type DrawerPanel,
  type GameSyncBoundary,
  type GameSyncCause,
  type DevCardChoice,
  type SaveState,
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
  /** 等待 `/leave` 的上限（毫秒），預設 `LEAVE_TIMEOUT_MS`；測試注入較短的值。 */
  leaveTimeoutMs?: number;
  /** 等待伺服器確認取消訂閱的上限（毫秒），預設 `UNSUBSCRIBE_ACK_TIMEOUT_MS`；測試注入較短的值。 */
  unsubscribeTimeoutMs?: number;
  /** 取消訂閱逾時而強制關閉連線後，等它關閉的上限（毫秒），預設 `FORCED_CLOSE_WAIT_MS`；測試注入較短的值。 */
  closeWaitMs?: number;
}

/** `/leave` 久久沒有回應時放棄等待，離開流程改走失敗路徑，使用者才不會永遠卡在處理中。 */
export const LEAVE_TIMEOUT_MS = 10_000;

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
  /** 加入一個電腦席位；成功回傳 null，失敗回傳可顯示的錯誤。 */
  addBot(level: BotLevel, name?: string): Promise<ApiError | null>;
  removeBot(playerId: string): Promise<void>;
  proposePolicy(policy: RoomPolicy): Promise<void>;
  respondPolicy(proposalId: string, approve: boolean): Promise<void>;
  startGame(): Promise<void>;
  leaveRoom(): Promise<void>;
  closeRoom(): Promise<void>;
  openGame(gameId: string): Promise<void>;
  refreshSnapshot(): Promise<void>;
  submitCommand(command: CommandPayload, labelId: string): Promise<CommandReceipt | null>;
  resolveCommand(): Promise<void>;
  retryCommand(): Promise<void>;
  clearCommand(): void;
  saveGame(): Promise<void>;
  suspendGame(): Promise<void>;
  /** 提議（單人桌即直接）以無勝者結束對局；成功回傳 true，失敗已以 toast 回報。 */
  endGame(): Promise<boolean>;
  /** 對既有的結束對局提案表態；提案已失效時重新抓房間並提示。 */
  respondAbandon(proposalId: string, approve: boolean): Promise<void>;
  /** 明確退出（投降）；成功回傳 true，失敗已以 toast 回報。 */
  withdrawGame(): Promise<boolean>;
  /** 撤回退出，回到對局。 */
  retractWithdrawal(): Promise<boolean>;
  resumeTable(ready: boolean): Promise<void>;
  loadChat(roomId?: string, before?: number): Promise<void>;
  sendChat(text: string): Promise<void>;
  retryChat(clientMessageId: string): Promise<void>;
  setChatDraft(text: string): void;
  toggleMute(playerId: string): void;
  setTradeAutoDecline(enabled: boolean): void;
  selectTarget(selection: Selection): void;
  setDevCardChoice(choice: DevCardChoice | null): void;
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

/** 訊息所屬的房間或對局是否為已離開的那一個。 */
function isDeparted(
  departed: { roomId: string | null; gameId: string | null } | null,
  ids: { roomId?: string | null; gameId?: string | null },
): boolean {
  if (!departed) return false;
  return (ids.roomId != null && ids.roomId === departed.roomId)
    || (ids.gameId != null && ids.gameId === departed.gameId);
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
  /** A newer room-list request invalidates every response still in flight. */
  const roomListRequestRef = useRef(0);
  /**
   * 刻意離開（保存並離開、退出、離開房間）後，伺服器處理取消訂閱前仍可能推送該房或該局的訊息；
   * 這些訊息一律忽略，直到使用者重新進入（resume、再加入同一房）才清除。
   */
  const departedRef = useRef<{ roomId: string | null; gameId: string | null } | null>(null);
  /** Late-bound so `joinRoom` can fetch history without a declaration cycle. */
  const loadChatRef = useRef<TableActions['loadChat'] | null>(null);

  // 從首頁「繼續對局」進入時只有投影、還沒有房間資料；以投影的 roomId 訂閱，
  // 伺服器才會登記這個連線並推送房間與投影（電腦對手也以此判斷有人在場）。
  const currentRoomId = state.room?.id ?? state.game?.roomId ?? null;
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

  // 事件先到而投影遲遲未到（延遲或遺失）時，等擲骰演出時間過後主動補抓投影，
  // 讓暫停的後續操作不會一直卡住；只更新投影，不改動指令狀態。
  const projectionBehind = awaitingProjection(state);
  useEffect(() => {
    if (!projectionBehind) return;
    const timer = globalThis.setTimeout(() => {
      const generation = syncGenerationRef.current;
      const gameId = gameIdRef.current;
      if (!gameId || !awaitingProjection(stateRef.current)) return;
      void api.getGame(gameId).then((result) => {
        if (!result.ok || generation !== syncGenerationRef.current || gameId !== gameIdRef.current) return;
        receiveSnapshot(result.data, generation, 'refresh');
      });
    }, DICE_PRESENTATION_DURATION_MS);
    return () => globalThis.clearTimeout(timer);
  }, [projectionBehind, api, receiveSnapshot]);

  const openGame = useCallback(
    async (gameId: string): Promise<void> => {
      // 從首頁 resume：重新進入這一局，之後的推送要正常接收。
      if (departedRef.current?.gameId === gameId) departedRef.current = null;
      gameIdRef.current = gameId;
      const generation = beginGameSync('open');
      const result = await api.getGame(gameId);
      if (result.ok) {
        if (generation !== syncGenerationRef.current || gameId !== gameIdRef.current) return;
        receiveSnapshot(result.data, generation, 'refresh');
        if (result.data.roomId) {
          roomIdRef.current = result.data.roomId;
          if (departedRef.current?.roomId === result.data.roomId) departedRef.current = null;
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
      const request = roomListRequestRef.current + 1;
      roomListRequestRef.current = request;
      dispatch({ type: 'rooms-request' });
      const result = await api.listRooms(query ?? stateRef.current.roomQuery);
      // A filter change may start a second request while this one is in
      // flight; only the newest request may update the visible list.
      if (request !== roomListRequestRef.current) return;
      if (result.ok) dispatch({ type: 'rooms', rooms: result.data.rooms });
      else dispatch({ type: 'rooms-error', error: noticeFrom(result.error) });
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
    const checkAssets = () => {
      if (bootAssetsFailed()) dispatch({ type: 'boot-step', step: 'assets', status: 'failed' });
    };
    checkAssets();
    // 每個請求各自結束時回報，啟動畫面才看得出卡在哪一步。
    const track = <T extends { ok: boolean }>(step: BootStepId, request: Promise<T>): Promise<T> =>
      request.then((result) => {
        dispatch({ type: 'boot-step', step, status: result.ok ? 'done' : 'failed' });
        return result;
      });
    const [configResult, sessionResult, profilesResult] = await Promise.all([
      track('config', api.getConfig()),
      track('session', api.getSession()).then((result) => {
        if (!(result.ok && result.data.player)) dispatch({ type: 'boot-step', step: 'games', status: 'skipped' });
        return result;
      }),
      track('profiles', api.listProfiles()),
    ]);
    const knownSession = sessionResult.ok ? sessionResult.data.player : null;
    const gamesResult = knownSession ? await track('games', api.listGames()) : null;
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
          // 讀不到伺服器設定時不提供加入電腦，避免送出必然被拒的請求。
          bots: { enabled: false, levels: [] },
        };
    // 樣式表可能在請求期間才失敗；進入牌桌前再確認一次。
    checkAssets();
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
    dispatch({ type: 'trade-auto-decline', value: readStoredTradeAutoDecline(storage) });
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
        if (departedRef.current?.roomId === result.data.id) departedRef.current = null;
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

  const addBot = useCallback(
    async (level: BotLevel, name?: string): Promise<ApiError | null> => {
      const roomId = roomIdRef.current;
      if (!roomId) return null;
      const trimmed = name?.trim();
      const result = await api.addBot(roomId, {
        level,
        ...(trimmed ? { name: trimmed } : {}),
      });
      applyRoom(result, 'bots');
      return result.ok ? null : result.error;
    },
    [api, applyRoom],
  );

  const removeBot = useCallback(
    async (playerId: string): Promise<void> => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      applyRoom(await api.removeBot(roomId, playerId), 'bots');
    },
    [api, applyRoom],
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

  const closeWaitMs = options.closeWaitMs ?? FORCED_CLOSE_WAIT_MS;

  /** 目前牌桌的房間與對局 id（離開流程用來記錄與還原）。 */
  const currentTableIds = useCallback((): { roomId: string | null; gameId: string | null } => {
    const current = stateRef.current;
    return {
      roomId: roomIdRef.current ?? current.room?.id ?? current.game?.roomId ?? null,
      gameId: gameIdRef.current ?? current.game?.gameId ?? current.room?.gameId ?? null,
    };
  }, []);

  /**
   * 離開流程的第一步：記下已離開的房與局（之後的推送一律忽略），取消訂閱並等伺服器確認。
   * 畫面與本地狀態先不動：必須等伺服器處理完 `/leave`，使用者才可能從首頁重新進入（SPEC §4.6）。
   * 一定要等到取消訂閱的確認（或逾時）才送 `/leave`：連線還在房內時伺服器會把 `/leave` 當成遲到或
   * 重複的請求而忽略（`left: false`）。標記在第一個 await 之前同步設好。
   *
   * 回傳先前的標記（供失敗時還原），以及要帶進 `/leave` 的進房世代 `entryEpoch`：優先用確認裡的值
   * （取消訂閱之後的目前世代）；沒有確認（逾時、未連線、本來沒訂閱）時退回開始離開前房間檢視的
   * `viewerEntryEpoch`；兩者都沒有就不帶（`undefined`）。
   *
   * 取消訂閱逾時時，伺服器可能根本還沒處理它（很慢，或連線半斷而伺服器沒有心跳察覺），連線會一直
   * 被當成在線：`SocketClient` 已強制關閉那條 transport 讓伺服器的 close handler 取消登記（既有的
   * 重連會另開新連線，不會再訂閱）。這裡再最多等 `closeWaitMs` 讓它關閉，`/leave` 才不會搶在 close
   * 之前到而被當成 `present`；等不到（半斷的連線）就照常送。`/leave` 帶著 `entryEpoch`，所以即使
   * 與伺服器處理 close 的時序交錯也不會誤改狀態；最壞是回 `present`，這次刻意離開的房主移轉就退化成
   * 斷線後由寬限計時器處理，不自動重試。
   */
  const beginDeparture = useCallback(
    async (ids: { roomId: string | null; gameId: string | null }) => {
      const previous = departedRef.current;
      // 先記下，之後該房的推送都會被忽略。
      const viewerEntryEpoch = stateRef.current.room?.viewerEntryEpoch;
      departedRef.current = ids;
      const client = socketRef.current;
      const unsubscribed = await client?.unsubscribe();
      if (unsubscribed?.outcome === 'timeout') await client?.whenTransportDropped(closeWaitMs);
      const ackEpoch = unsubscribed?.outcome === 'acked' ? unsubscribed.ack.entryEpoch : null;
      const entryEpoch: number | undefined = ackEpoch ?? viewerEntryEpoch;
      return { previous, entryEpoch };
    },
    [closeWaitMs],
  );

  /** `/leave` 失敗、逾時或被忽略（`left: false`）且要留在原畫面：移除標記並重新訂閱原房間，伺服器會再推送最新狀態。 */
  const abortDeparture = useCallback(
    (previous: { roomId: string | null; gameId: string | null } | null): void => {
      departedRef.current = previous;
      const { roomId, gameId } = currentTableIds();
      if (roomId || gameId) {
        socketRef.current?.subscribe({
          ...(roomId ? { roomId } : {}),
          ...(gameId ? { gameId } : {}),
        });
      }
    },
    [currentTableIds],
  );

  /** 離開牌桌的本地清理：清空 id 與畫面狀態並回首頁（訂閱 effect 隨之確認已取消訂閱）。 */
  const clearTable = useCallback((): void => {
    roomIdRef.current = null;
    gameIdRef.current = null;
    dispatch({ type: 'room', room: null });
    dispatch({ type: 'snapshot', snapshot: null });
    dispatch({ type: 'screen', screen: 'home' });
  }, [dispatch]);

  const announceHostTransfer = useCallback(
    (hostTransferredTo: string | null): void => {
      if (!hostTransferredTo) return;
      dispatch({ type: 'toast', notice: localNotice('lobby.hostTransferredTo', { player: hostTransferredTo }) });
    },
    [dispatch],
  );

  const refreshResumable = useCallback(async (): Promise<void> => {
    const games = await api.listGames();
    if (games.ok) dispatch({ type: 'games', games: games.data.games });
  }, [api, dispatch]);

  /** 進行中的離開流程（`leaveRoom`、保存並離開、退出共用）；重複觸發時共用同一次，不重送 `/leave`。 */
  const leavingRef = useRef<Promise<void> | null>(null);
  const singleFlightLeave = useCallback((run: () => Promise<void>): Promise<void> => {
    if (leavingRef.current) return leavingRef.current;
    const pending = run().finally(() => {
      leavingRef.current = null;
    });
    leavingRef.current = pending;
    return pending;
  }, []);

  const leaveTimeoutMs = options.leaveTimeoutMs ?? LEAVE_TIMEOUT_MS;
  /**
   * 送出 `/leave`（有進房世代就帶上）並最多等 `leaveTimeoutMs`；逾時回傳 `'timeout'`。逾時後才抵達的回應
   * 沒有任何流程在等它，所以不會改動畫面。逾時後這個請求仍可能稍後才在伺服器執行，但那時使用者可能已重新
   * 進入：連線還在房內伺服器會忽略它（`reason: 'present'`），離開之後又重新進入過則因世代較舊而忽略
   * （`reason: 'stale'`），都不會動到已重新進入的座位或房主。
   */
  const requestLeave = useCallback(
    async (roomId: string, entryEpoch: number | undefined): Promise<ApiResult<LeaveRoomResult> | 'timeout'> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = globalThis.setTimeout(() => resolve('timeout'), leaveTimeoutMs);
      });
      try {
        const request = api.leaveRoom(roomId, entryEpoch === undefined ? undefined : { entryEpoch });
        return await Promise.race([request, timeout]);
      } finally {
        globalThis.clearTimeout(timer);
      }
    },
    [api, leaveTimeoutMs],
  );

  const leaveRoom = useCallback((): Promise<void> => {
    const roomId = roomIdRef.current;
    if (!roomId) return Promise.resolve();
    return singleFlightLeave(async () => {
      const { previous, entryEpoch } = await beginDeparture(currentTableIds());
      const result = await requestLeave(roomId, entryEpoch);
      if (result !== 'timeout' && result.ok && result.data.left) {
        announceHostTransfer(result.data.hostTransferredTo);
        clearTable();
        await refreshResumable();
        return;
      }
      // 還沒離開成功（失敗、逾時，或伺服器忽略了這次離開：`present` 仍有連線在房內、`stale` 期間有過重新進入）：
      // 留在原畫面，恢復訂閱，讓使用者自己決定是否重試。不自動重試：重試可能刪掉另一個分頁剛建立的 membership。
      abortDeparture(previous);
      const notice = result === 'timeout'
        ? localNotice('play.leave.timeoutRoom')
        : result.ok
          ? localNotice('play.leave.stillPresentRoom')
          : noticeFrom(result.error);
      dispatch({ type: 'toast', notice });
    });
  }, [dispatch, singleFlightLeave, announceHostTransfer, beginDeparture, abortDeparture, clearTable, currentTableIds, refreshResumable, requestLeave]);

  /**
   * 保存並離開、退出之後回首頁（SPEC §4.6：刻意離開，座位保留）。先記錄、取消訂閱並等確認，再等 `/leave`
   * 完成（不論成敗、逾時或被忽略，存檔或退出都已成功）才清掉牌桌回首頁，所以使用者不可能在 `/leave`
   * 完成前從首頁重新進入；失敗、逾時，或伺服器忽略離開（座位仍由其他連線使用中，或期間另一個分頁重新進入過）
   * 只以 toast 提示，不自動重試。
   */
  const leaveToHome = useCallback(
    (): Promise<void> =>
      singleFlightLeave(async () => {
        const ids = currentTableIds();
        const { entryEpoch } = await beginDeparture(ids);
        if (ids.roomId) {
          const result = await requestLeave(ids.roomId, entryEpoch);
          if (result === 'timeout') dispatch({ type: 'toast', notice: localNotice('play.leave.timeoutHome') });
          else if (!result.ok) dispatch({ type: 'toast', notice: noticeFrom(result.error) });
          else if (!result.data.left) dispatch({ type: 'toast', notice: localNotice('play.leave.stillPresentHome') });
          else announceHostTransfer(result.data.hostTransferredTo);
        }
        clearTable();
        await refreshResumable();
      }),
    [dispatch, singleFlightLeave, announceHostTransfer, beginDeparture, clearTable, currentTableIds, refreshResumable, requestLeave],
  );

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
    async (
      commandId: string,
      command: CommandPayload,
      expectedRevision: number,
    ): Promise<CommandReceipt | null> => {
      const gameId = gameIdRef.current;
      if (!gameId) return null;
      const result = await api.sendCommand(gameId, {
        commandId,
        expectedRevision,
        command,
      });
      if (result.ok) {
        dispatch({ type: 'command', event: { kind: 'receipt', receipt: result.data } });
        const notice = receiptNotice(result.data);
        if (notice) {
          // 拒絕原因與「再試一次」由指令回執呈現；不再另發內容重複的 toast。
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
        return result.data;
      } else {
        dispatch({
          type: 'command',
          event: { kind: 'transport-failure', error: noticeFrom(result.error) },
        });
        dispatch({ type: 'connection', connection: 'offline' });
        dispatch({ type: 'toast', notice: noticeFrom(result.error) });
        return null;
      }
    },
    [api, dispatch, refreshAfterAccepted],
  );

  const submitCommand = useCallback(
    async (command: CommandPayload, labelId: string): Promise<CommandReceipt | null> => {
      const current = stateRef.current;
      if (blocksNewCommands(current.command)) return null;
      const snapshot: GameSnapshot | null = current.game;
      if (!snapshot) return null;
      // 所有指令入口（動作列、交易、兌換、發展卡、棋盤）共用：點數揭曉前、
      // 或投影尚未追上已知事件時，不依過時畫面送出後續指令。
      if (current.dicePresenting) {
        dispatch({ type: 'toast', notice: localNotice('play.disabled.rolling') });
        return null;
      }
      if (awaitingProjection(current)) {
        dispatch({ type: 'toast', notice: localNotice('play.disabled.syncing') });
        return null;
      }
      if (current.activeElsewhere) {
        dispatch({ type: 'toast', notice: localNotice('app.activeInAnotherTab') });
        return null;
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
      return runCommand(commandId, command, snapshot.revision);
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
    if (!gameId || leavingRef.current) return;
    const requestId = newRequestId();
    dispatch({ type: 'save', state: { status: 'pending', requestId } });
    const result = await api.saveGame(gameId, requestId);
    if (result.ok && result.data.outcome === 'saved') {
      const saved: SaveState = {
        status: 'saved',
        requestId,
        savedAt: result.data.savedAt,
        revision: result.data.revision,
      };
      // 存檔已確認，但離開要等 `/leave` 完成；這段期間維持「保存中」，按鈕保持停用。
      await leaveToHome();
      dispatch({ type: 'save', state: saved });
    } else {
      const error = result.ok ? (result.data.error ?? null) : noticeFrom(result.error);
      dispatch({ type: 'save', state: { status: 'failed', requestId, error } });
    }
  }, [api, dispatch, leaveToHome]);

  const suspendGame = useCallback(async (): Promise<void> => {
    const gameId = gameIdRef.current;
    if (!gameId) return;
    const result = await api.suspendGame(gameId);
    if (result.ok) applyRoom(result, 'suspend');
    else dispatch({ type: 'toast', notice: noticeFrom(result.error) });
  }, [api, applyRoom, dispatch]);

  // ---------------------------------------------------------------------
  // withdraw / end the game (SPEC §4.6)
  // ---------------------------------------------------------------------

  /** 提案、表態或退出後房間狀態會變；回應不含 RoomView，所以重新抓取（失敗時靜默，WebSocket 仍會推送）。 */
  const refreshRoom = useCallback(async (): Promise<void> => {
    const roomId = roomIdRef.current;
    if (!roomId) return;
    const result = await api.getRoom(roomId);
    // 回應回來前已離開這個房間（保存並離開、退出）就不要再把它拉回來。
    if (result.ok && roomIdRef.current === roomId) dispatch({ type: 'room', room: result.data });
  }, [api, dispatch]);

  /** 對局已結束：以權威的房間與投影切到結果畫面，並刷新已不再可恢復的清單。 */
  const showEndedGame = useCallback(async (): Promise<void> => {
    await refreshRoom();
    await refreshGame('command');
    const games = await api.listGames();
    if (games.ok) dispatch({ type: 'games', games: games.data.games });
  }, [api, dispatch, refreshRoom, refreshGame]);

  const endGame = useCallback(async (): Promise<boolean> => {
    const gameId = gameIdRef.current;
    if (!gameId) return false;
    const result = await api.abandonGame(gameId);
    if (!result.ok) {
      dispatch({ type: 'toast', notice: noticeFrom(result.error) });
      return false;
    }
    if (result.data.abandoned) await showEndedGame();
    else await refreshRoom();
    return true;
  }, [api, dispatch, refreshRoom, showEndedGame]);

  const respondAbandon = useCallback(
    async (proposalId: string, approve: boolean): Promise<void> => {
      const gameId = gameIdRef.current;
      if (!gameId) return;
      const result = await api.abandonGame(gameId, { proposalId, approve });
      if (result.ok) {
        if (result.data.abandoned) await showEndedGame();
        else await refreshRoom();
      } else if (result.error.code === 'E_NO_PROPOSAL') {
        // 有人撤回退出或重新連線會讓提案失效：視為投票已取消。
        dispatch({ type: 'toast', notice: localNotice('play.abandon.cancelled') });
        await refreshRoom();
      } else {
        dispatch({ type: 'toast', notice: noticeFrom(result.error) });
      }
    },
    [api, dispatch, refreshRoom, showEndedGame],
  );

  const setWithdrawn = useCallback(
    async (withdrawn: boolean): Promise<boolean> => {
      const gameId = gameIdRef.current;
      if (!gameId || leavingRef.current) return false;
      const result = await api.withdrawGame(gameId, withdrawn);
      if (!result.ok) {
        dispatch({ type: 'toast', notice: noticeFrom(result.error) });
        return false;
      }
      if (result.data.abandoned) {
        await showEndedGame();
      } else if (withdrawn) {
        // 比照 saveGame：座位保留，離開牌桌回首頁並刷新可恢復清單。
        await leaveToHome();
      } else {
        await refreshRoom();
      }
      return true;
    },
    [api, dispatch, refreshRoom, showEndedGame, leaveToHome],
  );

  const withdrawGame = useCallback(() => setWithdrawn(true), [setWithdrawn]);
  const retractWithdrawal = useCallback(() => setWithdrawn(false), [setWithdrawn]);

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

  const setTradeAutoDecline = useCallback(
    (enabled: boolean): void => {
      dispatch({ type: 'trade-auto-decline', value: enabled });
      writeStoredTradeAutoDecline(storage, enabled);
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

  const setDevCardChoice = useCallback(
    (choice: DevCardChoice | null): void => {
      dispatch({ type: 'dev-card-choice', choice });
    },
    [dispatch],
  );

  const cancelSelection = useCallback((): void => {
    dispatch({ type: 'selection', selection: EMPTY_SELECTION });
  }, [dispatch]);

  const confirmSelection = useCallback(async (): Promise<void> => {
    const { selection } = stateRef.current;
    if (!selection.commandType || selection.index === null || !selection.kind) return;
    const field = selection.field ?? (selection.kind === 'vertex' ? 'vertex' : selection.kind === 'edge' ? 'edge' : 'hex');
    const payload: CommandPayload = { ...selection.extra, ...selection.params, type: selection.commandType, [field]: selection.index };
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
      addBot,
      removeBot,
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
      endGame,
      respondAbandon,
      withdrawGame,
      retractWithdrawal,
      resumeTable,
      loadChat,
      sendChat,
      retryChat,
      setChatDraft,
      toggleMute,
      setTradeAutoDecline,
      selectTarget,
      setDevCardChoice,
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
      addBot,
      removeBot,
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
      endGame,
      respondAbandon,
      withdrawGame,
      retractWithdrawal,
      resumeTable,
      loadChat,
      sendChat,
      retryChat,
      setChatDraft,
      toggleMute,
      setTradeAutoDecline,
      selectTarget,
      setDevCardChoice,
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
      ...(options.unsubscribeTimeoutMs === undefined ? {} : { unsubscribeTimeoutMs: options.unsubscribeTimeoutMs }),
      onStatus: (status) => {
        dispatch({ type: 'socket-status', status });
        if (status === 'open') dispatch({ type: 'connection', connection: 'online' });
        if (status === 'closed') dispatch({ type: 'connection', connection: 'reconnecting' });
        if (status === 'open') void refreshGame('reconnect');
      },
      onMessage: (message) => {
        switch (message.type) {
          case 'room':
            if (isDeparted(departedRef.current, { roomId: message.payload.id, gameId: message.payload.gameId })) break;
            dispatch({ type: 'room', room: message.payload });
            break;
          case 'snapshot':
            if (isDeparted(departedRef.current, { roomId: message.payload.roomId, gameId: message.payload.gameId })) break;
            receiveSnapshot(message.payload, syncGenerationRef.current, 'snapshot');
            break;
          case 'events': {
            const payload = message.payload as { gameId: string; revision: number; events: GameEvent[] };
            if (isDeparted(departedRef.current, { gameId: payload.gameId })) break;
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
            if (isDeparted(departedRef.current, { roomId: message.payload.roomId })) break;
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
  }, [options.connectSocket, options.socketFactory, options.unsubscribeTimeoutMs, refreshGame, receiveSnapshot, socketUrl, dispatch]);

  useEffect(() => {
    const client = socketRef.current;
    if (!client) return;
    if (currentRoomId || currentGameId) {
      client.subscribe({
        ...(currentRoomId ? { roomId: currentRoomId } : {}),
        ...(currentGameId ? { gameId: currentGameId } : {}),
      });
    } else {
      // 回到首頁的任何路徑（保存並離開、退出、離開房間）都取消訂閱，伺服器才會把這條連線視為離線。
      // 離開流程已先取消並等過確認，這裡通常是 `idle`（沒送任何訊息）；進行中的取消訂閱會被共用。
      void client.unsubscribe();
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
