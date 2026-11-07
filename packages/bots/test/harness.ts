/**
 * 不經伺服器、直接以規則引擎驅動 Bot 對局的測試工具。
 *
 * 平台化（策略 §4.6）：
 * - `newBotGame({ profileId, players, seed, setupMode? })` 適用任何 profile。
 * - 預設以「仿 BotDriver」模式對局：策略回 null 時改用保底（與 `packages/server/src/bot-driver.ts`
 *   相同），並分開統計「策略閒置、但保底有動作」（B-GAME 失敗）與「兩者都閒置」（卡死）。
 * - 進度看門狗：連續 N 次 `turn.roll` 都沒有任何玩家的分數創新高就判為失敗。
 * - 模組的守恆檢查、擾動與機制計數都經 `modules/types.ts` 的 `ModuleTestKit`；沒有 kit 時
 *   行為與 base 完全相同。
 *
 * 仿 BotDriver 模式的範圍：它只模擬「策略回 null 時改問保底」與報價時鐘，**不**模擬 server 的強制
 * 保底路徑（行動視窗達指令上限、策略丟例外、指令被規則引擎拒絕後改走保底）。這些路徑在測試裡都是
 * 失敗：例外直接往外丟，被拒就停止並回報 `failure`，視窗指令數則回報 `maxWindowCommands` 讓測試
 * 斷言沒有逼近上限。所以 B-GAME 通過，代表真實 server 不會需要走這些路徑。
 */

import {
  actionHints,
  applyCommand,
  createGame,
  PLAYER_COLORS,
  projectGame,
  PROFILES,
  requireProfile,
  RESOURCES,
  scoreOf,
  seededRng,
  type DevCardType,
  type GameEvent,
  type GameState,
  type GameView,
  type ProfileDefinition,
  type Rng,
  type SetupMode,
} from '@catan/rules';
import { botActingOrder } from '../src/order.ts';
import { botSeed } from '../src/seed.ts';
import {
  botOwesAction,
  botResponseCommands,
  botsCanPlay,
  createBotPolicy,
  fallbackPolicy,
  type OwedAction,
} from '../src/index.ts';
import type { BotModule } from '../src/modules/types.ts';
import type { BotCommand, BotLevel, BotPolicy, OfferPhase } from '../src/types.ts';
import { dedicatedProfileIds } from './families.ts';
import baseV040 from './golden/base-v040.json';
import { canonicalJson, createFnv64, type GoldenRecord } from './golden/driver.ts';
import type { MechanicsTally, ModuleTestKit } from './modules/types.ts';

// 本套件不載入 Node 型別（src 不得使用 Node API）；計時與環境變數只需要這兩個全域。
declare const performance: { now(): number };
declare const process: { env: Record<string, string | undefined> };

/** 整局模擬在忙碌的機器上可能超過預設的 5 秒；所有對局測試統一用 120 秒。 */
export const GAME_TIMEOUT = 120_000;

export interface BotSeat {
  id: string;
  level: BotLevel;
  policy: BotPolicy;
}

// ---------------------------------------------------------------------------
// 開局
// ---------------------------------------------------------------------------

/** base 的 profile：5 人以上用 paired。 */
export function baseProfileFor(players: number): string {
  return players >= 5 ? 'base-paired-2025' : 'base-2025';
}

/**
 * profile 允許 `variable` 時用它，否則取第一個模式。不能直接取第一個：base 的模式是
 * `['fixed', 'variable']`，那會讓 base 變成 `fixed`，golden replay 也會失敗。
 */
export function defaultSetupMode(profile: Pick<ProfileDefinition, 'setupModes'>): SetupMode {
  return profile.setupModes.includes('variable') ? 'variable' : profile.setupModes[0]!;
}

export interface NewGameOptions {
  profileId: string;
  players: number;
  seed: number;
  setupMode?: SetupMode;
}

export function newBotGame(options: NewGameOptions): { state: GameState; rng: Rng } {
  const profile = requireProfile(options.profileId);
  const rng = seededRng(options.seed);
  const state = createGame({
    profileId: options.profileId,
    players: Array.from({ length: options.players }, (_, index) => ({
      id: `bot${index + 1}`,
      nickname: `Bot ${index + 1}`,
      color: PLAYER_COLORS[index]!,
    })),
    setupMode: options.setupMode ?? defaultSetupMode(profile),
    rng,
  });
  return { state, rng };
}

