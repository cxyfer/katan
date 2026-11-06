/**
 * Room lifecycle: membership, seats, readiness, host succession, room policy
 * and presence. All game-rule decisions are delegated to the rules engine.
 */

import {
  PLAYER_COLORS,
  combinationOf,
  getProfile,
  requireProfile,
  resolveCombination,
  type PlayerColor,
} from '@catan/rules';
import {
  DEFAULT_POLICY,
  type AbandonProposalView,
  type BotLevel,
  type GameOrderMode,
  type Notice,
  type PolicyProposalView,
  type RoomMemberView,
  type RoomPolicy,
  type RoomStatus,
  type RoomSummaryView,
  type RoomView,
  type ServerMessage,
  type Visibility,
} from '@catan/protocol';
import type { ServerConfig } from './config.ts';
import { validateNickname, validatePolicy } from './config.ts';
import {
  newId,
  newRoomCode,
  type MemberRow,
  type MembershipRow,
  type Repository,
  type RoomRow,
} from './db.ts';
import {
  botLevelOf,
  botsSupported,
  DEFAULT_BOT_LEVEL,
  effectiveConnected,
  effectiveReady,
  humanMembers,
  insertBotSeat,
  isBotMember,
  ORPHAN_BOT_GUEST_AGE_MS,
  parseBotLevel,
} from './bot-seats.ts';

/** A ruleset named by its parts instead of a profile id (§5.2). */
export interface RulesetRequest {
  expansions: readonly string[];
  scenario: string | null;
  variants?: readonly string[];
}

/**
 * Resolves the requested ruleset to exactly one enabled registry profile. A
 * profile id is re-validated through its own combination; a ruleset is
 * matched exactly, and when both are given they must name the same profile.
 */
export function resolveRoomProfile(input: {
  profileId?: string;
  ruleset?: RulesetRequest;
  capacity: number;
  setupMode: 'fixed' | 'variable';
}): string {
  const reject = (reason: string): never => {
    throw new ServiceError('E_UNSUPPORTED_COMBINATION', 'error.E_UNSUPPORTED_COMBINATION', {
      reason,
      ...(input.profileId ? { profileId: input.profileId } : {}),
      playerCount: input.capacity,
    });
  };
  if (input.ruleset) {
    const check = resolveCombination({
      expansions: input.ruleset.expansions,
      scenario: input.ruleset.scenario ?? null,
      variants: input.ruleset.variants ?? [],
      playerCount: input.capacity,
      setupMode: input.setupMode,
    });
    if (!check.ok) return reject(check.reason);
    if (input.profileId !== undefined && input.profileId !== check.profile.id) return reject('profile-mismatch');
    return check.profile.id;
  }
  const profile = input.profileId === undefined ? undefined : getProfile(input.profileId);
  if (!profile) return reject('unknown-profile');
  const check = resolveCombination(combinationOf(profile, input.capacity, input.setupMode));
  if (!check.ok) return reject(check.reason);
  if (check.profile.id !== profile.id) return reject('profile-mismatch');
  return profile.id;
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly messageId: string,
    readonly params?: Record<string, unknown>,
    readonly status = 400,
  ) {
    super(`${code}: ${messageId}`);
  }
}

/** Rejects any value outside the stable wire enum before it reaches storage. */
function parseOrderMode(value: unknown): GameOrderMode | null {
  return value === 'join' || value === 'random' ? value : null;
}

export interface Connection {
  id: string;
  playerId: string;
  roomId: string | null;
  send(message: ServerMessage): void;
  close(): void;
}

interface RoomRuntime {
  connections: Map<string, Set<Connection>>;
  hostTransferTimers: Map<string, ReturnType<typeof setTimeout>>;
}

export interface RoomServiceDeps {
  repo: Repository;
  config: ServerConfig;
  onRoomStarted(room: RoomRow, playerIds: string[]): Promise<string>;
  /** 房間已標記為 playing 之後通知，讓 Bot 排程器開始推進。 */
  onGameStarted?(roomId: string, gameId: string): void;
  /** 真人 socket 註冊到房間之後通知，讓因無人在線而暫停的 Bot 繼續。 */
  onConnectionRegistered?(roomId: string, playerId: string): void;
}

