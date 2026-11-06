/**
 * Bot 排程器（SPEC §4.9）。
 *
 * Bot 只透過 `GameCoordinator.submit` 送出指令，決策只看該座位的投影。排程器
 * 不保存任何決策狀態：重啟後從已提交的遊戲狀態繼續，報價計時則從頭算起。
 */

import { actionHints, getProfile, projectGame, type GameState, type GameView } from '@catan/rules';
import {
  BOT_PACING,
  botActingOrder,
  botCommandLimit,
  botOwesAction,
  botSeed,
  createBotPolicy,
  fallbackPolicy,
  type BotCommand,
  type BotContext,
  type BotLevel,
  type BotPolicy,
  type OfferPhase,
  type OwedAction,
} from '@catan/bots';
import type { CommandReceipt, CommandRequest } from '@catan/protocol';
import type { ServerConfig } from './config.ts';
import type { MemberRow, Repository } from './db.ts';
import type { CommitNotice, GameCoordinator, GameLifecycleChange } from './game.ts';
import { ServiceError, type RoomService } from './rooms.ts';
import { botLevelOf, isBotMember } from './bot-seats.ts';

type Log = (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;

export interface BotDriverDeps {
  repo: Repository;
  rooms: RoomService;
  games: GameCoordinator;
  config: ServerConfig;
  log: Log;
  /** 依難度取得策略；測試可替換。 */
  policyFor: (level: BotLevel) => BotPolicy;
  /** 單一行動視窗內每個 Bot 的指令上限；省略時依 profile 取 `botCommandLimit`。測試可注入。 */
  commandLimitFor?: (profileId: string) => number;
  now: () => number;
}

/** 各指令的思考延遲（毫秒），再乘以 `BOT_DELAY_SCALE`。 */
const THINK_MS: Readonly<Record<string, number>> = {
  'setup.placeBuilding': 900,
  'setup.placeRoad': 600,
  'turn.roll': 900,
  'turn.end': 900,
  'build.road': 900,
  'build.settlement': 900,
  'build.city': 900,
  'build.devCard': 900,
  'dev.playKnight': 1100,
  'dev.playRoadBuilding': 1100,
  'dev.playYearOfPlenty': 1100,
  'dev.playMonopoly': 1100,
  'trade.bank': 800,
  'trade.offer': 1200,
  'trade.revise': 1200,
  'trade.respond': 700,
  'trade.settle': 800,
  'trade.withdraw': 600,
  'pending.discard': 900,
  'pending.moveRobber': 1200,
  'pending.steal': 800,
  'pending.takeResource': 700,
};
/** base 加上各 Bot 模組的 `pacing`；同一個指令以模組的值為準。 */
const PACING_MS: Readonly<Record<string, number>> = { ...THINK_MS, ...BOT_PACING };
const DEFAULT_THINK_MS = 900;
/** 客戶端骰子演出約 2.5 秒；擲骰後的 Bot 動作至少等這麼久。 */
const ROLL_PRESENTATION_MS = 2800;
/** 投影附帶的近期事件數，與 `GameCoordinator.snapshot` 相同。 */
const RECENT_EVENTS = 40;
/**
 * 單一行動視窗內每個 Bot 的指令上限（base 值）；超過代表策略在打轉，之後該 Bot 只走保底策略。
 * 實際上限依 profile 取各模組 `maxCommandsPerWindow` 的最大值，見 `commandLimit`。
 */
const BASE_COMMANDS_PER_WINDOW = 40;

/** 欠著動作、但策略與保底都沒有動作的 Bot；只用於診斷。 */
interface IdleDuty {
  botId: string;
  owed: OwedAction;
  turnPhase: string;
  pendingKind: string | null;
  responders: string[];
  /** 各模組 hints 的 `phase`（例如 E&P 的 action／movement）。 */
  modulePhases: Record<string, string>;
}

interface Decision {
  botId: string;
  command: BotCommand;
  revision: number;
  attempt: number;
  /** 由保底策略產生。 */
  fallback: boolean;
}

interface GameRuntime {
  timer: ReturnType<typeof setTimeout> | null;
  /** 正在評估或送出；期間的喚醒只標記 dirty，結束後再評估一次。 */
  busy: boolean;
  dirty: boolean;
  /** 最近一次狀態變化（提交、開局、恢復）的時間。 */
  changedAt: number;
  /** 最近一次擲骰被提交的時間。 */
  rolledAt: number | null;
  /** 報價被提交的時間；只有 Bot 自己的報價會用來推導階段。 */
  offerOpenedAt: Map<string, number>;
  /** 同一 revision 內已用掉的 attempt，以及改走保底策略的 Bot。 */
  attempts: { revision: number; next: number; fallbackBots: Set<string> };
  /** 目前行動視窗內每個 Bot 已提交的指令數。 */
  window: { id: number; commands: Map<string, number> };
}

/** 目前待決效果的回應者：模組 frame 與 base 各自的欄位。 */
function respondersOf(pending: NonNullable<GameView['pending']>): string[] {
  if ('responders' in pending) return pending.responders;
  return pending.kind === 'discard' ? pending.waitingFor : [pending.actor];
}

/** 各模組 hints 的子階段（`hints.modules[id].phase`）；沒有則省略該模組。 */
function modulePhasesOf(view: GameView): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, hints] of Object.entries(view.hints?.modules ?? {})) {
    const phase = (hints as { phase?: unknown } | null)?.phase;
    if (typeof phase === 'string') out[id] = phase;
  }
  return out;
}