/** 與伺服器相同的投影：自己座位的 view 加上 hints。 */
export function viewFor(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

export function mixedLevels(players: number, seed: number): BotLevel[] {
  return Array.from({ length: players }, (_, index) => ((index + seed) % 2 === 0 ? 'standard' : 'easy'));
}

// ---------------------------------------------------------------------------
// 測試矩陣、種子數與上限
// ---------------------------------------------------------------------------

export interface MatrixEntry {
  readonly profile: ProfileDefinition;
  readonly players: number;
}

/** 開放且 Bot 玩得動的每個（profile, 人數）。開放新 profile 時，通用測試會自動納入。 */
export const BOT_TEST_MATRIX: readonly MatrixEntry[] = PROFILES.filter(
  (profile) => profile.enabled && botsCanPlay(profile),
).flatMap((profile) => profile.playerCounts.map((players) => ({ profile, players })));

/**
 * 通用測試實際跑的矩陣：跳過已由 family 測試檔涵蓋的 profile（`families.ts`），避免重跑。
 * 通用測試檔（`GENERIC_MATRIX_FILES`）都以它為準。
 */
export const GENERIC_MATRIX: readonly MatrixEntry[] = (() => {
  const dedicated = dedicatedProfileIds();
  return BOT_TEST_MATRIX.filter((entry) => !dedicated.has(entry.profile.id));
})();

/** base 的種子數：現行閘門，每個人數 10 個。 */
export const BASE_SEED_COUNT = 10;
/** 擴充 profile 的預設種子數；發布閘門以 `BOTS_SEEDS=10` 覆寫（RELEASING.md Pre-flight）。 */
export const EXTENSION_SEED_COUNT = 3;

function isBaseProfile(profile: Pick<ProfileDefinition, 'ruleModules'>): boolean {
  return profile.ruleModules.length === 0;
}

/** `BOTS_SEEDS`：擴充 profile 的種子數；沒設定時用預設，設了卻不是正整數就報錯，不默默少跑。 */
export function extensionSeedCount(): number {
  const raw = process.env.BOTS_SEEDS;
  if (raw === undefined || raw === '') return EXTENSION_SEED_COUNT;
  // 只收十進位正整數：Number() 會接受 '1e1'、' 3'、'0x3'，那些都不是使用者想要的種子數。
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`BOTS_SEEDS must be a positive integer, got "${raw}"`);
  return Number(raw);
}

/** B-GAME 的種子（1 起算）：base 固定 10 個，擴充 profile 預設 3 個、可由 `BOTS_SEEDS` 覆寫。 */
export function seedsFor(profile: Pick<ProfileDefinition, 'ruleModules'>): number[] {
  const count = isBaseProfile(profile) ? BASE_SEED_COUNT : extensionSeedCount();
  return Array.from({ length: count }, (_, index) => index + 1);
}

/**
 * 每個行動視窗內單一座位最多送幾個指令；超過後 BotDriver 只走保底。測試以
 * `botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT)` 斷言。
 *
 * **必須與 server 的基礎上限一致**：`packages/server/src/bot-driver.ts` 目前叫
 * `MAX_BOT_COMMANDS_PER_WINDOW`，PL-3 改名為 `BASE_COMMANDS_PER_WINDOW`。改任何一邊時兩邊一起改，
 * 否則測試斷言的上限與 server 實際強制保底的上限就對不上。
 */
export const BOT_WINDOW_COMMAND_LIMIT = 40;

/** 每個 profile 的對局上限。 */
export interface GameLimits {
  /** 步數上限（被規則引擎接受的指令數）。 */
  maxSteps: number;
  /** 進度看門狗 N：連續幾次 `turn.roll` 都沒有任何玩家創新高就判為失敗。 */
  watchdogRolls: number;
}

/**
 * 預設上限。
 *
 * 步數 5000 沿用 v0.4.0 的 B-GAME（實測 base 40 局最長 572 步）。
 *
 * 看門狗 N = 60 的依據（實測，`createWatchdog` 的「創新高」定義）：
 * - base 的 B-GAME（3–6 人 × 種子 1–10，共 40 局，全部終局）最長一段沒有任何玩家創新高是
 *   31 次擲骰（3 人種子 3），其餘多為 5–24。
 * - Seafarers 計畫（§6.1）實測：已終局的 naive／原型最長 25–32 次，活鎖局則為 933–1,513 次。
 * N = 60 約為已終局最長值的 2 倍，而活鎖大約 400 步內就能抓到。要放寬或收緊某個 profile，
 * 在 `PROFILE_LIMITS` 加一筆，並把量測寫在那裡。
 */
