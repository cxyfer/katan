/**
 * Game coordination: serialised command handling, durable receipts, save
 * barriers, suspension and resume.
 *
 * Every accepted transition is persisted atomically together with its ordered
 * events and command receipt before anything is published (§7.2).
 */

import {
  abandonGame,
  actionHints,
  applyCommand,
  createGame,
  projectEvent,
  projectGame,
  requireProfile,
  secureRng,
  shuffle,
  suspendNegotiation,
  type Command,
  type GameEvent,
  type GameState,
  type Rng,
} from '@catan/rules';
import type {
  AbandonConsentResult,
  AbandonProposeResult,
  CommandReceipt,
  CommandRequest,
  GameSnapshot,
  Notice,
  ResumableGameView,
  ResumeReadyResult,
  RoomStatus,
  SaveReceipt,
  SuspendConsentResult,
  SuspendProposeResult,
  WithdrawResult,
} from '@catan/protocol';
import type { ServerConfig } from './config.ts';
import {
  digestPayload,
  newId,
  type GameRow,
  type IdleCursor,
  type IdleGameRow,
  type MemberRow,
  type MembershipRow,
  type Repository,
  type RoomRow,
} from './db.ts';
import { ServiceError, type RoomService } from './rooms.ts';
import { humanMembers, isBotMember } from './bot-seats.ts';

const RECEIPT_EVENT_LIMIT = 200;
const DAY_MS = 86_400_000;
/** 保留掃描每一批最多處理的對局數；積壓時由排程器短延遲後接續下一批。 */
export const RETENTION_BATCH_SIZE = 100;
/** 保留終止持續失敗的對局，先等這麼久再重試；每次失敗加倍，上限一天。 */
const RETENTION_RETRY_BASE_MS = 10 * 60_000;
const RETENTION_RETRY_MAX_MS = 24 * 3_600_000;
/** 記憶體內追蹤的失敗對局上限；滿了以後只保留退避最晚到期的這麼多筆。 */
const RETENTION_FAILURE_TRACK_LIMIT = 1_000;

/**
 * Decides the in-game seat order. `random` draws once at start with the same
 * server-side generator that builds the board; `join` keeps the lobby order.
 */
export function orderForGame<T>(players: readonly T[], orderMode: string, rng: Rng): T[] {
  return orderMode === 'random' ? shuffle(players, rng) : players.slice();
}

/** 一筆已提交指令的摘要，供 Bot 排程器喚醒與計時。 */
export interface CommitNotice {
  gameId: string;
  roomId: string;
  revision: number;
  actorId: string;
  commandId: string;
  events: GameEvent[];
  /** 這筆指令讓遊戲結束。 */
  finished: boolean;
}

export type GameLifecycleChange = 'resumed' | 'suspended' | 'abandoned';

export interface GameCoordinatorDeps {
  repo: Repository;
  rooms: RoomService;
  config: ServerConfig;
  /** 指令提交並推送後同步呼叫；實作只能排程，不可等待任何遊戲鎖。 */
  onCommitted?(notice: CommitNotice): void;
  /** 暫停、恢復或放棄生效後同步呼叫。 */
  onLifecycle?(gameId: string, change: GameLifecycleChange): void;
  /** 保留掃描的日誌輸出；未提供時不記錄。 */
  log?(level: 'info' | 'warn', message: string, meta?: unknown): void;
}

/** 一批保留掃描的結果。 */
export interface RetentionSweepResult {
  /** 本批終止的對局 id。 */
  expired: string[];
  /** 本批單筆失敗（已記 warn）的對局 id。 */
  failed: string[];
  /** 本批候選數量達到上限，可能還有積壓。 */
  full: boolean;
}

/**
 * 放棄的缺席條件（SPEC §4.6）：只看真人席位；Bot 永遠不缺席。其他席位全是
 * Bot 時，唯一的真人不需要缺席條件也能結束這局。
 */
function abandonmentEligible(members: readonly MemberRow[]): boolean {
  const humans = humanMembers(members);
  if (humans.length === 1) return true;
  return humans.some((member) => member.connected !== 1 || member.withdrawn === 1);
}

/**
 * 放棄的投票者：連線中且未退出的真人。退出視同同意，不需要再投票；Bot 不投票。
 */
function abandonmentVoters<T extends MemberRow>(members: readonly T[]): T[] {
  return humanMembers(members).filter((member) => member.connected === 1 && member.withdrawn !== 1);
}

export class GameCoordinator {
  private readonly locks = new Map<string, Promise<unknown>>();
  /** 保留終止失敗的對局與下次可重試的時間（只存在記憶體，重啟後重新計算）。 */
  private readonly retentionFailures = new Map<string, { failures: number; retryAt: number }>();

  constructor(private readonly deps: GameCoordinatorDeps) {}