function describeIdle(view: GameView, botId: string, owed: OwedAction): IdleDuty {
  return {
    botId,
    owed,
    turnPhase: view.turn.phase,
    pendingKind: view.pending?.kind ?? null,
    responders: view.pending ? respondersOf(view.pending) : [],
    modulePhases: modulePhasesOf(view),
  };
}

export function defaultPolicyFor(): (level: BotLevel) => BotPolicy {
  const cache = new Map<BotLevel, BotPolicy>();
  return (level) => {
    let policy = cache.get(level);
    if (!policy) {
      policy = createBotPolicy(level);
      cache.set(level, policy);
    }
    return policy;
  };
}

export class BotDriver {
  private readonly runtimes = new Map<string, GameRuntime>();
  /** 開局後不能再加入 Bot，沒有 Bot 的遊戲記下來，之後的提交不必再查資料庫。 */
  private readonly botless = new Set<string>();
  private readonly tasks = new Set<Promise<unknown>>();
  private closed = false;

  constructor(private readonly deps: BotDriverDeps) {}

  // -- 喚醒點 -----------------------------------------------------------------

  /** 有狀態變化或環境變化時呼叫；實際工作一律延到計時器中執行。 */
  kick(gameId: string): void {
    if (this.closed || this.botless.has(gameId)) return;
    const runtime = this.runtime(gameId);
    runtime.dirty = true;
    if (runtime.busy) return;
    this.schedule(gameId, runtime, 0, () => this.track(this.run(gameId)));
  }

  /** 真人 socket 進房時呼叫：房間正在進行就喚醒它的 Bot。 */
  kickRoom(roomId: string): void {
    if (this.closed) return;
    this.track(
      (async () => {
        const room = await this.deps.repo.findRoom(roomId);
        if (!room?.game_id || room.status !== 'playing') return;
        // 給剛連上的客戶端一段思考延遲，讓它先載入快照再看到 Bot 動作。
        const runtime = this.runtime(room.game_id);
        runtime.changedAt = Math.max(runtime.changedAt, this.deps.now());
        this.kick(room.game_id);
      })(),
    );
  }

  gameStarted(gameId: string): void {
    if (this.closed) return;
    this.runtime(gameId).changedAt = this.deps.now();
    this.kick(gameId);
  }

  /** 由 `GameCoordinator` 在提交後同步呼叫；只記錄並排程。 */
  onCommitted(notice: CommitNotice): void {
    if (this.closed || this.botless.has(notice.gameId)) return;
    if (notice.finished) {
      this.forget(notice.gameId);
      return;
    }
    const runtime = this.runtime(notice.gameId);
    const now = this.deps.now();
    runtime.changedAt = now;
    for (const event of notice.events) {
      if (event.type === 'turn.rolled') runtime.rolledAt = now;
      // 開價或修改條件都重新開始收集窗。
      if (event.type === 'trade.offered' || event.type === 'trade.revised') {
        const offerId = event.params.offerId;
        if (typeof offerId === 'string') runtime.offerOpenedAt.set(offerId, now);
      }
    }
    this.kick(notice.gameId);
  }