export const DEFAULT_LIMITS: GameLimits = { maxSteps: 5000, watchdogRolls: 60 };

/** 逐 profile 覆寫；沒有列出的 profile 用 `DEFAULT_LIMITS`。擴充 profile 需要時在這裡加一筆。 */
const PROFILE_LIMITS: Readonly<Record<string, Partial<GameLimits>>> = {
  // Seafarers（SF 計畫 §6.1 真實策略 40 局實測）：混座已終局最長 761 步（6p seed 1，3p 410、4p 473、5p 529），最長一段無創新高為 28 次擲骰（3p seed 9，其餘局 5–20 次）；看門狗 N=60 約為最長停滯的 2.1 倍餘裕，40 局全數終局未觸發。
  'sf-new-shores-2025': { maxSteps: 5000, watchdogRolls: 60 },
  'sf-new-shores-paired-2025': { maxSteps: 5000, watchdogRolls: 60 },
};

export function limitsFor(profileId: string): GameLimits {
  return { ...DEFAULT_LIMITS, ...PROFILE_LIMITS[profileId] };
}

// ---------------------------------------------------------------------------
// 進度看門狗
// ---------------------------------------------------------------------------

export interface Watchdog {
  /**
   * 記錄一次擲骰後各玩家的分數；回傳是否已達上限。任何玩家的分數超過「自己先前的最高分」
   * 就歸零。用「創新高」而不是「有變化」，因為失去城市、最長道路易手都會讓分數下降。
   */
  roll(scores: readonly number[]): boolean;
  /** 目前連續沒有創新高的擲骰次數。 */
  readonly stagnant: number;
  /** 整局最長的一段。 */
  readonly longest: number;
}

export function createWatchdog(limit: number): Watchdog {
  let best: number[] = [];
  let stagnant = 0;
  let longest = 0;
  return {
    roll(scores) {
      let improved = false;
      scores.forEach((score, index) => {
        if (best[index] === undefined || score > best[index]!) {
          best[index] = score;
          improved = true;
        }
      });
      stagnant = improved ? 0 : stagnant + 1;
      longest = Math.max(longest, stagnant);
      return stagnant >= limit;
    },
    get stagnant() {
      return stagnant;
    },
    get longest() {
      return longest;
    },
  };
}

// ---------------------------------------------------------------------------
// 決策
// ---------------------------------------------------------------------------

export interface Decision {
  actor: string;
  command: BotCommand;
  /** 指令來自策略，還是策略閒置時由保底代為送出。省略視為策略。 */
  source?: 'policy' | 'fallback';
}

export type OfferPhases = (botId: string, state: GameState) => Readonly<Record<string, OfferPhase>>;

/** 行動者是否正在等自己 open 報價的回應（報價時鐘尚未 expired）；此時策略回 null 是正常的。 */
export function waitingOnOwnOffers(
  state: GameState,
  botId: string,
  phases: Readonly<Record<string, OfferPhase>>,
): boolean {
  if (state.players[state.turn.seat]?.id !== botId) return false;
  return state.offers.some(
    (offer) => offer.from === botId && offer.status === 'open' && (phases[offer.id] ?? 'expired') !== 'expired',
  );
}

/**
 * 依排程順序詢問各 Bot，回傳第一個非 null 的決策；全部在等待時回傳 null。
 *
 * 傳入 `fallback` 時模擬 BotDriver（`bot-driver.ts:331-343`）：座位的策略回 null，而且不是
 * 「行動者在等自己報價的回應」時，改問保底；保底有動作就回傳（`source: 'fallback'`）。
 */
export function nextDecision(
  state: GameState,
  seats: readonly BotSeat[],
  offerPhases: OfferPhases = () => ({}),
  onDecide?: (botId: string, elapsedMs: number) => void,
  fallback?: BotPolicy,
): Decision | null {
  const order = botActingOrder(
    viewFor(state, seats[0]!.id),
    seats.map((seat) => seat.id),
  );
  for (const id of order) {
    const seat = seats.find((candidate) => candidate.id === id)!;
    const view = viewFor(state, id);
    const phases = offerPhases(id, state);
    const ctx = { selfId: id, level: seat.level, seed: botSeed('test', id, state.seq), offerPhases: phases };
    const started = performance.now();
    const command = seat.policy.decide(view, ctx);
    onDecide?.(id, performance.now() - started);
    if (command) return { actor: id, command, source: 'policy' };
    if (!fallback || waitingOnOwnOffers(state, id, phases)) continue;
    const rescue = fallback.decide(view, ctx);
    if (rescue) return { actor: id, command: rescue, source: 'fallback' };
  }
  return null;
}