  private get repo(): Repository {
    return this.deps.repo;
  }

  /** Serialises work per game so concurrent handlers cannot race. */
  private withLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(gameId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.locks.set(
      gameId,
      next.catch(() => undefined),
    );
    return next;
  }

  // -- creation ------------------------------------------------------------

  async startGame(room: RoomRow, playerIds: string[]): Promise<string> {
    const profile = requireProfile(room.profile_id);
    const players: { id: string; nickname: string; color: 'red' }[] = [];
    for (const playerId of playerIds) {
      const guest = await this.repo.findGuest(playerId);
      players.push({
        id: playerId,
        nickname: guest?.nickname ?? 'player',
        color: 'red' as const,
      });
    }
    // Colours and seats come from the lobby membership, not from the client.
    const memberships = await this.repo.listMemberships(room.id);
    const ordered = memberships
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((membership) => {
        const guestIndex = players.findIndex((player) => player.id === membership.player_id);
        return {
          id: membership.player_id,
          nickname: players[guestIndex]?.nickname ?? 'player',
          color: membership.color as never,
        };
      });

    const rng = secureRng();
    const seated = orderForGame(ordered, room.order_mode, rng);
    const state = createGame({
      profileId: profile.id,
      players: seated,
      setupMode: room.setup_mode as 'fixed' | 'variable',
      rng,
    });
    const gameId = newId('game');
    const now = new Date().toISOString();
    await this.repo.transaction(async () => {
      await this.repo.insertGame({
        id: gameId,
        room_id: room.id,
        profile_id: profile.id,
        engine_version: state.engineVersion,
        state_json: JSON.stringify(state),
        revision: 1,
        status: 'playing',
        pause_reason: null,
        result_json: null,
        created_at: now,
        updated_at: now,
      });
      await this.repo.appendEvents(gameId, 1, state.log);
      // 隨機順序會改變遊戲座位；聊天與房間檢視都讀 membership.seat，
      // 因此把抽出的順序持久化，避免同一位玩家在兩個畫面顯示不同座位。
      for (const [seat, player] of seated.entries()) {
        const membership = memberships.find((candidate) => candidate.player_id === player.id);
        if (membership && membership.seat !== seat) {
          await this.repo.updateMembership(room.id, player.id, { seat });
        }
      }
    });
    return gameId;
  }

  // -- reads ---------------------------------------------------------------

  async requireGame(gameId: string): Promise<GameRow> {
    const game = await this.repo.findGame(gameId);
    if (!game) throw new ServiceError('E_GAME_NOT_FOUND', 'error.E_GAME_NOT_FOUND', { gameId }, 404);
    return game;
  }

  /** A player may only read games they hold a seat in. */
  async requireSeat(game: GameRow, playerId: string): Promise<MembershipRow> {
    const membership = await this.repo.findMembership(game.room_id, playerId);
    if (!membership) {
      throw new ServiceError('E_NOT_SEATED', 'error.E_NOT_SEATED', { gameId: game.id }, 403);
    }
    return membership;
  }

  async snapshot(gameId: string, playerId: string): Promise<GameSnapshot> {
    const game = await this.requireGame(gameId);
    await this.requireSeat(game, playerId);
    const state = JSON.parse(game.state_json) as GameState;
    const events = await this.repo.listEvents(gameId, Math.max(0, state.seq - 40), 40);
    const view = projectGame(state, playerId, {
      events,
      hints: actionHints(state, playerId),
    });
    return { gameId, roomId: game.room_id, revision: game.revision, view };
  }

  async events(
    playerId: string,
    gameId: string,
    after: number,
    limit: number,
  ): Promise<{ events: CommandReceipt['events']; revision: number }> {
    const game = await this.requireGame(gameId);
    await this.requireSeat(game, playerId);
    const events = await this.repo.listEvents(gameId, after, Math.min(limit, 500));
    const filtered = events.filter((event) => !event.private || event.private.to.includes(playerId));
    return {
      events: filtered.map((event) => {
        if (!event.private) return event;
        return { seq: event.seq, type: event.type, params: { ...event.params, ...event.private.params } };
      }),
      revision: game.revision,
    };
  }

  async resumableGames(playerId: string): Promise<ResumableGameView[]> {
    const rooms = await this.repo.listRoomsForPlayer(playerId);
    const out: ResumableGameView[] = [];
    for (const room of rooms) {
      if (room.status === 'lobby' || room.status === 'completed' || room.status === 'abandoned') continue;
      const game = await this.repo.findGameByRoom(room.id);
      if (!game) continue;
      const memberships = await this.repo.listMembers(room.id);
      const players = memberships.map((membership) => ({
        playerId: membership.player_id,
        nickname: membership.nickname ?? 'player',
        color: membership.color,
        ...(isBotMember(membership) ? { bot: true } : {}),
      }));
      out.push({
        gameId: game.id,
        roomId: room.id,
        roomCode: room.code,
        profileId: room.profile_id,
        status: room.status as RoomStatus,
        players,
        lastSavedAt: game.updated_at,
        revision: game.revision,
        allSeatsNeeded: players.every((player) => !player.bot),
        withdrawn: memberships.some((membership) => membership.player_id === playerId && membership.withdrawn === 1),
      });
    }
    return out;
  }