  onLifecycle(gameId: string, change: GameLifecycleChange): void {
    if (this.closed) return;
    if (change === 'abandoned') {
      this.forget(gameId);
      return;
    }
    if (change === 'suspended') {
      const runtime = this.runtimes.get(gameId);
      if (runtime) this.clearTimer(runtime);
      return;
    }
    this.runtime(gameId).changedAt = this.deps.now();
    this.kick(gameId);
  }

  /** 停止所有計時器並等待進行中的送出完成；之後不再送出任何指令。 */
  async close(): Promise<void> {
    this.closed = true;
    for (const runtime of this.runtimes.values()) this.clearTimer(runtime);
    this.runtimes.clear();
    this.botless.clear();
    while (this.tasks.size > 0) await Promise.allSettled([...this.tasks]);
  }

  /** 診斷與測試用：追蹤中的遊戲、待觸發的計時器與進行中的工作數。 */
  stats(): { games: number; timers: number; busy: number; tasks: number } {
    let timers = 0;
    let busy = 0;
    for (const runtime of this.runtimes.values()) {
      if (runtime.timer) timers += 1;
      if (runtime.busy) busy += 1;
    }
    return { games: this.runtimes.size, timers, busy, tasks: this.tasks.size };
  }

  // -- 評估與送出 ---------------------------------------------------------------

  private async run(gameId: string): Promise<void> {
    const runtime = this.runtimes.get(gameId);
    if (!runtime || runtime.busy || this.closed) return;
    runtime.busy = true;
    try {
      while (runtime.dirty && !this.closed) {
        runtime.dirty = false;
        await this.evaluate(gameId, runtime);
      }
    } catch (error) {
      this.deps.log('warn', 'bot evaluation failed', { gameId, error: String(error) });
      this.schedule(gameId, runtime, this.deps.config.bots.retryMs, () => this.kick(gameId));
    } finally {
      runtime.busy = false;
    }
  }

  private async evaluate(gameId: string, runtime: GameRuntime): Promise<void> {
    this.clearTimer(runtime);
    const game = await this.deps.repo.findGame(gameId);
    if (!game) {
      this.forget(gameId);
      return;
    }
    const room = await this.deps.repo.findRoom(game.room_id);
    if (!room || room.status === 'completed' || room.status === 'abandoned') {
      this.forget(gameId);
      return;
    }
    // 暫停中：等恢復時的生命週期喚醒。
    if (room.status !== 'playing') return;
    const state = JSON.parse(game.state_json) as GameState;
    if (state.result) {
      this.forget(gameId);
      return;
    }
    // 沒有任何真人在線時不推進；真人重連會再喚醒（SPEC §4.9）。
    if (!this.deps.rooms.hasLiveConnection(room.id)) return;
    const bots = (await this.deps.repo.listMembers(room.id)).filter(isBotMember);
    if (bots.length === 0) {
      this.botless.add(gameId);
      this.forget(gameId);
      return;
    }
    this.pruneOffers(runtime, state);
    const idle: IdleDuty[] = [];
    const decision = this.decide(gameId, game.revision, state, bots, runtime, idle);
    if (decision) {
      this.schedule(gameId, runtime, this.delayFor(decision.command, runtime), () =>
        this.track(this.perform(gameId, decision)),
      );
      return;
    }
    // 沒有 Bot 要動：於下一次可能改變結果的時間點再看一次。
    const wakeAfter: number[] = [];
    // 有 Bot 在等自己報價的回應：下一個階段邊界。
    const boundary = this.nextOfferBoundary(state, bots, runtime);
    if (boundary !== null) wakeAfter.push(boundary - this.deps.now());
    // 有 Bot 欠著動作卻沒有動作：記錄後以固定間隔重試，與指令被拒（`rejected`）走同一條路徑。
    // 重試只由計時器觸發、每次至少相隔 `retryMs`，狀態沒變時也不會立刻再評估，所以不會熱迴圈。
    if (idle.length > 0) {
      for (const duty of idle) {
        this.deps.log('warn', 'bot owes an action but strategy and fallback are idle; retrying later', {
          gameId,
          revision: game.revision,
          windowId: state.windowId,
          retryMs: this.deps.config.bots.retryMs,
          ...duty,
        });
      }
      wakeAfter.push(this.deps.config.bots.retryMs);
    }
    if (wakeAfter.length > 0) this.schedule(gameId, runtime, Math.min(...wakeAfter), () => this.kick(gameId));
  }

