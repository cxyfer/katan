/**
 * T&B 的 B-GAME 共用工具（T&B 計畫 §6.1–§6.3）：S3–S8 的 `tb-<part>.test.ts` 用它跑 Q1 矩陣與收集 Q2 計數，不必各自寫一套。
 *
 * - `tbMatrix(profileId, players)`：這個 profile 與人數要跑的局。種子用 `seedsFor`（擴充預設 3 個，`BOTS_SEEDS=10` 時 10 個），
 *   座位 standard 與 easy 輪替（`mixedLevels`）；另加 1 個種子讓 bot2 只走保底（`fallbackSeatSeeds(players)[0]`）。
 *   步數上限與看門狗取自 `PROFILE_LIMITS`（`limitsFor`）。
 * - `runTbGame(spec)`：仿 BotDriver 模式跑一局（`runBotGame`），回傳一筆紀錄：勝者、步數、拒絕數、保底次數、最長無創新高、
 *   殘留 pending、守恆（每 50 步與終局，`tbConservationProblems`）、依 standard／easy／fallback 分開的指令計數、每視窗最大指令數、
 *   合約檢查（非行動者只送回應指令、強盜目標在 fold 集合內、standard 的強盜不放自己的格，除非沒有其他合法格；G12）與決策雜湊。
 * - `expectTbGameHealthy(record)`：§6.1 的通過條件。
 *
 * gating 在 S9 之前是關著的：這裡直接以 profile id 開局，策略用 `createBotPolicy(level)`（依 profile 取註冊的模組，不看
 * `botsCanPlay`），保底用 `fallbackPolicy`，所以不必翻開 `TB_READY_PARTS`。
 *
 * 守恆不讀 `RunResult.conservation`：harness 的 base 資源守恆不算 Trains 投標中的牌，投標途中撞到步數上限的局會誤報；
 * `tbConservationProblems` 把投標中的牌算進去。
 */