  // -- commands ------------------------------------------------------------

  async submit(playerId: string, gameId: string, request: CommandRequest): Promise<CommandReceipt> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      const membership = await this.requireSeat(game, playerId);

      const digest = digestPayload({ command: request.command, expectedRevision: request.expectedRevision });
      const existing = await this.repo.findReceipt(gameId, playerId, request.commandId);
      if (existing) {
        if (existing.payload_digest !== digest) {
          throw new ServiceError('E_COMMAND_ID_REUSED', 'error.E_COMMAND_ID_REUSED', {
            commandId: request.commandId,
          });
        }
        return this.receiptFromRow(existing, playerId);
      }

      const room = await this.repo.findRoom(game.room_id);
      if (room?.status === 'suspended') {
        throw new ServiceError('E_GAME_SUSPENDED', 'error.E_GAME_SUSPENDED', { gameId }, 409);
      }
      if (room?.status === 'completed' || room?.status === 'abandoned') {
        throw new ServiceError('E_GAME_OVER', 'error.E_GAME_OVER', { gameId }, 409);
      }
      // 退出的席位必須先撤回才能行動（§4.6）；已存在的 receipt 仍照常回放。
      if (membership.withdrawn === 1) {
        throw new ServiceError('E_SEAT_WITHDRAWN', 'error.E_SEAT_WITHDRAWN', { gameId }, 409);
      }

      if (request.expectedRevision !== game.revision) {
        const rejection = await this.recordRejection(game, playerId, request, digest, {
          messageId: 'error.E_STALE_REVISION',
          params: { expected: request.expectedRevision, current: game.revision },
        });
        return rejection;
      }

      const state = JSON.parse(game.state_json) as GameState;
      const outcome = applyCommand(state, playerId, request.command as unknown as Command, secureRng());

      if (!outcome.ok) {
        return this.recordRejection(game, playerId, request, digest, {
          messageId: `error.${outcome.error.code}`,
          params: outcome.error.params ?? {},
        });
      }

      const revision = game.revision + 1;
      const events = outcome.events;
      await this.repo.transaction(async () => {
        await this.repo.saveGame(
          gameId,
          outcome.state,
          revision,
          outcome.state.result ? 'completed' : game.status,
          game.pause_reason,
        );
        await this.repo.appendEvents(gameId, revision, events);
        await this.repo.insertReceipt({
          game_id: gameId,
          player_id: playerId,
          command_id: request.commandId,
          payload_digest: digest,
          outcome: 'accepted',
          revision,
          error_json: null,
          events_json: JSON.stringify(events.slice(-RECEIPT_EVENT_LIMIT)),
          created_at: new Date().toISOString(),
        });
      });