export class RoomService {
  private readonly runtimes = new Map<string, RoomRuntime>();
  private readonly roomLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: RoomServiceDeps) {}

  private get repo(): Repository {
    return this.deps.repo;
  }

  private runtime(roomId: string): RoomRuntime {
    let runtime = this.runtimes.get(roomId);
    if (!runtime) {
      runtime = { connections: new Map(), hostTransferTimers: new Map() };
      this.runtimes.set(roomId, runtime);
    }
    return runtime;
  }

  /**
   * Serialises membership, capacity, policy and start transitions for one
   * room. The start transition is a multi-step async operation, so a join or
   * leave that reads the old membership snapshot in the middle of it could
   * otherwise put a member outside the created game (or include an unvalidated
   * one). The lock is not re-entrant: never call a locked public method from
   * inside `fn`.
   */
  private withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.roomLocks.get(roomId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const settled = next.catch(() => undefined);
    this.roomLocks.set(roomId, settled);
    void settled.finally(() => {
      // A newer operation may already have replaced this queue tail.
      if (this.roomLocks.get(roomId) === settled) this.roomLocks.delete(roomId);
    });
    return next;
  }

  // -- queries -------------------------------------------------------------

  async requireRoom(roomId: string): Promise<RoomRow> {
    const room = await this.repo.findRoom(roomId);
    if (!room) throw new ServiceError('E_ROOM_NOT_FOUND', 'error.E_ROOM_NOT_FOUND', { roomId }, 404);
    return room;
  }

  async requireMembership(roomId: string, playerId: string): Promise<MembershipRow> {
    const membership = await this.repo.findMembership(roomId, playerId);
    if (!membership) {
      throw new ServiceError('E_NOT_A_MEMBER', 'error.E_NOT_A_MEMBER', { roomId }, 403);
    }
    return membership;
  }

  policyOf(room: RoomRow): RoomPolicy {
    try {
      return { ...DEFAULT_POLICY, ...(JSON.parse(room.policy_json) as Partial<RoomPolicy>) };
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }

  /** 成員的公開檢視；Bot 的 ready／connected 由種類推導，不讀 DB 旗標。 */
  private memberView(room: RoomRow, member: MemberRow, viewerId: string | null): RoomMemberView {
    const bot = isBotMember(member);
    return {
      playerId: member.player_id,
      nickname: member.nickname ?? 'unknown',
      seat: member.seat,
      color: member.color,
      ready: effectiveReady(member),
      connected: effectiveConnected(member),
      host: member.player_id === room.host_id,
      joinedAt: member.joined_at,
      bot,
      ...(bot ? { botLevel: botLevelOf(member) } : {}),
      self: member.player_id === viewerId,
      withdrawn: !bot && member.withdrawn === 1,
    };
  }

  async view(roomId: string, viewerId: string | null): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    const memberships = await this.repo.listMembers(roomId);
    const proposal = await this.repo.findOpenProposal(roomId);
    const members: RoomMemberView[] = memberships.map((membership) =>
      this.memberView(room, membership, viewerId),
    );

    let pendingPolicy: PolicyProposalView | null = null;
    if (proposal) {
      const consents = await this.repo.listPolicyConsents(proposal.id);
      pendingPolicy = {
        id: proposal.id,
        baseRevision: proposal.base_revision,
        before: JSON.parse(proposal.before_json) as RoomPolicy,
        after: JSON.parse(proposal.after_json) as RoomPolicy,
        proposedBy: proposal.proposed_by,
        consents,
        createdAt: proposal.created_at,
      };
    }

    let pendingAbandon: AbandonProposalView | null = null;
    if (room.game_id) {
      const abandon = await this.repo.findOpenGameProposal(room.game_id, 'abandon');
      if (abandon) {
        pendingAbandon = {
          id: abandon.id,
          proposedBy: abandon.proposed_by,
          consents: await this.repo.listGameConsents(abandon.id),
          // 缺席或已退出的真人；Bot 不缺席。
          absent: humanMembers(memberships)
            .filter((member) => member.connected !== 1 || member.withdrawn === 1)
            .map((member) => member.player_id),
          createdAt: abandon.created_at,
        };
      }
    }

    return {
      id: room.id,
      code: room.code,
      visibility: room.visibility as Visibility,
      status: room.status as RoomStatus,
      hostId: room.host_id,
      profileId: room.profile_id,
      setupMode: room.setup_mode as 'fixed' | 'variable',
      orderMode: parseOrderMode(room.order_mode) ?? 'join',
      capacity: room.capacity,
      policy: this.policyOf(room),
      policyRevision: room.policy_revision,
      members,
      gameId: room.game_id,
      createdAt: room.created_at,
      updatedAt: room.updated_at,
      startBlockers: this.startBlockers(room, members),
      pendingPolicy,
      pendingAbandon,
    };
  }

  private startBlockers(room: RoomRow, members: RoomMemberView[]): Notice[] {
    const blockers: Notice[] = [];
    if (room.status !== 'lobby') return blockers;
    const profile = requireProfile(room.profile_id);
    // A room no longer has to be full: any player count the profile supports
    // may start, up to the room's capacity. Wait only for the profile floor.
    const minimumPlayers = Math.min(...profile.playerCounts);
    if (!profile.playerCounts.includes(room.capacity)) {
      blockers.push({
        messageId: 'blocker.profilePlayerCount',
        params: { profileId: profile.id, playerCount: room.capacity },
      });
    }
    if (members.length > room.capacity) {
      blockers.push({
        messageId: 'blocker.capacity',
        params: { seated: members.length, capacity: room.capacity },
      });
    }
    if (members.length < minimumPlayers) {
      blockers.push({
        messageId: 'blocker.seats',
        params: { seated: members.length, min: minimumPlayers },
      });
    } else if (!profile.playerCounts.includes(members.length)) {
      blockers.push({
        messageId: 'blocker.profilePlayerCount',
        params: { profileId: profile.id, playerCount: members.length },
      });
    }
    // Bots only play the rules they know; a bot seat in any other profile can
    // never start, even if it got there before the profile changed.
    if (members.some((member) => member.bot) && !botsSupported(profile)) {
      blockers.push({ messageId: 'blocker.botsUnsupported', params: { profileId: profile.id } });
    }
    const notReady = members.filter((member) => !member.ready);
    if (notReady.length > 0) {
      blockers.push({ messageId: 'blocker.notReady', params: { players: notReady.map((m) => m.nickname) } });
    }
    const offline = members.filter((member) => !member.connected);
    if (offline.length > 0) {
      blockers.push({
        messageId: 'blocker.disconnected',
        params: { players: offline.map((m) => m.nickname) },
      });
    }
    if (!members.some((member) => member.playerId === room.host_id)) {
      blockers.push({ messageId: 'blocker.noHost' });
    }
    return blockers;
  }

  async summaries(filter: { playerCount?: number; profileId?: string } = {}): Promise<RoomSummaryView[]> {
    const rooms = await this.repo.listPublicRooms();
    const out: RoomSummaryView[] = [];
    for (const room of rooms) {
      if (filter.profileId && room.profile_id !== filter.profileId) continue;
      if (filter.playerCount && room.capacity !== filter.playerCount) continue;
      const memberships = await this.repo.listMembers(room.id);
      if (memberships.length >= room.capacity && room.status === 'lobby') continue;
      out.push({
        id: room.id,
        code: room.code,
        visibility: room.visibility as Visibility,
        status: room.status as RoomStatus,
        profileId: room.profile_id,
        playerCount: memberships.length,
        botCount: memberships.filter(isBotMember).length,
        capacity: room.capacity,
        // A started room's unused seats are no longer joinable, even when the
        // game began below capacity.
        openSeats: room.status === 'lobby' ? Math.max(0, room.capacity - memberships.length) : 0,
        createdAt: room.created_at,
      });
    }
    return out;
  }

  // -- lifecycle -----------------------------------------------------------

  async createRoom(
    playerId: string,
    input: {
      visibility: Visibility;
      capacity: number;
      profileId?: string;
      ruleset?: RulesetRequest;
      setupMode: 'fixed' | 'variable';
      orderMode: GameOrderMode;
      policy?: Partial<RoomPolicy>;
    },
  ): Promise<RoomView> {
    const profileId = resolveRoomProfile(input);
    const orderMode = parseOrderMode(input.orderMode);
    if (!orderMode) {
      throw new ServiceError('E_INVALID_ORDER_MODE', 'error.E_INVALID_ORDER_MODE', {
        reason: 'orderMode',
      });
    }
    if (input.capacity > this.deps.config.limits.roomCapacityMax) {
      throw new ServiceError('E_ROOM_CAPACITY', 'error.E_ROOM_CAPACITY', {
        max: this.deps.config.limits.roomCapacityMax,
      });
    }
    const policyCheck = validatePolicy(
      input.policy ?? {},
      this.deps.config.policyBounds,
      this.deps.config.defaultPolicy,
    );
    if (!policyCheck.ok) {
      throw new ServiceError('E_INVALID_POLICY', 'error.E_INVALID_POLICY', { reason: policyCheck.reason });
    }
    const now = new Date().toISOString();
    const room: RoomRow = {
      id: newId('room'),
      code: newRoomCode(),
      visibility: input.visibility,
      status: 'lobby',
      host_id: playerId,
      profile_id: profileId,
      setup_mode: input.setupMode,
      order_mode: orderMode,
      capacity: input.capacity,
      policy_json: JSON.stringify(policyCheck.policy),
      policy_revision: 1,
      game_id: null,
      created_at: now,
      updated_at: now,
    };
    await this.repo.insertRoom(room);
    await this.repo.insertMembership({
      room_id: room.id,
      player_id: playerId,
      seat: 0,
      color: PLAYER_COLORS[0]!,
      ready: 0,
      connected: 1,
      withdrawn: 0,
      joined_at: now,
      last_seen_at: now,
      disconnected_at: null,
      connection_id: null,
    });
    return this.view(room.id, playerId);
  }

  /** 未指定時使用預設難度；指定了不合法的值則拒絕。 */
  private requireBotLevel(value: unknown): BotLevel {
    if (value === undefined) return DEFAULT_BOT_LEVEL;
    const level = parseBotLevel(value);
    if (!level) throw new ServiceError('E_INVALID_BOT', 'error.E_INVALID_BOT', { reason: 'level' });
    return level;
  }

  private requireBotsAllowed(profileId: string): void {
    if (!this.deps.config.bots.enabled) {
      throw new ServiceError('E_BOTS_DISABLED', 'error.E_BOTS_DISABLED', {}, 403);
    }
    if (!botsSupported(requireProfile(profileId))) {
      throw new ServiceError('E_INVALID_BOT', 'error.E_INVALID_BOT', { reason: 'profile', profileId });
    }
  }

  /** 房主在開局前加入一個 Bot 席位（SPEC §4.2、§4.9）。 */
  async addBot(playerId: string, roomId: string, level?: unknown, name?: unknown): Promise<RoomView> {
    return this.withRoomLock(roomId, () => this.addBotLocked(playerId, roomId, level, name));
  }

  private async addBotLocked(
    playerId: string,
    roomId: string,
    levelInput: unknown,
    nameInput: unknown,
  ): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    if (room.host_id !== playerId) {
      throw new ServiceError('E_NOT_HOST', 'error.E_NOT_HOST', {}, 403);
    }
    if (room.status !== 'lobby') {
      throw new ServiceError('E_ROOM_STARTED', 'error.E_ROOM_STARTED', { status: room.status }, 409);
    }
    const level = this.requireBotLevel(levelInput);
    this.requireBotsAllowed(room.profile_id);
    const members = await this.repo.listMembers(roomId);
    if (members.length >= room.capacity) {
      throw new ServiceError('E_ROOM_FULL', 'error.E_ROOM_FULL', { capacity: room.capacity }, 409);
    }
    const name = this.requireBotName(nameInput, members);
    await insertBotSeat(this.repo, roomId, members, level, new Date().toISOString(), name);
    // 座位組成改變，與其他設定變更一樣需要真人重新確認就緒。
    await this.clearReadiness(roomId);
    await this.repo.updateRoom(roomId, { status: room.status });
    this.broadcastRoom(roomId);
    return this.view(roomId, playerId);
  }

  /**
   * 房主可替 Bot 取名；留空沿用名稱池的預設名稱。名稱比照暱稱驗證，且不能
   * 與房內既有席位重複，避免座位與事件紀錄無法分辨。
   */
  private requireBotName(value: unknown, members: readonly MemberRow[]): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      throw new ServiceError('E_INVALID_NICKNAME', 'error.E_INVALID_NICKNAME', { reason: 'name' });
    }
    if (value.trim().length === 0) return undefined;
    const validated = validateNickname(value, this.deps.config.limits.nicknameMaxLength);
    if (!validated.ok) {
      throw new ServiceError('E_INVALID_NICKNAME', 'error.E_INVALID_NICKNAME', { reason: validated.reason });
    }
    const lowered = validated.nickname.toLowerCase();
    if (members.some((member) => (member.nickname ?? '').toLowerCase() === lowered)) {
      throw new ServiceError(
        'E_BOT_NAME_TAKEN',
        'error.E_BOT_NAME_TAKEN',
        { name: validated.nickname },
        409,
      );
    }
    return validated.nickname;
  }

  /** 房主在開局前移除一個 Bot 席位；真人席位不能用這個方式移除。 */
  async removeBot(playerId: string, roomId: string, botId: string): Promise<RoomView> {
    return this.withRoomLock(roomId, () => this.removeBotLocked(playerId, roomId, botId));
  }

  private async removeBotLocked(playerId: string, roomId: string, botId: string): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    if (room.host_id !== playerId) {
      throw new ServiceError('E_NOT_HOST', 'error.E_NOT_HOST', {}, 403);
    }
    if (room.status !== 'lobby') {
      throw new ServiceError('E_ROOM_STARTED', 'error.E_ROOM_STARTED', { status: room.status }, 409);
    }
    const target = (await this.repo.listMembers(roomId)).find((member) => member.player_id === botId);
    if (!target || !isBotMember(target)) {
      throw new ServiceError('E_NOT_A_BOT', 'error.E_NOT_A_BOT', { playerId: botId }, 404);
    }
    await this.repo.deleteMembership(roomId, botId);
    await this.repo.deleteBotGuest(botId);
    await this.clearReadiness(roomId);
    await this.repo.updateRoom(roomId, { status: room.status });
    this.broadcastRoom(roomId);
    return this.view(roomId, playerId);
  }

  async joinByCode(playerId: string, code: string): Promise<RoomView> {
    const room = await this.repo.findRoomByCode(code.trim().toUpperCase());
    if (!room) throw new ServiceError('E_ROOM_NOT_FOUND', 'error.E_ROOM_NOT_FOUND', { code }, 404);
    return this.join(playerId, room.id);
  }

  async join(playerId: string, roomId: string): Promise<RoomView> {
    return this.withRoomLock(roomId, () => this.joinLocked(playerId, roomId));
  }

  private async joinLocked(playerId: string, roomId: string): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    const existing = await this.repo.findMembership(roomId, playerId);
    if (existing) {
      await this.markConnected(roomId, playerId, null);
      return this.view(roomId, playerId);
    }
    if (room.status !== 'lobby') {
      throw new ServiceError('E_ROOM_CLOSED', 'error.E_ROOM_STARTED', { status: room.status }, 409);
    }
    const memberships = await this.repo.listMemberships(roomId);
    if (memberships.length >= room.capacity) {
      throw new ServiceError('E_ROOM_FULL', 'error.E_ROOM_FULL', { capacity: room.capacity }, 409);
    }
    const takenSeats = new Set(memberships.map((membership) => membership.seat));
    const takenColors = new Set(memberships.map((membership) => membership.color));
    let seat = 0;
    while (takenSeats.has(seat)) seat += 1;
    const color =
      PLAYER_COLORS.find((candidate) => !takenColors.has(candidate)) ?? PLAYER_COLORS[0]!;
    const now = new Date().toISOString();
    await this.repo.insertMembership({
      room_id: roomId,
      player_id: playerId,
      seat,
      color,
      ready: 0,
      connected: 1,
      withdrawn: 0,
      joined_at: now,
      last_seen_at: now,
      disconnected_at: null,
      connection_id: null,
    });
    await this.repo.updateRoom(roomId, { status: room.status });
    return this.view(roomId, playerId);
  }

  async leave(playerId: string, roomId: string): Promise<{ left: true; hostTransferredTo: string | null }> {
    return this.withRoomLock(roomId, () => this.leaveLocked(playerId, roomId));
  }

  private async leaveLocked(
    playerId: string,
    roomId: string,
  ): Promise<{ left: true; hostTransferredTo: string | null }> {
    const room = await this.requireRoom(roomId);
    const membership = await this.repo.findMembership(roomId, playerId);
    if (!membership) return { left: true, hostTransferredTo: null };

    if (room.status === 'lobby') {
      await this.repo.deleteMembership(roomId, playerId);
      const remaining = await this.repo.listMembers(roomId);
      // 只剩 Bot 的大廳沒有人能開局或管理，與空大廳一樣關閉。
      if (humanMembers(remaining).length === 0) {
        await this.repo.deleteRoom(roomId);
        this.runtimes.delete(roomId);
        return { left: true, hostTransferredTo: null };
      }
      let transferred: string | null = null;
      if (room.host_id === playerId) transferred = await this.transferHost(roomId);
      await this.cancelPendingProposals(roomId);
      this.broadcastRoom(roomId);
      return { left: true, hostTransferredTo: transferred };
    }

    // A seat in a running or saved game is never removed by leaving.
    await this.markDisconnected(roomId, playerId, 'leave');
    let transferred: string | null = null;
    if (room.host_id === playerId) transferred = await this.transferHost(roomId);
    await this.cancelPendingProposals(roomId);
    this.broadcastRoom(roomId);
    return { left: true, hostTransferredTo: transferred };
  }

  async closeRoom(playerId: string, roomId: string): Promise<{ closed: true }> {
    return this.withRoomLock(roomId, () => this.closeRoomLocked(playerId, roomId));
  }

  private async closeRoomLocked(playerId: string, roomId: string): Promise<{ closed: true }> {
    const room = await this.requireRoom(roomId);
    if (room.host_id !== playerId) {
      throw new ServiceError('E_NOT_HOST', 'error.E_NOT_HOST', {}, 403);
    }
    if (room.status !== 'lobby') {
      throw new ServiceError('E_ROOM_STARTED', 'error.E_ROOM_STARTED', {}, 409);
    }
    await this.repo.deleteRoom(roomId);
    this.runtimes.delete(roomId);
    return { closed: true };
  }

  async setColor(playerId: string, roomId: string, color: string): Promise<RoomView> {
    return this.withRoomLock(roomId, () => this.setColorLocked(playerId, roomId, color));
  }

  private async setColorLocked(playerId: string, roomId: string, color: string): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    if (room.status !== 'lobby') {
      throw new ServiceError('E_ROOM_STARTED', 'error.E_ROOM_STARTED', {}, 409);
    }
    if (!PLAYER_COLORS.includes(color as PlayerColor)) {
      throw new ServiceError('E_INVALID_COLOR', 'error.E_INVALID_COLOR', { color });
    }
    const memberships = await this.repo.listMemberships(roomId);
    if (memberships.some((member) => member.color === color && member.player_id !== playerId)) {
      throw new ServiceError('E_COLOR_TAKEN', 'error.E_COLOR_TAKEN', { color }, 409);
    }
    await this.repo.updateMembership(roomId, playerId, { color });
    await this.clearReadiness(roomId);
    return this.view(roomId, playerId);
  }

  /** Cancels any open vote when the eligibility of the voters changes. */
  async invalidateGameVotes(gameId: string): Promise<void> {
    await this.repo.cancelOpenGameProposals(gameId);
  }

  async setReady(playerId: string, roomId: string, ready: boolean): Promise<RoomView> {
    return this.withRoomLock(roomId, () => this.setReadyLocked(playerId, roomId, ready));
  }

  private async setReadyLocked(playerId: string, roomId: string, ready: boolean): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    if (room.status !== 'lobby') {
      throw new ServiceError('E_ROOM_STARTED', 'error.E_ROOM_STARTED', {}, 409);
    }
    await this.repo.updateMembership(roomId, playerId, { ready: ready ? 1 : 0 });
    this.broadcastRoom(roomId);
    return this.view(roomId, playerId);
  }

  async updateSettings(
    playerId: string,
    roomId: string,
    input: {
      capacity?: number;
      profileId?: string;
      ruleset?: RulesetRequest;
      setupMode?: 'fixed' | 'variable';
      orderMode?: GameOrderMode;
      policy?: Partial<RoomPolicy>;
    },
  ): Promise<RoomView> {
    return this.withRoomLock(roomId, () => this.updateSettingsLocked(playerId, roomId, input));
  }

  private async updateSettingsLocked(
    playerId: string,
    roomId: string,
    input: {
      capacity?: number;
      profileId?: string;
      ruleset?: RulesetRequest;
      setupMode?: 'fixed' | 'variable';
      orderMode?: GameOrderMode;
      policy?: Partial<RoomPolicy>;
    },
  ): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    if (room.host_id !== playerId) {
      throw new ServiceError('E_NOT_HOST', 'error.E_NOT_HOST', {}, 403);
    }
    if (room.status !== 'lobby') {
      throw new ServiceError('E_ROOM_STARTED', 'error.E_ROOM_STARTED', {}, 409);
    }
    const setupMode = input.setupMode ?? (room.setup_mode as 'fixed' | 'variable');
    const orderMode =
      input.orderMode === undefined
        ? parseOrderMode(room.order_mode)
        : parseOrderMode(input.orderMode);
    if (!orderMode) {
      throw new ServiceError('E_INVALID_ORDER_MODE', 'error.E_INVALID_ORDER_MODE', {
        reason: 'orderMode',
      });
    }
    const capacity = input.capacity ?? room.capacity;
    if (capacity > this.deps.config.limits.roomCapacityMax) {
      throw new ServiceError('E_ROOM_CAPACITY', 'error.E_ROOM_CAPACITY', {
        max: this.deps.config.limits.roomCapacityMax,
      });
    }
    const profileId = resolveRoomProfile({
      ...(input.ruleset ? { ruleset: input.ruleset } : { profileId: input.profileId ?? room.profile_id }),
      ...(input.ruleset && input.profileId !== undefined ? { profileId: input.profileId } : {}),
      capacity,
      setupMode,
    });
    const memberships = await this.repo.listMembers(roomId);
    if (capacity < memberships.length) {
      throw new ServiceError('E_CAPACITY_BELOW_SEATED', 'error.E_CAPACITY_BELOW_SEATED', {
        seated: memberships.length,
      });
    }
    if (memberships.some(isBotMember) && !botsSupported(requireProfile(profileId))) {
      throw new ServiceError('E_INVALID_BOT', 'error.E_INVALID_BOT', { reason: 'profile', profileId });
    }
    let policy = this.policyOf(room);
    if (input.policy) {
      const check = validatePolicy(input.policy, this.deps.config.policyBounds, policy);
      if (!check.ok) {
        throw new ServiceError('E_INVALID_POLICY', 'error.E_INVALID_POLICY', { reason: check.reason });
      }
      policy = check.policy;
    }
    // Keep every intermediate state valid without a shared DB transaction:
    // compacted seats still fit the old capacity, readiness is cleared before
    // the new settings become visible, and the room lock blocks concurrent
    // joins/starts.
    if (capacity !== room.capacity) await this.compactSeats(roomId);
    await this.clearReadiness(roomId);
    await this.repo.updateRoom(roomId, {
      profile_id: profileId,
      setup_mode: setupMode,
      order_mode: orderMode,
      capacity,
      policy_json: JSON.stringify(policy),
      policy_revision: room.policy_revision + 1,
    });
    this.broadcastRoom(roomId);
    return this.view(roomId, playerId);
  }

  /**
   * Before start the host applies a policy directly; after start the change is
   * a proposal requiring every original seated player's consent (§5.8).
   */
  async setPolicy(playerId: string, roomId: string, policy: Partial<RoomPolicy>): Promise<RoomView> {
    return this.withRoomLock(roomId, () => this.setPolicyLocked(playerId, roomId, policy));
  }

  private async setPolicyLocked(
    playerId: string,
    roomId: string,
    policy: Partial<RoomPolicy>,
  ): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    if (room.host_id !== playerId) {
      throw new ServiceError('E_NOT_HOST', 'error.E_NOT_HOST', {}, 403);
    }
    const check = validatePolicy(policy, this.deps.config.policyBounds, this.policyOf(room));
    if (!check.ok) {
      throw new ServiceError('E_INVALID_POLICY', 'error.E_INVALID_POLICY', { reason: check.reason });
    }
    if (room.status === 'lobby') {
      await this.repo.updateRoom(roomId, {
        policy_json: JSON.stringify(check.policy),
        policy_revision: room.policy_revision + 1,
      });
      await this.clearReadiness(roomId);
      this.broadcastRoom(roomId);
      return this.view(roomId, playerId);
    }

    await this.repo.cancelOpenProposals(roomId);
    const proposalId = newId('policy');
    await this.repo.insertPolicyProposal({
      id: proposalId,
      room_id: roomId,
      base_revision: room.policy_revision,
      before_json: JSON.stringify(this.policyOf(room)),
      after_json: JSON.stringify(check.policy),
      proposed_by: playerId,
      status: 'open',
      created_at: new Date().toISOString(),
    });
    await this.repo.insertPolicyConsent(proposalId, playerId);
    await this.tryApplyPolicy(roomId, proposalId);
    this.broadcastRoom(roomId);
    return this.view(roomId, playerId);
  }

  async consentPolicy(
    playerId: string,
    roomId: string,
    proposalId: string,
    approve: boolean,
  ): Promise<RoomView> {
    return this.withRoomLock(roomId, () =>
      this.consentPolicyLocked(playerId, roomId, proposalId, approve),
    );
  }

  private async consentPolicyLocked(
    playerId: string,
    roomId: string,
    proposalId: string,
    approve: boolean,
  ): Promise<RoomView> {
    const room = await this.requireRoom(roomId);
    const proposal = await this.repo.findOpenProposal(roomId);
    if (!proposal || proposal.id !== proposalId) {
      throw new ServiceError('E_NO_PROPOSAL', 'error.E_NO_PROPOSAL', { proposalId }, 404);
    }
    await this.requireMembership(roomId, playerId);
    if (!approve) {
      await this.repo.updateProposalStatus(proposalId, 'rejected');
      this.broadcastRoom(roomId);
      return this.view(roomId, playerId);
    }
    await this.repo.insertPolicyConsent(proposalId, playerId);
    await this.tryApplyPolicy(roomId, proposalId);
    void room;
    this.broadcastRoom(roomId);
    return this.view(roomId, playerId);
  }

  /** Applies the proposal once every seated player has consented. */
  private async tryApplyPolicy(roomId: string, proposalId: string): Promise<void> {
    const proposal = await this.repo.findOpenProposal(roomId);
    if (!proposal || proposal.id !== proposalId) return;
    // Bot 席位不投票（SPEC §5.8）。
    const voters = humanMembers(await this.repo.listMembers(roomId));
    const consents = new Set(await this.repo.listPolicyConsents(proposalId));
    const everyone = voters.every((membership) => consents.has(membership.player_id));
    if (!everyone) return;
    const room = await this.requireRoom(roomId);
    if (room.policy_revision !== proposal.base_revision) {
      await this.repo.updateProposalStatus(proposalId, 'cancelled');
      return;
    }
    await this.repo.transaction(async () => {
      await this.repo.updateRoom(roomId, {
        policy_json: proposal.after_json,
        policy_revision: room.policy_revision + 1,
      });
      await this.repo.updateProposalStatus(proposalId, 'applied');
    });
  }

  async cancelPendingProposals(roomId: string): Promise<void> {
    await this.repo.cancelOpenProposals(roomId);
  }

  private async clearReadiness(roomId: string): Promise<void> {
    // Bot 永遠就緒，只清除真人的確認。
    for (const membership of humanMembers(await this.repo.listMembers(roomId))) {
      if (membership.ready === 1) {
        await this.repo.updateMembership(roomId, membership.player_id, { ready: 0 });
      }
    }
  }

  /** Renumbers lobby seats to 0..n-1 while preserving their current order. */
  private async compactSeats(roomId: string): Promise<void> {
    const memberships = (await this.repo.listMemberships(roomId)).sort(
      (a, b) => a.seat - b.seat,
    );
    for (const [seat, membership] of memberships.entries()) {
      if (membership.seat !== seat) {
        await this.repo.updateMembership(roomId, membership.player_id, { seat });
      }
    }
  }

  async start(playerId: string, roomId: string): Promise<{ gameId: string }> {
    return this.withRoomLock(roomId, () => this.startLocked(playerId, roomId));
  }

  private async startLocked(playerId: string, roomId: string): Promise<{ gameId: string }> {
    const room = await this.requireRoom(roomId);
    if (room.host_id !== playerId) {
      throw new ServiceError('E_NOT_HOST', 'error.E_NOT_HOST', {}, 403);
    }
    if (room.status !== 'lobby') {
      throw new ServiceError('E_ROOM_STARTED', 'error.E_ROOM_STARTED', { status: room.status }, 409);
    }
    const memberships = await this.repo.listMembers(roomId);
    const blockers = this.startBlockers(
      room,
      memberships.map((membership) => ({
        ...this.memberView(room, membership, null),
        nickname: membership.player_id,
      })),
    );
    if (blockers.length > 0) {
      throw new ServiceError('E_START_BLOCKED', 'error.E_START_BLOCKED', { blockers }, 409);
    }
    const gameId = await this.deps.onRoomStarted(room, memberships.map((m) => m.player_id));
    await this.repo.updateRoom(roomId, { status: 'playing', game_id: gameId });
    this.broadcastRoom(roomId);
    this.deps.onGameStarted?.(roomId, gameId);
    return { gameId };
  }

  // -- housekeeping --------------------------------------------------------

  /**
   * Removes abandoned pre-game lobbies only. A running, suspended, interrupted
   * or terminal game is never reaped as a stale lobby (§4.8), and a lobby with
   * a live socket is left alone regardless of its age.
   */
  async sweepStaleLobbies(now: Date = new Date()): Promise<string[]> {
    const ttlMs = this.deps.config.limits.roomIdleTtlMinutes * 60_000;
    const removed: string[] = [];
    for (const room of await this.repo.listAllRooms()) {
      if (room.status !== 'lobby') continue;
      // Presence is decided by live sockets, not by the durable flag, so a
      // lobby whose members never opened a socket can still be reclaimed.
      if ((this.runtimes.get(room.id)?.connections.size ?? 0) > 0) continue;
      const memberships = await this.repo.listMemberships(room.id);
      const idleMs = now.getTime() - Date.parse(room.updated_at);
      if (memberships.length > 0 && idleMs <= ttlMs) continue;
      await this.repo.deleteRoom(room.id);
      this.runtimes.delete(room.id);
      removed.push(room.id);
    }
    // 回收已沒有任何席位的 Bot guest（例如房間刪除前的舊資料）。
    await this.repo.deleteOrphanBotGuests(new Date(now.getTime() - ORPHAN_BOT_GUEST_AGE_MS).toISOString());
    return removed;
  }

  // -- presence ------------------------------------------------------------

  async registerConnection(connection: Connection): Promise<void> {
    const roomId = connection.roomId;
    if (!roomId) return;
    const runtime = this.runtime(roomId);
    const set = runtime.connections.get(connection.playerId) ?? new Set<Connection>();
    set.add(connection);
    runtime.connections.set(connection.playerId, set);
    const timer = runtime.hostTransferTimers.get(connection.playerId);
    if (timer) {
      clearTimeout(timer);
      runtime.hostTransferTimers.delete(connection.playerId);
    }
    await this.markConnected(roomId, connection.playerId, connection.id);
    // A returning connection invalidates a vote it did not participate in. 必須
    // 先標記為已連線再取消：反過來的話，取消與標記之間成立的新提案仍把這位玩家
    // 當成缺席，之後就不會再被取消。tryApplyAbandon 在提交時重讀 membership 重查資格。
    // 已退出的席位回來不改變缺席條件，因此不取消投票；退出只能明確撤回。
    const room = await this.repo.findRoom(roomId);
    if (room?.game_id) {
      const returning = await this.repo.findMembership(roomId, connection.playerId);
      if (returning?.withdrawn !== 1) {
        const open = await this.repo.findOpenGameProposal(room.game_id, 'abandon');
        await this.invalidateGameVotes(room.game_id);
        if (open) this.broadcastRoom(roomId);
      }
    }
    this.broadcastPresence(roomId);
    this.deps.onConnectionRegistered?.(roomId, connection.playerId);
  }

  async unregisterConnection(connection: Connection): Promise<void> {
    const roomId = connection.roomId;
    if (!roomId) return;
    const runtime = this.runtimes.get(roomId);
    if (!runtime) return;
    const set = runtime.connections.get(connection.playerId);
    if (set) {
      set.delete(connection);
      if (set.size === 0) runtime.connections.delete(connection.playerId);
    }
    if (runtime.connections.has(connection.playerId)) return;

    const room = await this.repo.findRoom(roomId);
    if (!room) return;
    await this.markDisconnected(roomId, connection.playerId, 'transport');
    this.broadcastPresence(roomId);
    // presence 不含 pendingAbandon；有 open 提案時推送完整檢視，讓缺席名單保持最新。
    if (room.game_id && (await this.repo.findOpenGameProposal(room.game_id, 'abandon'))) {
      this.broadcastRoom(roomId);
    }

    // After the grace period an unexpectedly disconnected host loses the role.
    if (room.host_id === connection.playerId && room.status !== 'lobby') {
      const graceMs = this.policyOf(room).disconnectGraceSeconds * 1000;
      const timer = setTimeout(() => {
        void this.expireHostGrace(roomId, connection.playerId);
      }, graceMs);
      timer.unref?.();
      runtime.hostTransferTimers.set(connection.playerId, timer);
    }
  }

  private async expireHostGrace(roomId: string, playerId: string): Promise<void> {
    const runtime = this.runtimes.get(roomId);
    runtime?.hostTransferTimers.delete(playerId);
    const room = await this.repo.findRoom(roomId);
    if (!room || room.host_id !== playerId) return;
    const membership = await this.repo.findMembership(roomId, playerId);
    if (membership?.connected === 1) return;
    await this.transferHost(roomId);
    this.broadcastRoom(roomId);
  }

  private async markConnected(roomId: string, playerId: string, connectionId: string | null): Promise<void> {
    const membership = await this.repo.findMembership(roomId, playerId);
    if (!membership) return;
    await this.repo.updateMembership(roomId, playerId, {
      connected: 1,
      disconnected_at: null,
      last_seen_at: new Date().toISOString(),
      ...(connectionId ? { connection_id: connectionId } : {}),
    });
  }

  private async markDisconnected(roomId: string, playerId: string, reason: string): Promise<void> {
    void reason;
    await this.repo.updateMembership(roomId, playerId, {
      connected: 0,
      disconnected_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    });
  }

  /** Transfers administration to the earliest-joined connected member. */
  async transferHost(roomId: string): Promise<string | null> {
    // Bot 不能成為房主。
    const memberships = humanMembers(await this.repo.listMembers(roomId));
    const candidates = memberships
      .filter((membership) => membership.connected === 1)
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.seat - b.seat);
    const successor = candidates[0];
    if (!successor) return null;
    await this.repo.updateRoom(roomId, { host_id: successor.player_id });
    await this.cancelPendingProposals(roomId);
    return successor.player_id;
  }

  /** Elects a host when members return and no connected host exists. */
  async ensureHost(roomId: string): Promise<string | null> {
    const room = await this.repo.findRoom(roomId);
    if (!room) return null;
    const memberships = await this.repo.listMemberships(roomId);
    const hostPresent = memberships.some((membership) => membership.player_id === room.host_id);
    if (hostPresent) return room.host_id;
    return this.transferHost(roomId);
  }

  async seatControl(roomId: string, playerId: string, connectionId: string): Promise<boolean> {
    const membership = await this.repo.findMembership(roomId, playerId);
    if (!membership) return false;
    if (!membership.connection_id) {
      await this.repo.updateMembership(roomId, playerId, { connection_id: connectionId });
      return true;
    }
    return membership.connection_id === connectionId;
  }

  async claimSeatControl(roomId: string, playerId: string, connectionId: string): Promise<void> {
    await this.repo.updateMembership(roomId, playerId, { connection_id: connectionId });
  }

  // -- fan-out -------------------------------------------------------------

  broadcastRoom(roomId: string): void {
    const runtime = this.runtimes.get(roomId);
    if (!runtime) return;
    for (const [playerId, set] of runtime.connections) {
      for (const connection of set) {
        void this.view(roomId, playerId)
          .then((view) => connection.send({ type: 'room', payload: view }))
          .catch(() => undefined);
      }
    }
  }

  broadcastPresence(roomId: string): void {
    const runtime = this.runtimes.get(roomId);
    if (!runtime) return;
    for (const [playerId, set] of runtime.connections) {
      void this.view(roomId, playerId)
        .then((view) => {
          const message: ServerMessage = { type: 'presence', payload: { roomId, members: view.members } };
          for (const connection of set) connection.send(message);
        })
        .catch(() => undefined);
    }
  }

  broadcastToRoom(roomId: string, message: ServerMessage, exceptPlayerId?: string): void {
    const runtime = this.runtimes.get(roomId);
    if (!runtime) return;
    for (const [playerId, set] of runtime.connections) {
      if (exceptPlayerId && playerId === exceptPlayerId) continue;
      for (const connection of set) connection.send(message);
    }
  }

  sendTo(playerId: string, message: ServerMessage, roomId?: string): void {
    if (roomId) {
      const runtime = this.runtimes.get(roomId);
      for (const connection of runtime?.connections.get(playerId) ?? []) connection.send(message);
      return;
    }
    for (const runtime of this.runtimes.values()) {
      for (const connection of runtime.connections.get(playerId) ?? []) connection.send(message);
    }
  }

  connectionIdsFor(playerId: string, roomId: string): string[] {
    const runtime = this.runtimes.get(roomId);
    return [...(runtime?.connections.get(playerId) ?? [])].map((connection) => connection.id);
  }

  /** 房內是否有任何 live socket；Bot 沒有 socket，所以這代表有真人在線。 */
  hasLiveConnection(roomId: string): boolean {
    return (this.runtimes.get(roomId)?.connections.size ?? 0) > 0;
  }

  connectionsInRoom(roomId: string): Connection[] {
    const runtime = this.runtimes.get(roomId);
    if (!runtime) return [];
    return [...runtime.connections.values()].flatMap((set) => [...set]);
  }
}