import { expect } from 'vitest';
import { requireProfile, topologyOf, type GameState } from '@katan/rules';
import { banditTargets } from '../src/base/robber.ts';
import { fallbackPolicy } from '../src/fallback.ts';
import { botCommandLimit, botModulesOf } from '../src/index.ts';
import type { BanditTarget } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import {
  allowedResponseCommands,
  BOT_WINDOW_COMMAND_LIMIT,
  botSeats,
  createDecisionHasher,
  fallbackSeatSeeds,
  limitsFor,
  mixedLevels,
  responseCommandDrift,
  runBotGame,
  seedsFor,
  viewFor,
  withFallbackSeat,
  type Decision,
  type IdleFallback,
  type StepFailure,
  type StepInfo,
  type StuckReport,
  type WatchdogTrip,
} from './harness.ts';
import { tbConservationProblems, tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import type { ModuleTestKit } from './modules/types.ts';

/** 一局的設定。 */
export interface TbGameSpec {
  readonly profileId: string;
  readonly players: number;
  readonly seed: number;
  /** 各座位的難度（`mixedLevels(players, seed)`）。 */
  readonly levels: readonly BotLevel[];
  /** 只走保底的座位（0 起算）；省略表示全部座位走策略。 */
  readonly fallbackSeat?: number;
  /** 斷言訊息用，例如 `tb-fishing-2025 3p seed 2 (seat 2 fallback)`。 */
  readonly label: string;
}

/** 這個 profile 與人數的 B-GAME：`seedsFor` 的種子各一局，加上 bot2 只走保底的一局。 */
export function tbMatrix(profileId: string, players: number): TbGameSpec[] {
  const profile = requireProfile(profileId);
  const spec = (seed: number, fallbackSeat?: number): TbGameSpec => ({
    profileId,
    players,
    seed,
    levels: mixedLevels(players, seed),
    ...(fallbackSeat === undefined ? {} : { fallbackSeat }),
    label: `${profileId} ${players}p seed ${seed}${fallbackSeat === undefined ? '' : ` (seat ${fallbackSeat + 1} fallback)`}`,
  });
  return [...seedsFor(profile).map((seed) => spec(seed)), spec(fallbackSeatSeeds(players)[0]!, 1)];
}

export interface TbGameOptions {
  /** 策略座位的策略；預設 `createBotPolicy(level)`。要包裝模組（例如記下 `answerFrame` 的答案）時傳入。 */
  readonly policyFor?: (level: BotLevel) => BotPolicy;
  /** 模組測試工具；預設 `[tradersBarbariansKit]`（機制計數、回應指令都經它）。 */
  readonly kits?: readonly ModuleTestKit[];
  /** 預設取自 `limitsFor(profileId)`。 */
  readonly maxSteps?: number;
  /** 預設取自 `limitsFor(profileId)`；`null` 關閉。 */
  readonly watchdogRolls?: number | null;
  /** 每幾步檢查一次守恆；預設 50。終局一定檢查。 */
  readonly conservationEvery?: number;
  /** 每個決策套用前回呼（被拒的也會）。 */
  readonly onDecision?: (state: GameState, decision: Decision) => void;
  /** 每個被接受的決策套用後回呼。 */
  readonly onStep?: (step: StepInfo) => void;
}

/** 指令計數的來源：策略座位依難度分，保底座位與「策略閒置時保底代送」都算 fallback。 */
export type TbCommandSource = 'standard' | 'easy' | 'fallback';

export interface TbGameRecord {
  readonly spec: TbGameSpec;
  readonly label: string;
  /** 勝者；沒有終局時是 null。 */
  readonly winner: string | null;
  /** `state.result.reason`；沒有終局時是 null。 */
  readonly reason: string | null;
  readonly steps: number;
  readonly maxSteps: number;
  /** 0 或 1（第一次被拒就停止）。 */
  readonly rejections: number;
  readonly failure: StepFailure | null;
  /** 策略與保底都閒置而卡死。 */
  readonly stuck: StuckReport | null;
  readonly watchdog: WatchdogTrip | null;
  /** 「策略閒置、但保底有動作」的次數（`idleFallbacks.length`）；保底座位自己的指令不算。 */
  readonly fallbacks: number;
  readonly idleFallbacks: readonly IdleFallback[];
  /** 整局最長一段沒有任何玩家創新高的 `turn.roll` 次數（看門狗關閉時為 0）。 */
  readonly longestStagnation: number;
  /** 結束時殘留的 pending kind；沒有是 null。 */
  readonly pending: string | null;
  /** 每 `conservationEvery` 步與終局的守恆問題（`step <n>: …`／`end: …`）。 */
  readonly conservation: readonly string[];
  /** 被接受的指令計數：`commands[source][command.type]`。 */
  readonly commands: Readonly<Record<TbCommandSource, Readonly<Record<string, number>>>>;
  readonly maxWindowCommands: number;
  /** `botCommandLimit(profile, 40)`。 */
  readonly windowLimit: number;
  /** 合約違反：非行動者送了回應指令以外的指令、強盜目標不在 fold 集合內、standard 把強盜放在自己的格。 */
  readonly contract: readonly string[];
  /** 各 kit 的機制計數，鍵為 `<kit id>.<名稱>`（T&B：`tradersBarbarians.<part id>.<名稱>`）。 */
  readonly mechanics: Readonly<Record<string, number>>;
  /** 決策序列的雜湊（`createDecisionHasher`）；同一種子重跑必須相同（R2）。 */
  readonly hash: string;
  readonly state: GameState;
}

/** 某個指令的計數；省略 `source` 時三種來源相加。 */
export function commandCount(record: TbGameRecord, type: string, source?: TbCommandSource): number {
  const sources: readonly TbCommandSource[] = source ? [source] : ['standard', 'easy', 'fallback'];
  return sources.reduce((total, from) => total + (record.commands[from][type] ?? 0), 0);
}

/** 這個 hex 上有建築，而且全部是 `playerId` 的。 */
function ownsOnlyBuildingsOn(state: GameState, playerId: string, hex: number): boolean {
  const vertices = topologyOf(state).vertices;
  const owners = new Set<string>();
  state.board.buildings.forEach((building, vertex) => {
    if (building && vertices[vertex]!.hexes.includes(hex)) owners.add(building.player);
  });
  return owners.size > 0 && [...owners].every((owner) => owner === playerId);
}

/** 跑一局 T&B 的 B-GAME（仿 BotDriver 模式）。 */
export function runTbGame(spec: TbGameSpec, options: TbGameOptions = {}): TbGameRecord {
  const { profileId, players, seed, levels } = spec;
  const profile = requireProfile(profileId);
  const modules = botModulesOf(profile);
  const kits = options.kits ?? [tradersBarbariansKit];
  const limits = limitsFor(profileId);
  const maxSteps = options.maxSteps ?? limits.maxSteps;
  const every = options.conservationEvery ?? 50;
  const policyFor = options.policyFor ?? ((level: BotLevel) => createBotPolicy(level));

  let seats = botSeats(levels.slice(0, players), policyFor);
  if (spec.fallbackSeat !== undefined) seats = withFallbackSeat(seats, spec.fallbackSeat);
  const fallbackSeats = new Set(seats.filter((seat) => seat.policy === fallbackPolicy).map((seat) => seat.id));
  const levelOf = new Map(seats.map((seat) => [seat.id, seat.level]));
  const responses = allowedResponseCommands(profile, kits);

  const hasher = createDecisionHasher();
  const commands: Record<TbCommandSource, Record<string, number>> = { standard: {}, easy: {}, fallback: {} };
  const conservation: string[] = [];
  const contract: string[] = responseCommandDrift(profile, kits).map((drift) => `response command drift: ${drift}`);
  let accepted = 0;

  const checkDecision = (state: GameState, decision: Decision): void => {
    const { actor, command } = decision;
    const where = `seq ${state.seq} ${actor} ${command.type}`;
    const turnActor = state.players[state.turn.seat]?.id;
    if (actor !== turnActor && !responses.has(command.type)) contract.push(`non-actor: ${where}`);
    const hex = command.type === 'pending.moveRobber' || command.type === 'dev.playKnight' ? (command as { hex?: BanditTarget }).hex : undefined;
    if (hex === undefined) return;
    const targets = banditTargets(viewFor(state, actor), actor, modules);
    if (!targets.includes(hex)) contract.push(`${where}: robber target ${String(hex)} is outside the fold set`);
    // standard 的強盜不放自己的格，除非 fold 集合裡沒有其他合法格（G12；`sfck-game.test.ts` 的寫法）。
    const strategy = decision.source !== 'fallback' && !fallbackSeats.has(actor) && levelOf.get(actor) === 'standard';
    if (strategy && hex !== null && ownsOnlyBuildingsOn(state, actor, hex)) {
      const others = targets.filter((target) => target !== null && !ownsOnlyBuildingsOn(state, actor, target));
      if (others.length > 0) contract.push(`${where}: robber on own hex ${hex} with ${others.length} alternatives`);
    }
  };

  const run = runBotGame({
    seats,
    seed,
    profileId,
    maxSteps,
    ...(options.watchdogRolls !== undefined ? { watchdogRolls: options.watchdogRolls } : {}),
    kits,
    onDecision: (state, decision) => {
      hasher.onDecision(state, decision);
      checkDecision(state, decision);
      options.onDecision?.(state, decision);
    },
    onStep: (step) => {
      const source: TbCommandSource =
        step.source === 'fallback' || fallbackSeats.has(step.actor) ? 'fallback' : step.level === 'easy' ? 'easy' : 'standard';
      commands[source][step.command.type] = (commands[source][step.command.type] ?? 0) + 1;
      accepted += 1;
      if (accepted % every === 0) for (const problem of tbConservationProblems(step.after)) conservation.push(`step ${accepted}: ${problem}`);
      options.onStep?.(step);
    },
  });
  for (const problem of tbConservationProblems(run.state)) conservation.push(`end: ${problem}`);

  return {
    spec,
    label: spec.label,
    winner: run.state.result?.playerId ?? null,
    reason: run.state.result?.reason ?? null,
    steps: run.steps,
    maxSteps,
    rejections: run.rejections,
    failure: run.failure,
    stuck: run.stuck,
    watchdog: run.watchdog,
    fallbacks: run.idleFallbacks.length,
    idleFallbacks: run.idleFallbacks,
    longestStagnation: run.longestStagnation,
    pending: run.state.pending?.kind ?? null,
    conservation,
    commands,
    maxWindowCommands: run.maxWindowCommands,
    windowLimit: botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT),
    contract,
    mechanics: run.mechanics,
    hash: hasher.digest(),
    state: run.state,
  };
}