/**
 * 以步數模擬報價階段（規格 §10）：報價建立後第一次輪詢為 collecting，下一次為
 * ready，之後為 expired。每當所有座位都在等待時，時鐘前進一格。
 */
export function createOfferClock(): { phases: OfferPhases; tick(state: GameState): void } {
  const age = new Map<string, number>();
  return {
    phases(botId, state) {
      const out: Record<string, OfferPhase> = {};
      for (const offer of state.offers) {
        if (offer.from !== botId || offer.status !== 'open') continue;
        const ticks = age.get(offer.id) ?? 0;
        out[offer.id] = ticks === 0 ? 'collecting' : ticks === 1 ? 'ready' : 'expired';
      }
      return out;
    },
    tick(state) {
      for (const offer of state.offers) {
        if (offer.status === 'open') age.set(offer.id, (age.get(offer.id) ?? 0) + 1);
      }
    },
  };
}

export interface StepFailure {
  actor: string;
  command: BotCommand;
  code: string;
  params: Record<string, unknown> | undefined;
}

/** 套用一個決策；被拒時回傳失敗細節，方便測試訊息定位。 */
export function applyDecision(
  state: GameState,
  decision: Decision,
  rng: Rng,
):
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; failure: StepFailure } {
  const outcome = applyCommand(state, decision.actor, decision.command, rng);
  if (outcome.ok) return { ok: true, state: outcome.state, events: outcome.events };
  return {
    ok: false,
    failure: {
      actor: decision.actor,
      command: decision.command,
      code: outcome.error.code,
      params: outcome.error.params,
    },
  };
}

export function botSeats(levels: readonly BotLevel[], policyFor: (level: BotLevel) => BotPolicy): BotSeat[] {
  return levels.map((level, index) => ({ id: `bot${index + 1}`, level, policy: policyFor(level) }));
}

/** 把座位換成只走保底的座位（保底席）。 */
export function withFallbackSeat(seats: readonly BotSeat[], index: number): BotSeat[] {
  return seats.map((seat, at) => (at === index ? { ...seat, policy: fallbackPolicy } : seat));
}

/**
 * naive 座位：只保留模組的 `duty`（以及不屬於策略的 `supports`、節奏與上限），等於
 * v0.4.0 的 base 策略加上模組的保底義務。用於和正式策略對照強度。
 */
export function naiveModule(module: BotModule): BotModule {
  return {
    id: module.id,
    ...(module.supports ? { supports: module.supports } : {}),
    ...(module.duty ? { duty: module.duty } : {}),
    ...(module.pacing ? { pacing: module.pacing } : {}),
    ...(module.maxCommandsPerWindow !== undefined ? { maxCommandsPerWindow: module.maxCommandsPerWindow } : {}),
    ...(module.responseCommands ? { responseCommands: module.responseCommands } : {}),
  };
}

export function naivePolicy(level: BotLevel, modules: readonly BotModule[]): BotPolicy {
  return createBotPolicy(level, { modules: modules.map(naiveModule) });
}

// ---------------------------------------------------------------------------
// 對局
// ---------------------------------------------------------------------------

/** 一個被接受的決策，連同 `applyCommand` 回傳的 events。 */
export interface StepInfo {
  readonly actor: string;
  readonly level: BotLevel;
  readonly command: BotCommand;
  readonly source: 'policy' | 'fallback';
  readonly before: GameState;
  readonly after: GameState;
  readonly events: readonly GameEvent[];
}