  private decide(
    gameId: string,
    revision: number,
    state: GameState,
    bots: readonly MemberRow[],
    runtime: GameRuntime,
    idle: IdleDuty[],
  ): Decision | null {
    if (runtime.attempts.revision !== revision) {
      runtime.attempts = { revision, next: 0, fallbackBots: new Set() };
    }
    if (runtime.window.id !== state.windowId) runtime.window = { id: state.windowId, commands: new Map() };
    const attempt = runtime.attempts.next;
    const commandLimit = this.commandLimit(state.profileId);
    const botIds = bots.map((bot) => bot.player_id);
    const views = new Map<string, GameView>();
    const viewFor = (botId: string): GameView => {
      let view = views.get(botId);
      if (!view) {
        // 與客戶端快照相同的投影：只有這個座位能看到的資訊。
        view = projectGame(state, botId, {
          events: state.log.slice(-RECENT_EVENTS),
          hints: actionHints(state, botId),
        });
        views.set(botId, view);
      }
      return view;
    };

    for (const botId of botActingOrder(viewFor(botIds[0]!), botIds)) {
      const bot = bots.find((candidate) => candidate.player_id === botId)!;
      const context: BotContext = {
        selfId: botId,
        level: botLevelOf(bot),
        seed: botSeed(gameId, botId, revision, attempt),
        offerPhases: this.offerPhases(state, botId, runtime),
      };
      const looping = (runtime.window.commands.get(botId) ?? 0) >= commandLimit;
      if (looping && !runtime.attempts.fallbackBots.has(botId)) {
        this.deps.log('warn', 'bot command limit reached in this window; using fallback', {
          gameId,
          botId,
          windowId: state.windowId,
        });
        runtime.attempts.fallbackBots.add(botId);
      }
      const forced = looping || runtime.attempts.fallbackBots.has(botId);
      let command: BotCommand | null = null;
      if (!forced) {
        try {
          command = this.deps.policyFor(context.level).decide(viewFor(botId), context);
        } catch (error) {
          this.deps.log('warn', 'bot policy threw; using fallback', {
            gameId,
            botId,
            revision,
            error: String(error),
          });
          runtime.attempts.fallbackBots.add(botId);
        }
        if (command) return { botId, command, revision, attempt, fallback: false };
      }
      // 策略沒有動作，但若這個 Bot 其實欠著必要動作（保底策略會動），就由保底策略
      // 代為完成；唯一的例外是行動者正在等自己報價的回應。
      const waiting = this.waitingOnOwnOffers(state, botId, runtime);
      if (!forced && waiting) continue;
      const fallback = fallbackPolicy.decide(viewFor(botId), context);
      if (fallback) {
        if (!forced) {
          this.deps.log('debug', 'bot policy idle on a duty; using fallback', {
            gameId,
            botId,
            revision,
            command: fallback.type,
          });
        }
        return { botId, command: fallback, revision, attempt, fallback: true };
      }
      // 兩者都沒有動作。等自己報價的回應不算欠動作；否則 Bot 卡住了，交給呼叫端記錄並重試。
      const owed = waiting ? null : botOwesAction(viewFor(botId), botId);
      if (owed) idle.push(describeIdle(viewFor(botId), botId, owed));
    }
    return null;
  }