      if (outcome.state.result) {
        await this.repo.updateRoom(game.room_id, { status: 'completed' });
      }
      this.publish(game.room_id, gameId, revision, events);
      this.notifyCommitted({
        gameId,
        roomId: game.room_id,
        revision,
        actorId: playerId,
        commandId: request.commandId,
        events,
        finished: !!outcome.state.result,
      });
      return {
        commandId: request.commandId,
        outcome: 'accepted',
        revision,
        events: events.slice(-RECEIPT_EVENT_LIMIT).map((event) => projectEvent(event, playerId)),
      };
    });
  }

  /** 通知失敗不能影響已提交的指令與回應。 */
  private notifyCommitted(notice: CommitNotice): void {
    try {
      this.deps.onCommitted?.(notice);
    } catch {
      // 排程器自行記錄錯誤；指令結果已持久化。
    }
  }

  private notifyLifecycle(gameId: string, change: GameLifecycleChange): void {
    try {
      this.deps.onLifecycle?.(gameId, change);
    } catch {
      // 同上
    }
  }

  private async recordRejection(
    game: GameRow,
    playerId: string,
    request: CommandRequest,
    digest: string,
    error: Notice,
  ): Promise<CommandReceipt> {
    await this.repo.insertReceipt({
      game_id: game.id,
      player_id: playerId,
      command_id: request.commandId,
      payload_digest: digest,
      outcome: 'rejected',
      revision: game.revision,
      error_json: JSON.stringify(error),
      events_json: '[]',
      created_at: new Date().toISOString(),
    });
    return {
      commandId: request.commandId,
      outcome: 'rejected',
      revision: game.revision,
      error,
      events: [],
    };
  }

  private receiptFromRow(row: {
    outcome: string;
    revision: number;
    error_json: string | null;
    events_json: string;
    command_id: string;
  }, playerId: string): CommandReceipt {
    const receipt: CommandReceipt = {
      commandId: row.command_id,
      outcome: row.outcome as 'accepted' | 'rejected',
      revision: row.revision,
      events: (JSON.parse(row.events_json) as GameEvent[]).map((event) => projectEvent(event, playerId)),
    };
    if (row.error_json) receipt.error = JSON.parse(row.error_json) as Notice;
    return receipt;
  }

  /** Pushes a fresh authorised projection to every connected seated player. */
  private publish(roomId: string, gameId: string, revision: number, events: CommandReceipt['events']): void {
    const memberships = this.deps.rooms.connectionsInRoom(roomId);
    const seen = new Set<string>();
    for (const connection of memberships) {
      if (seen.has(connection.playerId)) continue;
      seen.add(connection.playerId);
      void this.snapshot(gameId, connection.playerId)
        .then((snapshot) => {
          this.deps.rooms.sendTo(connection.playerId, { type: 'snapshot', payload: snapshot }, roomId);
        })
        .catch(() => undefined);
    }
    void events;
    void revision;
  }

  // -- save, suspend, resume ----------------------------------------------

  /** Individual save barrier: acknowledges the current committed revision. */
  async save(playerId: string, gameId: string, requestId: string): Promise<SaveReceipt> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      const existing = await this.repo.findSaveReceipt(gameId, playerId, requestId);
      if (existing) {
        return {
          requestId,
          gameId,
          revision: existing.revision,
          savedAt: existing.saved_at,
          outcome: existing.outcome as 'saved' | 'failed',
        };
      }
      const savedAt = new Date().toISOString();
      try {
        await this.repo.transaction(async () => {
          await this.repo.saveGame(gameId, JSON.parse(game.state_json) as GameState, game.revision, game.status, game.pause_reason);
          await this.repo.insertSaveReceipt({
            game_id: gameId,
            player_id: playerId,
            request_id: requestId,
            revision: game.revision,
            outcome: 'saved',
            saved_at: savedAt,
          });
        });
      } catch (error) {
        void error;
        return {
          requestId,
          gameId,
          revision: game.revision,
          savedAt,
          outcome: 'failed',
          error: { messageId: 'error.E_SAVE_FAILED' },
        };
      }
      return { requestId, gameId, revision: game.revision, savedAt, outcome: 'saved' };
    });
  }

  /**
   * 終局的對局（completed／abandoned，或規則狀態已有結果）不可再暫停或恢復，
   * 否則已結束的桌子會被存檔流程改回 suspended／playing（§4.6：第一個有效的
   * 終局轉換勝出）。
   */
  private assertNotTerminal(game: GameRow): void {
    const finished =
      game.status === 'completed' ||
      game.status === 'abandoned' ||
      !!(JSON.parse(game.state_json) as GameState).result;
    if (finished) {
      throw new ServiceError('E_GAME_OVER', 'error.E_GAME_OVER', { gameId: game.id }, 409);
    }
  }

  /** All-seat save/suspend proposal; the table freezes once everyone consents. */
  async proposeSuspend(playerId: string, gameId: string): Promise<SuspendProposeResult> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      this.assertNotTerminal(game);
      // 已暫停的桌子不再開新提案：成立時會重寫存檔並清掉已表示的準備繼續。
      if (game.status === 'suspended') {
        throw new ServiceError('E_GAME_SUSPENDED', 'error.E_GAME_SUSPENDED', { gameId }, 409);
      }
      const existing = await this.repo.findOpenGameProposal(gameId, 'suspend');
      if (existing) return { proposalId: existing.id, suspended: false };
      const proposalId = newId('suspend');
      await this.repo.insertGameProposal({
        id: proposalId,
        game_id: gameId,
        kind: 'suspend',
        proposed_by: playerId,
        status: 'open',
        created_at: new Date().toISOString(),
      });
      await this.repo.insertGameConsent(proposalId, playerId);
      const suspended = await this.tryApplySuspend(game, proposalId);
      // 尚未成立：推送房間檢視，其他座位才看得到投票橫幅。
      if (!suspended) this.deps.rooms.broadcastRoom(game.room_id);
      return { proposalId, suspended };
    });
  }

  async consentSuspend(
    playerId: string,
    gameId: string,
    proposalId: string,
    approve: boolean,
  ): Promise<SuspendConsentResult> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      this.assertNotTerminal(game);
      const proposal = await this.repo.findOpenGameProposal(gameId, 'suspend');
      if (!proposal || proposal.id !== proposalId) {
        throw new ServiceError('E_NO_PROPOSAL', 'error.E_NO_PROPOSAL', { proposalId }, 404);
      }
      if (!approve) {
        await this.repo.updateGameProposalStatus(proposalId, 'rejected');
        this.deps.rooms.broadcastRoom(game.room_id);
        return { suspended: false };
      }
      await this.repo.insertGameConsent(proposalId, playerId);
      const suspended = await this.tryApplySuspend(game, proposalId);
      if (!suspended) this.deps.rooms.broadcastRoom(game.room_id);
      return { suspended };
    });
  }

  private async tryApplySuspend(game: GameRow, proposalId: string): Promise<boolean> {
    // Bot 席位視為同意，只需要真人一致同意（SPEC §4.6）。
    const memberships = humanMembers(await this.repo.listMembers(game.room_id));
    const consents = new Set(await this.repo.listGameConsents(proposalId));
    if (!memberships.every((membership) => consents.has(membership.player_id))) return false;
    // §4.8：暫停成立時取消進行中的交易協商與房間政策提案；策略上的待決效果保留。
    // 有提案被取消才是新的狀態轉移：修訂版本加一並記下事件，否則維持原修訂版本。
    const current = JSON.parse(game.state_json) as GameState;
    const { state: frozen, events } = suspendNegotiation(current);
    const revision = events.length > 0 ? game.revision + 1 : game.revision;
    await this.repo.transaction(async () => {
      await this.repo.saveGame(game.id, frozen, revision, 'suspended', 'saved');
      if (events.length > 0) await this.repo.appendEvents(game.id, revision, events);
      await this.repo.updateGameProposalStatus(proposalId, 'applied');
      await this.repo.updateRoom(game.room_id, { status: 'suspended' });
      await this.repo.cancelOpenProposals(game.room_id);
      await this.repo.clearGameReady(game.id);
    });
    this.deps.rooms.broadcastRoom(game.room_id);
    // 報價已失效：推送新的投影，牌桌上的交易面板才不會留著已取消的報價。
    if (events.length > 0) this.publish(game.room_id, game.id, revision, events);
    this.notifyLifecycle(game.id, 'suspended');
    return true;
  }

  /** Resume requires every seat to be connected and explicitly ready. */
  async setResumeReady(
    playerId: string,
    gameId: string,
    ready: boolean,
  ): Promise<ResumeReadyResult> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      this.assertNotTerminal(game);
      await this.repo.setGameReady(gameId, playerId, ready);
      // 只等真人；Bot 永遠在線且就緒。
      const memberships = humanMembers(await this.repo.listMembers(game.room_id));
      const readiness = new Map(
        (await this.repo.listGameReady(gameId)).map((row) => [row.player_id, row.ready === 1]),
      );
      const waitingFor = memberships
        .filter((membership) => membership.connected !== 1 || readiness.get(membership.player_id) !== true)
        .map((membership) => membership.player_id);
      if (waitingFor.length > 0) {
        // 準備名單改變了：推送房間檢視，其他座位的「等待…」才會更新。
        this.deps.rooms.broadcastRoom(game.room_id);
        return { resumed: false, waitingFor };
      }
      await this.repo.transaction(async () => {
        await this.repo.saveGame(
          gameId,
          JSON.parse(game.state_json) as GameState,
          game.revision,
          'playing',
          null,
        );
        await this.repo.updateRoom(game.room_id, { status: 'playing' });
        await this.repo.clearGameReady(gameId);
      });
      this.deps.rooms.broadcastRoom(game.room_id);
      this.notifyLifecycle(gameId, 'resumed');
      return { resumed: true, waitingFor: [] };
    });
  }

  // -- abandonment of an interrupted table --------------------------------

  /**
   * §4.6: any connected seated player may propose abandonment once the policy
   * allows it and at least one seat is absent or has withdrawn. Every connected,
   * non-withdrawn seated player must confirm the same proposal; the proposal
   * itself counts as the proposer's consent. A sole human at a bot table ends
   * the game at once.
   */
  async proposeAbandon(playerId: string, gameId: string): Promise<AbandonProposeResult> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireAbandonParticipant(game, playerId);
      const room = await this.repo.findRoom(game.room_id);
      if (!room) throw new ServiceError('E_ROOM_NOT_FOUND', 'error.E_ROOM_NOT_FOUND', {}, 404);
      const policy = this.policyOfRoom(room.policy_json);
      if (!policy.allowAbandonment) {
        throw new ServiceError('E_ABANDON_DISABLED', 'error.E_ABANDON_DISABLED', {}, 409);
      }
      const state = JSON.parse(game.state_json) as GameState;
      if (state.result) {
        throw new ServiceError('E_GAME_OVER', 'error.E_GAME_OVER', { gameId }, 409);
      }
      const memberships = await this.repo.listMembers(game.room_id);
      if (!abandonmentEligible(memberships)) {
        throw new ServiceError('E_NO_ABSENT_PLAYER', 'error.E_NO_ABSENT_PLAYER', {}, 409);
      }
      const existing = await this.repo.findOpenGameProposal(gameId, 'abandon');
      let proposalId: string;
      if (existing) {
        proposalId = existing.id;
      } else {
        proposalId = newId('abandon');
        await this.repo.insertGameProposal({
          id: proposalId,
          game_id: gameId,
          kind: 'abandon',
          proposed_by: playerId,
          status: 'open',
          created_at: new Date().toISOString(),
        });
      }
      await this.recordConsent(proposalId, playerId);
      const abandoned = await this.tryApplyAbandon(game, proposalId);
      // 終局已由 commitAbandoned 廣播；否則提案（或其取消）是新的公開狀態。
      if (!abandoned) this.deps.rooms.broadcastRoom(game.room_id);
      return { proposalId, abandoned };
    });
  }

  async consentAbandon(
    playerId: string,
    gameId: string,
    proposalId: string,
    approve: boolean,
  ): Promise<AbandonConsentResult> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireAbandonParticipant(game, playerId);
      const proposal = await this.repo.findOpenGameProposal(gameId, 'abandon');
      if (!proposal || proposal.id !== proposalId) {
        throw new ServiceError('E_NO_PROPOSAL', 'error.E_NO_PROPOSAL', { proposalId }, 404);
      }
      if (!approve) {
        await this.repo.updateGameProposalStatus(proposalId, 'rejected');
        this.deps.rooms.broadcastRoom(game.room_id);
        return { abandoned: false };
      }
      await this.recordConsent(proposalId, playerId);
      const abandoned = await this.tryApplyAbandon(game, proposalId);
      if (!abandoned) this.deps.rooms.broadcastRoom(game.room_id);
      return { abandoned };
    });
  }

  /**
   * 放棄提案與表態（含否決）只開放給未退出的真人。退出視同同意，且退出者重連
   * 不會取消投票；若退出者還能提案或否決，就多出一個新的否決權。
   *
   * 離線（socket 斷線）但未退出的真人透過 HTTP 表態則不擋：他的效果等同重連，
   * 而重連本來就會取消投票（同意不計入投票者，否決與取消等價），沒有新增權力。
   */
  private async requireAbandonParticipant(game: GameRow, playerId: string): Promise<void> {
    await this.requireSeat(game, playerId);
    const self = (await this.repo.listMembers(game.room_id)).find((member) => member.player_id === playerId);
    if (!self || isBotMember(self)) {
      throw new ServiceError('E_NOT_SEATED', 'error.E_NOT_SEATED', { gameId: game.id }, 403);
    }
    if (self.withdrawn === 1) {
      throw new ServiceError('E_SEAT_WITHDRAWN', 'error.E_SEAT_WITHDRAWN', { gameId: game.id }, 409);
    }
  }

  /** 同一位玩家重複表態不是錯誤（提案即同意，之後再按同意也成立）。 */
  private async recordConsent(proposalId: string, playerId: string): Promise<void> {
    const consents = await this.repo.listGameConsents(proposalId);
    if (!consents.includes(playerId)) await this.repo.insertGameConsent(proposalId, playerId);
  }

  /**
   * 明確退出或撤回（§4.6）。與所有指令一樣在對局鎖內序列化，因此「先提交的終局
   * 為準」：勝利先提交就拒絕退出，退出先把整桌結束就拒絕之後的指令。
   */
  async setWithdrawn(playerId: string, gameId: string, withdrawn: boolean): Promise<WithdrawResult> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      const room = await this.repo.findRoom(game.room_id);
      if (!room) throw new ServiceError('E_ROOM_NOT_FOUND', 'error.E_ROOM_NOT_FOUND', {}, 404);
      const state = JSON.parse(game.state_json) as GameState;
      if (room.status === 'completed' || room.status === 'abandoned' || state.result) {
        throw new ServiceError('E_GAME_OVER', 'error.E_GAME_OVER', { gameId }, 409);
      }
      const members = await this.repo.listMembers(game.room_id);
      const self = members.find((member) => member.player_id === playerId);
      // Bot 沒有憑證也不會退出；人類席位才有退出狀態。
      if (!self || isBotMember(self)) {
        throw new ServiceError('E_NOT_SEATED', 'error.E_NOT_SEATED', { gameId }, 403);
      }
      if ((self.withdrawn === 1) === withdrawn) return { withdrawn, abandoned: false };

      // 資格改變即取消放棄投票；只動 abandon，不碰暫停提案。
      await this.repo.transaction(async () => {
        await this.repo.updateMembership(game.room_id, playerId, { withdrawn: withdrawn ? 1 : 0 });
        await this.repo.cancelOpenGameProposalsOfKind(gameId, 'abandon');
      });

      if (withdrawn && this.policyOfRoom(room.policy_json).allowAbandonment) {
        const humans = humanMembers(await this.repo.listMembers(game.room_id));
        if (humans.every((member) => member.withdrawn === 1)) {
          // 終局時 commitAbandoned 已廣播；沒終局（已有結果）就落到下面的廣播。
          if (await this.commitAbandoned(game.id, game.room_id, null)) return { withdrawn, abandoned: true };
        }
      }
      this.deps.rooms.broadcastRoom(game.room_id);
      return { withdrawn, abandoned: false };
    });
  }

  private async tryApplyAbandon(game: GameRow, proposalId: string): Promise<boolean> {
    const room = await this.repo.findRoom(game.room_id);
    if (!room) return false;
    if (!this.policyOfRoom(room.policy_json).allowAbandonment) {
      await this.repo.updateGameProposalStatus(proposalId, 'cancelled');
      return false;
    }
    const memberships = await this.repo.listMembers(game.room_id);
    // Recheck the absence condition: a reconnection invalidates the vote.
    if (!abandonmentEligible(memberships)) {
      await this.repo.updateGameProposalStatus(proposalId, 'cancelled');
      return false;
    }
    // Bot 席位不投票；退出者視同同意。
    const voters = abandonmentVoters(memberships);
    const consents = new Set(await this.repo.listGameConsents(proposalId));
    if (!voters.every((voter) => consents.has(voter.player_id))) return false;
    return this.commitAbandoned(game.id, game.room_id, proposalId);
  }

  /**
   * 以無勝者的 `abandoned` 終局。呼叫端必須持有該局的鎖；重讀最新狀態，已有結果
   * （例如勝利先提交）就不動，先 commit 的終局為準。
   */
  private async commitAbandoned(gameId: string, roomId: string, proposalId: string | null): Promise<boolean> {
    const fresh = await this.requireGame(gameId);
    const current = JSON.parse(fresh.state_json) as GameState;
    if (current.result) {
      // A committed victory outranks a later abandonment request.
      if (proposalId) await this.repo.updateGameProposalStatus(proposalId, 'cancelled');
      return false;
    }
    const abandoned = abandonGame(current);
    await this.repo.transaction(async () => {
      await this.repo.saveGame(gameId, abandoned, fresh.revision + 1, 'abandoned', null);
      await this.repo.appendEvents(gameId, fresh.revision + 1, abandoned.log.slice(-1));
      if (proposalId) await this.repo.updateGameProposalStatus(proposalId, 'applied');
      await this.repo.updateRoom(roomId, { status: 'abandoned' });
      await this.repo.cancelOpenGameProposals(gameId);
    });
    this.deps.rooms.broadcastRoom(roomId);
    this.notifyLifecycle(gameId, 'abandoned');
    return true;
  }

  // -- operator retention --------------------------------------------------

  /**
   * §4.6 營運者保留機制：終止超過 `gameRetentionDays` 天沒有活動的未結束對局
   * （進行中、interrupted、suspended 皆是）。依對局最後寫入時間由舊到新，以
   * keyset 游標逐頁掃描，每頁 `limit` 筆；成功終止滿 `limit` 筆就停止並標記
   * `full`（可能還有積壓）。單筆失敗只記 warn、不中斷整批，而且游標會越過它，
   * 所以隊首持續失敗的對局不會擋住後面的對局；失敗的對局另外依指數退避暫時
   * 跳過，避免每一輪都重試並洗版。停用（0 天）時什麼都不做。
   */
  async expireIdleGames(
    now: Date = new Date(),
    limit: number = RETENTION_BATCH_SIZE,
  ): Promise<RetentionSweepResult> {
    const result: RetentionSweepResult = { expired: [], failed: [], full: false };
    const days = this.deps.config.gameRetentionDays;
    if (days <= 0) return result;
    const batch = Math.max(1, Math.floor(limit));
    const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
    let cursor: IdleCursor | undefined;
    for (;;) {
      const page = await this.repo.listIdleGames(cutoff, batch, cursor ? { after: cursor } : {});
      for (const candidate of page) {
        cursor = { updated_at: candidate.updated_at, id: candidate.id };
        const tracked = this.retentionFailures.get(candidate.id);
        if (tracked && tracked.retryAt > now.getTime()) continue;
        try {
          const expired = await this.expireIdleGame(candidate.id, cutoff);
          this.retentionFailures.delete(candidate.id);
          if (!expired) continue;
          result.expired.push(candidate.id);
          if (result.expired.length >= batch) {
            result.full = true;
            return result;
          }
        } catch (error) {
          result.failed.push(candidate.id);
          this.recordRetentionFailure(candidate.id, now);
          this.deps.log?.('warn', 'game retention failed', { gameId: candidate.id, error: String(error) });
        }
      }
      if (page.length < batch) return result;
    }
  }

  /**
   * 記下一次失敗並設定下次可重試的時間。追蹤表有上限：滿了以後只保留退避最晚
   * 到期的那些，新項目要比表中最早到期的一筆更晚才取代它，否則不追蹤（下一輪
   * 會再試一次，之後再有機會進表）。這樣超過上限的失敗對局只有放不進表的那幾
   * 筆會重試，其餘的退避時間不受影響；不能整表清空，也不能依插入順序淘汰——
   * 後者會淘汰還沒掃到的項目，讓它們在同一輪被重試而連鎖失效。
   */
  private recordRetentionFailure(gameId: string, now: Date): void {
    const previous = this.retentionFailures.get(gameId);
    const failures = (previous?.failures ?? 0) + 1;
    const delay = Math.min(RETENTION_RETRY_BASE_MS * 2 ** (failures - 1), RETENTION_RETRY_MAX_MS);
    const entry = { failures, retryAt: now.getTime() + delay };
    if (!previous && this.retentionFailures.size >= RETENTION_FAILURE_TRACK_LIMIT) {
      let soonestId: string | undefined;
      let soonestAt = Number.POSITIVE_INFINITY;
      for (const [id, tracked] of this.retentionFailures) {
        if (tracked.retryAt < soonestAt) {
          soonestId = id;
          soonestAt = tracked.retryAt;
        }
      }
      if (soonestId === undefined || soonestAt >= entry.retryAt) return;
      this.retentionFailures.delete(soonestId);
    }
    this.retentionFailures.set(gameId, entry);
  }

  /** 與一般指令共用每局的鎖：取得鎖之後重新確認仍閒置、仍未結束，勝利優先。 */
  private expireIdleGame(gameId: string, cutoff: string): Promise<boolean> {
    return this.withLock(gameId, async () => {
      const fresh = await this.requireGame(gameId);
      const current = JSON.parse(fresh.state_json) as GameState;
      // 排隊期間可能已有終局（勝利優先）。
      if (current.result) return false;
      const abandoned = abandonGame(current, 'expired');
      const idle = await this.repo.transaction<IdleGameRow | null>(async () => {
        // 閒置確認與終止寫入放在同一個交易：連線、房主轉移等不經每局鎖的活動
        // 不會在兩者之間插入。SQLite 的交易會讓其他呼叫者排隊；PostgreSQL 先以
        // `FOR UPDATE` 鎖住成員列、房間列與對局列，這些時間戳的寫入會等到交易
        // 結束，鎖到手之後再確認閒置，讀到的就是最新已提交資料。
        await this.repo.lockGameActivity(gameId);
        const [row] = await this.repo.listIdleGames(cutoff, 1, { gameId });
        if (!row) return null;
        await this.repo.saveGame(gameId, abandoned, fresh.revision + 1, 'abandoned', null);
        await this.repo.appendEvents(gameId, fresh.revision + 1, abandoned.log.slice(-1));
        await this.repo.updateRoom(fresh.room_id, { status: 'abandoned' });
        await this.repo.cancelOpenGameProposals(gameId);
        return row;
      });
      // 期間出現了新活動，這局保留。
      if (!idle) return false;
      this.deps.rooms.broadcastRoom(fresh.room_id);
      // 仍連線的客戶端要拿到帶有 `expired` 原因的終局投影，而不只是房間狀態。
      this.publish(fresh.room_id, gameId, fresh.revision + 1, abandoned.log.slice(-1));
      this.notifyLifecycle(gameId, 'abandoned');
      const lastActivity = [idle.updated_at, idle.room_updated_at, idle.last_seen_at ?? ''].sort().pop();
      this.deps.log?.('info', 'game expired by retention policy', {
        gameId,
        roomId: fresh.room_id,
        lastActivityAt: lastActivity,
        retentionDays: this.deps.config.gameRetentionDays,
      });
      return true;
    });
  }

  private policyOfRoom(policyJson: string): { allowAbandonment: boolean } {
    try {
      const parsed = JSON.parse(policyJson) as { allowAbandonment?: boolean };
      return { allowAbandonment: parsed.allowAbandonment !== false };
    } catch {
      return { allowAbandonment: true };
    }
  }

  /** Game state for tests and diagnostics; never exposed over HTTP directly. */
  async rawState(gameId: string): Promise<GameState> {
    const game = await this.requireGame(gameId);
    return JSON.parse(game.state_json) as GameState;
  }
}