export interface RunOptions {
  seats: readonly BotSeat[];
  seed: number;
  /** 預設 `baseProfileFor(seats.length)`。 */
  profileId?: string;
  setupMode?: SetupMode;
  /** 預設取自 `limitsFor(profileId)`。 */
  maxSteps?: number;
  /** 看門狗 N；`null` 關閉（只走保底的有界局不會得分，必須關閉）。預設取自 `limitsFor(profileId)`。 */
  watchdogRolls?: number | null;
  /**
   * 仿 BotDriver 模式（預設開啟）：策略回 null 時改用保底，並統計 `idleFallbacks`；關閉時只問
   * 策略，與 v0.4.0 的 harness 相同。
   */
  driverMode?: boolean;
  /** 仿 BotDriver 模式的保底；預設 `fallbackPolicy`（server 也是呼叫它）。 */
  fallback?: BotPolicy;
  /** 這個 profile 的模組測試工具；省略表示沒有模組。 */
  kits?: readonly ModuleTestKit[];
  /** 每個決策在套用之前回呼一次（被規則引擎拒絕的決策也會，隨後 `failure` 會有值）。 */
  onDecision?: (state: GameState, decision: Decision) => void;
  /** 每個被接受的決策套用之後回呼一次。 */
  onStep?: (step: StepInfo) => void;
}

/** 策略閒置、但保底有動作：B-GAME 失敗（server 只會留 debug 日誌）。 */
export interface IdleFallback {
  seq: number;
  actor: string;
  command: string;
  /** `botOwesAction` 的判斷；null 表示保底動了、卻不欠動作（兩者的判定不一致）。 */
  owed: OwedAction | null;
}

/** 兩者都閒置：沒有任何座位動作，而且報價時鐘也推不動。 */
export interface StuckReport {
  seq: number;
  /** 此刻欠動作的座位（`botOwesAction`）；空陣列表示沒有人欠動作，局面卻沒有結束。 */
  owed: { id: string; action: OwedAction }[];
  phase: string;
}

export interface WatchdogTrip {
  seq: number;
  rolls: number;
  steps: number;
  scores: number[];
}

export interface RunResult {
  state: GameState;
  steps: number;
  /** 被規則引擎拒絕的第一個決策（拒絕後不再繼續）。 */
  failure: StepFailure | null;
  /** 兩者都閒置而卡死（`stuck !== null`）。 */
  stalled: boolean;
  stuck: StuckReport | null;
  watchdog: WatchdogTrip | null;
  decide: { count: number; totalMs: number; maxMs: number };
  /** 策略閒置、但保底有動作的次數與明細；B-GAME 要求為 0。 */
  idleFallbacks: IdleFallback[];
  /** 拒絕數（0 或 1：第一次被拒就停止）。 */
  rejections: number;
  /** 整局最長的無創新高擲骰數（看門狗關閉時為 0）。 */
  longestStagnation: number;
  /** 每個行動視窗內單一座位送出的最多指令數（BotDriver 在 40 之後改走保底）。 */
  maxWindowCommands: number;
  /** 各 kit 的機制計數，鍵為 `<kit id>.<名稱>`。 */
  mechanics: Record<string, number>;
  /** 終局時的守恆檢查結果（base 資源加上各 kit）；空陣列表示通過。 */
  conservation: string[];
}