  /** 這個 profile 的單一視窗指令上限：測試注入優先，否則 base 與各模組上限的最大值。 */
  private commandLimit(profileId: string): number {
    const injected = this.deps.commandLimitFor?.(profileId);
    if (injected !== undefined) return injected;
    const profile = getProfile(profileId);
    return profile ? botCommandLimit(profile, BASE_COMMANDS_PER_WINDOW) : BASE_COMMANDS_PER_WINDOW;
  }

  private async perform(gameId: string, decision: Decision): Promise<void> {
    const runtime = this.runtimes.get(gameId);
    if (!runtime || runtime.busy || this.closed) return;
    runtime.busy = true;
    try {
      await this.submitDecision(gameId, runtime, decision);
    } catch (error) {
      this.deps.log('warn', 'bot submission failed', { gameId, error: String(error) });
      this.schedule(gameId, runtime, this.deps.config.bots.retryMs, () => this.kick(gameId));
    } finally {
      runtime.busy = false;
    }
    if (runtime.dirty) this.kick(gameId);
  }

  private async submitDecision(gameId: string, runtime: GameRuntime, decision: Decision): Promise<void> {
    // 計時器觸發時重新確認：狀態沒變、房間仍在進行、仍有真人在線。
    const game = await this.deps.repo.findGame(gameId);
    if (!game) return;
    if (game.revision !== decision.revision) {
      runtime.dirty = true;
      return;
    }
    const room = await this.deps.repo.findRoom(game.room_id);
    if (!room || room.status !== 'playing' || !this.deps.rooms.hasLiveConnection(room.id)) return;
    if (this.closed) return;

    let receipt: CommandReceipt;
    try {
      receipt = await this.deps.games.submit(decision.botId, gameId, {
        // 同一 revision 與 attempt 重送會拿到原收據，不會重複套用。
        commandId: `bot:${decision.revision}:${decision.attempt}`,
        expectedRevision: decision.revision,
        command: decision.command as CommandRequest['command'],
      });
    } catch (error) {
      // 基礎設施錯誤交給 perform 退避重試，同一個 commandId 重送是冪等的。
      if (!(error instanceof ServiceError)) throw error;
      // 暫停或結束由生命週期處理；其他服務錯誤（例如 commandId 衝突）當作被拒。
      if (error.code === 'E_GAME_SUSPENDED' || error.code === 'E_GAME_OVER') return;
      this.rejected(gameId, runtime, decision, error.messageId);
      return;
    }
    if (receipt.outcome === 'accepted') {
      // revision 已確認未變，所以這筆指令屬於決策時的行動視窗。
      runtime.window.commands.set(decision.botId, (runtime.window.commands.get(decision.botId) ?? 0) + 1);
      return;
    }
    if (receipt.error?.messageId === 'error.E_STALE_REVISION') {
      runtime.dirty = true;
      return;
    }
    this.rejected(gameId, runtime, decision, receipt.error?.messageId ?? 'unknown');
  }

  private rejected(gameId: string, runtime: GameRuntime, decision: Decision, messageId: string): void {
    if (runtime.attempts.revision === decision.revision) {
      runtime.attempts.next = Math.max(runtime.attempts.next, decision.attempt + 1);
    }
    const meta = {
      gameId,
      botId: decision.botId,
      revision: decision.revision,
      command: decision.command.type,
      messageId,
    };
    if (!decision.fallback) {
      // 同一 revision 立刻改用保底策略。
      this.deps.log('warn', 'bot command rejected; using fallback', meta);
      runtime.attempts.fallbackBots.add(decision.botId);
      runtime.dirty = true;
      return;
    }
    // 保底也被拒：記錄後退避，重試時再給策略一次機會。
    this.deps.log('warn', 'bot fallback rejected; retrying later', meta);
    runtime.attempts.fallbackBots.clear();
    this.schedule(gameId, runtime, this.deps.config.bots.retryMs, () => this.kick(gameId));
  }

  // -- 計時與報價階段 ---------------------------------------------------------

  private delayFor(command: BotCommand, runtime: GameRuntime): number {
    const scale = this.deps.config.bots.delayScale;
    const now = this.deps.now();
    let due = runtime.changedAt + (PACING_MS[command.type] ?? DEFAULT_THINK_MS) * scale;
    if (runtime.rolledAt !== null) due = Math.max(due, runtime.rolledAt + ROLL_PRESENTATION_MS * scale);
    return Math.max(0, due - now);
  }