export interface TbHealthOptions {
  /**
   * 要求在步數上限內分出勝負（預設 true）。part 策略還是 stub 時可以關掉；關掉時不檢查勝者與看門狗，殘留 pending 也只在
   * 已經終局時檢查（撞到步數上限的局本來就可能停在 frame 中間）。
   */
  readonly requireWinner?: boolean;
}

/**
 * §6.1 的通過條件：0 拒絕、沒有卡死、在步數上限內分出勝負（看門狗沒有觸發）、沒有殘留 pending、守恆、沒有「策略閒置、
 * 但保底有動作」、每視窗指令數不超過上限、合約檢查通過。B-FAIR、fuzz 與 Q2 門檻由各 part 的測試另外斷言。
 */
export function expectTbGameHealthy(record: TbGameRecord, options: TbHealthOptions = {}): void {
  const { label } = record;
  const requireWinner = options.requireWinner ?? true;
  expect(record.failure, `${label}: rejected ${JSON.stringify(record.failure)}`).toBeNull();
  expect(record.rejections, `${label}: rejections`).toBe(0);
  expect(record.stuck, `${label}: both policy and fallback idle ${JSON.stringify(record.stuck)}`).toBeNull();
  if (requireWinner) {
    expect(record.watchdog, `${label}: watchdog tripped ${JSON.stringify(record.watchdog)}`).toBeNull();
    expect(record.reason, `${label}: no victory within ${record.maxSteps} steps (${record.steps})`).toBe('victory');
  }
  if (requireWinner || record.reason !== null) expect(record.pending, `${label}: unresolved pending`).toBeNull();
  expect(record.conservation, `${label}: conservation`).toEqual([]);
  expect(record.idleFallbacks, `${label}: policy idled while fallback acted`).toEqual([]);
  expect(record.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(record.windowLimit);
  expect(record.contract, `${label}: contract`).toEqual([]);
}