/** 從開局跑到結束（或步數上限），每一步都由 Bot 決策並交給規則引擎驗證。 */
export function runBotGame(options: RunOptions): RunResult {
  const { seats, seed } = options;
  const profileId = options.profileId ?? baseProfileFor(seats.length);
  const limits = limitsFor(profileId);
  const maxSteps = options.maxSteps ?? limits.maxSteps;
  const watchdogLimit = options.watchdogRolls === undefined ? limits.watchdogRolls : options.watchdogRolls;
  const kits = options.kits ?? [];
  const fallback = options.driverMode === false ? undefined : (options.fallback ?? fallbackPolicy);
  let { state, rng } = newBotGame({
    profileId,
    players: seats.length,
    seed,
    ...(options.setupMode ? { setupMode: options.setupMode } : {}),
  });
  const clock = createOfferClock();
  const decide = { count: 0, totalMs: 0, maxMs: 0 };
  const onDecide = (_botId: string, elapsed: number): void => {
    decide.count += 1;
    decide.totalMs += elapsed;
    decide.maxMs = Math.max(decide.maxMs, elapsed);
  };
  const tallies: { id: string; tally: MechanicsTally }[] = kits.flatMap((kit) =>
    kit.mechanics ? [{ id: kit.id, tally: kit.mechanics() }] : [],
  );
  const watchdog = watchdogLimit === null ? null : createWatchdog(watchdogLimit);
  const idleFallbacks: IdleFallback[] = [];
  let window = { id: -1, commands: new Map<string, number>() };
  let maxWindowCommands = 0;
  let steps = 0;
  let idle = 0;
  let failure: StepFailure | null = null;
  let stuck: StuckReport | null = null;
  let tripped: WatchdogTrip | null = null;

  while (steps < maxSteps && !state.result) {
    const decision = nextDecision(state, seats, clock.phases, onDecide, fallback);
    if (!decision) {
      // 只有在等報價回應時才允許等待；時鐘最多前進三格就一定會撤回。
      if (idle < 3 && state.offers.some((offer) => offer.status === 'open')) {
        clock.tick(state);
        idle += 1;
        continue;
      }
      stuck = stuckReport(state, seats);
      break;
    }
    idle = 0;
    options.onDecision?.(state, decision);
    if (decision.source === 'fallback') {
      const owed = botOwesAction(viewFor(state, decision.actor), decision.actor);
      idleFallbacks.push({ seq: state.seq, actor: decision.actor, command: decision.command.type, owed });
    }
    const outcome = applyDecision(state, decision, rng);
    if (!outcome.ok) {
      failure = outcome.failure;
      break;
    }
    const before = state;
    state = outcome.state;
    steps += 1;

    // 視窗內的指令數，與 BotDriver 一樣以套用前的視窗計。
    if (before.windowId !== window.id) window = { id: before.windowId, commands: new Map() };
    const used = (window.commands.get(decision.actor) ?? 0) + 1;
    window.commands.set(decision.actor, used);
    maxWindowCommands = Math.max(maxWindowCommands, used);

    if (tallies.length > 0 || options.onStep) {
      const step: StepInfo = {
        actor: decision.actor,
        level: seats.find((seat) => seat.id === decision.actor)!.level,
        command: decision.command,
        source: decision.source ?? 'policy',
        before,
        after: state,
        events: outcome.events,
      };
      for (const { tally } of tallies) tally.observe(step);
      options.onStep?.(step);
    }

    // 以指令型別判斷擲骰。前提：所有 profile／模組都經 `turn.roll` 擲骰（`packages/rules/src/engine.ts`
    // 的 `applyCommand` 只有這一條路徑呼叫 `rollDice`）；若將來有模組另開擲骰指令，要改看 `turn.rolled` event。
    if (watchdog && decision.command.type === 'turn.roll') {
      const scores = state.players.map((player) => scoreOf(state, player.id, { includeHidden: true }));
      if (watchdog.roll(scores)) {
        tripped = { seq: state.seq, rolls: watchdog.stagnant, steps, scores };
        break;
      }
    }
  }

  const mechanics: Record<string, number> = {};
  for (const { id, tally } of tallies) {
    for (const [name, count] of Object.entries(tally.snapshot())) mechanics[`${id}.${name}`] = count;
  }
  return {
    state,
    steps,
    failure,
    stalled: stuck !== null,
    stuck,
    watchdog: tripped,
    decide,
    idleFallbacks,
    rejections: failure ? 1 : 0,
    longestStagnation: watchdog?.longest ?? 0,
    maxWindowCommands,
    mechanics,
    conservation: conservationProblems(state, kits),
  };
}

function stuckReport(state: GameState, seats: readonly BotSeat[]): StuckReport {
  const owed = seats.flatMap((seat) => {
    const action = botOwesAction(viewFor(state, seat.id), seat.id);
    return action ? [{ id: seat.id, action }] : [];
  });
  return { seq: state.seq, owed, phase: state.turn.phase };
}

// ---------------------------------------------------------------------------
// 守恆與合約檢查（base 加上各 kit）
// ---------------------------------------------------------------------------

/** 銀行加上所有手牌的資源總量，應等於 profile 的供應量。 */
export function supplyTotal(state: GameState): number {
  const hands = state.players.reduce(
    (sum, player) => sum + RESOURCES.reduce((inner, resource) => inner + player.resources[resource], 0),
    0,
  );
  return hands + RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);
}

/** base 的資源守恆，加上各 kit 的 `conservation`。回傳違反的描述，空陣列表示通過。 */
export function conservationProblems(state: GameState, kits: readonly ModuleTestKit[] = []): string[] {
  const problems: string[] = [];
  const expected = requireProfile(state.profileId).bankPerResource * RESOURCES.length;
  const actual = supplyTotal(state);
  if (actual !== expected) problems.push(`resource supply ${actual} != ${expected}`);
  for (const kit of kits) {
    for (const problem of kit.conservation?.(state) ?? []) problems.push(`${kit.id}: ${problem}`);
  }
  return problems;
}