  private phaseOf(offerId: string, runtime: GameRuntime): OfferPhase {
    const openedAt = runtime.offerOpenedAt.get(offerId);
    // 沒有紀錄（例如重啟後）一律視為逾時。
    if (openedAt === undefined) return 'expired';
    const elapsed = this.deps.now() - openedAt;
    if (elapsed >= this.deps.config.bots.offerPatienceMs) return 'expired';
    if (elapsed >= this.deps.config.bots.offerCollectMs) return 'ready';
    return 'collecting';
  }

  private offerPhases(state: GameState, botId: string, runtime: GameRuntime): Record<string, OfferPhase> {
    const phases: Record<string, OfferPhase> = {};
    for (const offer of state.offers) {
      if (offer.from === botId && offer.status === 'open') phases[offer.id] = this.phaseOf(offer.id, runtime);
    }
    return phases;
  }

  private waitingOnOwnOffers(state: GameState, botId: string, runtime: GameRuntime): boolean {
    if (state.players[state.turn.seat]?.id !== botId) return false;
    return state.offers.some(
      (offer) => offer.from === botId && offer.status === 'open' && this.phaseOf(offer.id, runtime) !== 'expired',
    );
  }

  /** Bot 自己的 open 報價下一次換階段的時間；沒有則回傳 null。 */
  private nextOfferBoundary(state: GameState, bots: readonly MemberRow[], runtime: GameRuntime): number | null {
    const botIds = new Set(bots.map((bot) => bot.player_id));
    const { offerCollectMs, offerPatienceMs } = this.deps.config.bots;
    const now = this.deps.now();
    let next: number | null = null;
    for (const offer of state.offers) {
      if (offer.status !== 'open' || !botIds.has(offer.from)) continue;
      const openedAt = runtime.offerOpenedAt.get(offer.id);
      if (openedAt === undefined) continue;
      for (const boundary of [openedAt + offerCollectMs, openedAt + offerPatienceMs]) {
        if (boundary > now && (next === null || boundary < next)) next = boundary;
      }
    }
    return next;
  }

  private pruneOffers(runtime: GameRuntime, state: GameState): void {
    const open = new Set(state.offers.filter((offer) => offer.status === 'open').map((offer) => offer.id));
    for (const offerId of runtime.offerOpenedAt.keys()) {
      if (!open.has(offerId)) runtime.offerOpenedAt.delete(offerId);
    }
  }

  // -- 內部工具 ---------------------------------------------------------------

  private runtime(gameId: string): GameRuntime {
    let runtime = this.runtimes.get(gameId);
    if (!runtime) {
      runtime = {
        timer: null,
        busy: false,
        dirty: false,
        changedAt: this.deps.now(),
        rolledAt: null,
        offerOpenedAt: new Map(),
        attempts: { revision: -1, next: 0, fallbackBots: new Set() },
        window: { id: -1, commands: new Map() },
      };
      this.runtimes.set(gameId, runtime);
    }
    return runtime;
  }

  private schedule(gameId: string, runtime: GameRuntime, delayMs: number, fn: () => void): void {
    this.clearTimer(runtime);
    if (this.closed || this.runtimes.get(gameId) !== runtime) return;
    const timer = setTimeout(() => {
      runtime.timer = null;
      if (!this.closed) fn();
    }, Math.max(0, delayMs));
    timer.unref?.();
    runtime.timer = timer;
  }

  private clearTimer(runtime: GameRuntime): void {
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = null;
  }

  private forget(gameId: string): void {
    const runtime = this.runtimes.get(gameId);
    if (runtime) this.clearTimer(runtime);
    this.runtimes.delete(gameId);
  }

  private track(task: Promise<unknown>): void {
    const guarded = task.catch((error: unknown) => {
      this.deps.log('warn', 'bot task failed', { error: String(error) });
    });
    this.tasks.add(guarded);
    void guarded.finally(() => this.tasks.delete(guarded));
  }
}