/** 非行動者可以送出的指令：base 加上各模組的 `responseCommands`，再加上 kit 宣告的。 */
export function allowedResponseCommands(
  profile: Pick<ProfileDefinition, 'ruleModules'>,
  kits: readonly ModuleTestKit[] = [],
): ReadonlySet<string> {
  const out = new Set(botResponseCommands(profile));
  for (const kit of kits) for (const type of kit.responseCommands ?? []) out.add(type);
  return out;
}

/** kit 宣告、但 `botResponseCommands(profile)` 沒有的指令：模組的宣告與測試漂移了。 */
export function responseCommandDrift(
  profile: Pick<ProfileDefinition, 'ruleModules'>,
  kits: readonly ModuleTestKit[] = [],
): string[] {
  const declared = botResponseCommands(profile);
  return kits.flatMap((kit) =>
    (kit.responseCommands ?? []).filter((type) => !declared.has(type)).map((type) => `${kit.id}: ${type}`),
  );
}

// ---------------------------------------------------------------------------
// B-FAIR 與 fuzz 的擾動（base 加上各 kit）
// ---------------------------------------------------------------------------

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/**
 * 只改動 `viewerId` 看不到的資訊：手牌張數與各資源總量都不變，再加上各 kit 的
 * `hideDifferently`。`changed` 為 false 表示沒有東西可以改。
 */
export function hideDifferently(
  state: GameState,
  viewerId: string,
  kits: readonly ModuleTestKit[] = [],
): { variant: GameState; changed: boolean } {
  const variant = cloneState(state);
  let changed = false;
  const opponents = variant.players.filter((player) => player.id !== viewerId);
  // 兩位對手各交換一張不同的資源。
  outer: for (const a of opponents) {
    for (const b of opponents) {
      if (a === b) continue;
      for (const give of RESOURCES) {
        for (const take of RESOURCES) {
          if (give === take || a.resources[give] === 0 || b.resources[take] === 0) continue;
          a.resources[give] -= 1;
          a.resources[take] += 1;
          b.resources[take] -= 1;
          b.resources[give] += 1;
          changed = true;
          break outer;
        }
      }
    }
  }
  // 對手的一張未公開發展卡與牌庫交換身分，再把牌庫倒序。
  for (const player of opponents) {
    const index = player.devCards.findIndex((card) => variant.devDeck.some((other) => other !== card));
    if (index < 0) continue;
    const deckIndex = variant.devDeck.findIndex((other) => other !== player.devCards[index]);
    const card = player.devCards[index]!;
    player.devCards[index] = variant.devDeck[deckIndex]!;
    variant.devDeck[deckIndex] = card;
    changed = true;
    break;
  }
  if (variant.devDeck.length > 1) {
    variant.devDeck.reverse();
    changed = true;
  }
  for (const kit of kits) {
    if (kit.hideDifferently?.(variant, viewerId)) changed = true;
  }
  return { variant, changed };
}

const DEV_CARDS: DevCardType[] = ['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly'];

/**
 * 隨機改動一個狀態，同時維持銀行與手牌非負、供應總量不變，再交給各 kit 的 `perturb`。
 * 真實對局中不會變的東西保持不變：待棄牌玩家的手牌（應棄張數由它決定），以及已記錄的報價同意
 * （同意後到結算前，同意者的手牌不會變動）。
 */
export function perturbState(state: GameState, rng: Rng, kits: readonly ModuleTestKit[] = []): GameState {
  const next = cloneState(state);
  const pending = next.pending;
  const frozen = new Set(pending?.kind === 'discard' ? Object.keys(pending.required) : []);
  for (const offer of next.offers) if (offer.status === 'open') offer.responses = {};
  const movable = next.players.filter((player) => !frozen.has(player.id));
  for (const player of movable) {
    for (const resource of RESOURCES) {
      next.bank[resource] += player.resources[resource];
      player.resources[resource] = 0;
    }
  }
  const scarce = rng.int(3) === 0 ? RESOURCES[rng.int(RESOURCES.length)]! : null;
  for (const player of movable) {
    for (const resource of RESOURCES) {
      const wanted = rng.int(resource === scarce ? 1 : 5);
      const amount = Math.min(wanted, next.bank[resource]);
      player.resources[resource] = amount;
      next.bank[resource] -= amount;
    }
    // 偶爾把某種資源的銀行存量抽乾。
    if (scarce && next.bank[scarce] > 0 && rng.int(2) === 0) {
      player.resources[scarce] += next.bank[scarce];
      next.bank[scarce] = 0;
    }
    if (rng.int(2) === 0) {
      const cards = Array.from({ length: rng.int(4) }, () => DEV_CARDS[rng.int(DEV_CARDS.length)]!);
      player.devCards = cards;
      player.newDevCards = rng.int(3) === 0 ? [DEV_CARDS[rng.int(DEV_CARDS.length)]!] : [];
    }
  }
  if (rng.int(2) === 0) next.turn.devCardPlayed = false;
  for (const kit of kits) kit.perturb?.(next, rng);
  return next;
}

// ---------------------------------------------------------------------------
// 與 v0.4.0 golden 比對（base 的決策序列不得因平台化而改變）
// ---------------------------------------------------------------------------

const GOLDEN: readonly GoldenRecord[] = baseV040 as unknown as readonly GoldenRecord[];

/** fixture 的全部記錄（48 局）。 */
export const GOLDEN_RECORDS: readonly GoldenRecord[] = GOLDEN;

/** 有 golden 記錄的 profile（base）。 */
const GOLDEN_PROFILE_IDS: ReadonlySet<string> = new Set(GOLDEN.map((record) => record.profileId));

export const goldenId = {
  bGame: (players: number, seed: number): string => `b-game/${players}p/seed${seed}`,
  fallbackSeat: (players: number, seed: number): string => `fallback-seat/${players}p/seed${seed}`,
  wrapped: (players: number, seed: number): string => `wrapped/${players}p/seed${seed}`,
  allFallback: (players: number, seed: number): string => `all-fallback/${players}p/seed${seed}`,
};

/** 保底席的種子：4 人沿用 golden 的 21–23，其餘人數各 1 個（每個 profile × 人數至少一局）。 */
export function fallbackSeatSeeds(players: number): number[] {
  return players === 4 ? [21, 22, 23] : [21];
}
/** 經過 `createBotPolicy` 的那一局（4 人）。 */
export const WRAPPED_SEED = 31;
/** 全保底有界局：每個人數跑這些種子、每局這麼多步；只有種子 1 有 golden 記錄。 */
export const ALL_FALLBACK_SEEDS: readonly number[] = [1, 2, 3];
export const ALL_FALLBACK_STEPS = 800;

/**
 * 這個矩陣項目必須與 golden 逐局相同的記錄 id；非 base 的 profile 沒有記錄，回傳空陣列。
 * 通用測試以它決定要比對哪些局，`matrix.test.ts` 再斷言所有項目合起來剛好是 fixture 的 48 局，
 * 所以矩陣少了 base 項目時，比對不會默默消失。
 */
export function goldenIdsFor({ profile, players }: MatrixEntry): string[] {
  if (!GOLDEN_PROFILE_IDS.has(profile.id)) return [];
  return [
    ...seedsFor(profile).map((seed) => goldenId.bGame(players, seed)),
    ...(players === 4
      ? [...fallbackSeatSeeds(players).map((seed) => goldenId.fallbackSeat(players, seed)), goldenId.wrapped(players, WRAPPED_SEED)]
      : []),
    goldenId.allFallback(players, 1),
  ];
}

/** 決策序列的雜湊，算法與 golden 相同（鍵排序的 JSON，FNV-1a 64）。 */
export function createDecisionHasher(): { onDecision(state: GameState, decision: Decision): void; digest(): string } {
  const hasher = createFnv64();
  return {
    onDecision: (_state, decision) => {
      hasher.update(`${canonicalJson({ actor: decision.actor, command: decision.command })}\n`);
    },
    digest: () => hasher.digest(),
  };
}

/** 一局與 golden 記錄的差異（步數、seq、勝者、結束原因、雜湊）；空陣列表示逐項相同。 */
export function goldenMismatches(id: string, run: Pick<RunResult, 'steps' | 'state'>, hash: string): string[] {
  const record = GOLDEN.find((candidate) => candidate.id === id);
  if (!record) return [`${id}: missing from the golden fixture`];
  const actual = {
    steps: run.steps,
    seq: run.state.seq,
    winner: run.state.result?.playerId ?? null,
    reason: run.state.result?.reason ?? null,
    hash,
  };
  return (['steps', 'seq', 'winner', 'reason', 'hash'] as const)
    .filter((key) => actual[key] !== record[key])
    .map((key) => `${id}: ${key} expected ${String(record[key])}, got ${String(actual[key])}`);
}
