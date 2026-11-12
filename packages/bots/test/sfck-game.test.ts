/**
 * Seafarers + Cities & Knights B-GAME、保底席、全保底有界局、B-POLICY 決定性、B-POLICY-SEA+K 與 Q2 門檻驗收測試
 * （SF+CK 計畫 §6.1、§6.2、§5 SFCK-3）。
 *
 * - profile 與人數：
 *   - 'sf-ck-new-shores-2025'：3、4 人（fixed）
 *   - 'sf-ck-new-shores-paired-2025'：5、6 人（variable）
 * - 座位：mixedLevels（standard 與 easy 交錯），仿 BotDriver 模式；kit 明列 `[seafarersKit, citiesKnightsKit, sfckKit]`
 * - 種子：seedsFor(profile)，預設 1–3，BOTS_SEEDS=10 時為 1–10
 * - 步數上限 6000，看門狗 N=72 次擲骰（`PROFILE_LIMITS`）；`longestStagnation` 超過 50 次時另外印出警示（D4）
 * - Q1 斷言：有勝者；0 拒絕；沒有殘留 pending；守恆（SF、C&K 與組合 kit）；0 次「策略閒置、但保底有動作」；每視窗每座位 ≤ 40；
 *   非行動者只送 responseCommands；paired 的 Player 2 不報價、不打 Alchemy；每次 `pending.moveRobber` 的目標都在
 *   `banditTargets` 的 fold 集合內（直接呼叫各模組的 `robberTargets` 也不 throw）；standard 的強盜不放自己的格，
 *   除非 fold 集合裡的陸地目標全部都是自己的格。
 * - 保底席（座位 2 只走保底，種子 1）與全保底有界局（1500 步，種子 1，不要求終局）。
 * - B-POLICY 決定性：4 人種子 3、6 人種子 4，各重播兩次，指令序列逐一相同。
 * - B-POLICY-SEA+K：B-GAME 每 5 步取樣一次，`sea.ts` 的船位與含船的路線長度（含騎士 blocker）等於 hints 與
 *   `longestRouteLength`；要用帶模組的 `shipEdgesFrom(view, id, options, modules)`（F9）。
 * - Q2：S1–S4、C1–C5 依 §6.2 的表；預設 3 種子與 `BOTS_SEEDS=10` 各有門檻，其他種子數只檢查每局門檻。
 *   X1–X3（追擊海盜、金礦城市、`either` 時移海盜）是固定盤面守門，屬 SFCK-2 的 `sfck-strategy.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  CITIES_KNIGHTS,
  getTopology,
  longestRouteLength,
  moduleStateOf,
  projectGame,
  requireProfile,
  type GameState,
  type GameView,
  type ProfileDefinition,
} from '@catan/rules';
import { forceTurn } from '../../rules/test/helpers.ts';
import { banditTargets, defaultBanditTargets } from '../src/base/robber.ts';
import { boardModel, routeLength } from '../src/board.ts';
import { fallbackPolicy } from '../src/fallback.ts';
import { botCommandLimit } from '../src/index.ts';
import type { BanditTarget, BotModule } from '../src/modules/types.ts';
import { moduleHints } from '../src/modules/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import { roadEdgesFrom, shipEdgesFrom, shipsLeft } from '../src/sea.ts';
import { botModulesOf } from '../src/support.ts';
import { MAX_OFFERS_PER_WINDOW } from '../src/trade.ts';
import type { BotCommand } from '../src/types.ts';
import {
  allowedResponseCommands,
  BOT_WINDOW_COMMAND_LIMIT,
  botSeats,
  cloneState,
  GAME_TIMEOUT,
  mixedLevels,
  responseCommandDrift,
  runBotGame,
  seedsFor,
  viewFor,
  withFallbackSeat,
  type BotSeat,
  type Decision,
  type StepInfo,
} from './harness.ts';
import { citiesKnightsKit, maxImprovementLevel, metropolisCount } from './modules/citiesKnights.ts';
import { seafarersKit } from './modules/seafarers.ts';
import { sfckKit } from './modules/seafarersCitiesKnights.ts';

declare const console: { table(data: unknown): void; log(...args: unknown[]): void };

/** 部件 kit 在前、組合 kit 最後：`perturb` 依序套用，組合層最後修補首攻前的狀態。 */
const KITS = [seafarersKit, citiesKnightsKit, sfckKit];

interface SfckEntry {
  readonly profileId: 'sf-ck-new-shores-2025' | 'sf-ck-new-shores-paired-2025';
  readonly players: number;
}

const SFCK_ENTRIES: readonly SfckEntry[] = [
  { profileId: 'sf-ck-new-shores-2025', players: 3 },
  { profileId: 'sf-ck-new-shores-2025', players: 4 },
  { profileId: 'sf-ck-new-shores-paired-2025', players: 5 },
  { profileId: 'sf-ck-new-shores-paired-2025', players: 6 },
];

/** 看門狗 N = 72；停滯超過這個次數（D4）就提報，不影響通過與否。 */
const STAGNATION_WARNING = 50;

/** 只由行動者在行動階段送出的指令；非行動者送它們就是越權。 */
const ACTOR_ONLY = new Set([
  'build.wall',
  'build.ship',
  'ship.move',
  'city.improve',
  'knight.recruit',
  'knight.activate',
  'knight.promote',
  'knight.move',
  'knight.displace',
  'knight.chaseRobber',
  'knight.chasePirate',
  'progress.play',
  'progress.harborOffer',
]);

function hexesAround(state: GameState, vertex: number): readonly number[] {
  return getTopology(state.board.layout.topologyId).vertices[vertex]!.hexes;
}

function ownsOnlyBuildingsOn(state: GameState, playerId: string, hex: number): boolean {
  const owners = new Set<string>();
  state.board.buildings.forEach((building, vertex) => {
    if (building && hexesAround(state, vertex).includes(hex)) owners.add(building.player);
  });
  return owners.size > 0 && [...owners].every((owner) => owner === playerId);
}

const isLand = (state: GameState, hex: BanditTarget): hex is number =>
  hex !== null && state.board.layout.terrain[hex] !== 'sea';

/**
 * 契約與盜賊的逐決策檢查。`strategySeats` 是走策略的座位（保底席與全保底不套用「強盜不放自己的格」：保底取 fold 的第一項）。
 */
function decisionChecks(profile: ProfileDefinition, seats: readonly BotSeat[]) {
  const modules = botModulesOf(profile);
  const violations: string[] = responseCommandDrift(profile, KITS).map((drift) => `response command drift: ${drift}`);
  const banditProblems: string[] = [];
  const responseCommands = allowedResponseCommands(profile, KITS);
  const standardPolicySeats = new Set(
    seats.filter((seat) => seat.level === 'standard' && seat.policy !== fallbackPolicy).map((seat) => seat.id),
  );
  let moveRobbers = 0;

  const check = (state: GameState, decision: Decision): void => {
    const { actor, command } = decision;
    const turnActor = state.players[state.turn.seat]!.id;
    const where = `seq ${state.seq} ${actor} ${command.type}`;

    if (actor !== turnActor && !responseCommands.has(command.type)) violations.push(`non-actor: ${where}`);
    if (actor !== turnActor && ACTOR_ONLY.has(command.type)) violations.push(`non-actor action: ${where}`);
    if (actor !== turnActor && command.type === 'build.road' && state.pending?.kind !== 'freeRoads') {
      violations.push(`non-actor road: ${where}`);
    }

    const secondActor = requireProfile(state.profileId).paired && state.turn.pairedActor === 2;
    if (secondActor && actor === turnActor && (command.type === 'trade.offer' || command.type === 'trade.settle')) {
      violations.push(`paired second trades: ${where}`);
    }
    if (secondActor && actor === turnActor && command.type === 'progress.play' && command.card === 'alchemy') {
      violations.push(`paired second plays alchemy: ${where}`);
    }

    if (command.type === 'trade.offer') {
      const mine = state.offers.filter((offer) => offer.from === actor && offer.windowId === state.windowId);
      if (mine.length >= MAX_OFFERS_PER_WINDOW) violations.push(`offer limit: ${where}`);
      const same = mine.some(
        (offer) =>
          JSON.stringify(offer.give) === JSON.stringify(command.give) &&
          JSON.stringify(offer.want) === JSON.stringify(command.want),
      );
      if (same) violations.push(`repeated offer: ${where}`);
    }

    if (command.type !== 'pending.moveRobber') return;
    moveRobbers += 1;
    const hex = command.hex as BanditTarget;
    const view = viewFor(state, actor);
    // 目標必須在 fold 的集合內；直接呼叫各模組的 `robberTargets` 也不得 throw（`banditTargets` 會吞掉例外）。
    const targets = banditTargets(view, actor, modules);
    if (!targets.includes(hex)) banditProblems.push(`${where}: target ${String(hex)} is outside the fold set`);
    for (const module of modules) {
      try {
        module.robberTargets?.(view, actor, defaultBanditTargets(view));
      } catch (error) {
        banditProblems.push(`${where}: ${module.id}.robberTargets threw ${String(error)}`);
      }
    }
    // standard 的強盜不放自己的格，除非 fold 集合裡所有的陸地目標都是自己的格。
    if (standardPolicySeats.has(actor) && isLand(state, hex) && ownsOnlyBuildingsOn(state, actor, hex)) {
      const alternatives = targets.filter((target) => isLand(state, target) && !ownsOnlyBuildingsOn(state, actor, target));
      if (alternatives.length > 0) banditProblems.push(`${where}: robber on own hex ${hex} with ${alternatives.length} alternatives`);
    }
  };

  return { violations, banditProblems, check, moveRobbers: () => moveRobbers };
}

function asActor(state: GameState, seat: number): GameState {
  const copy = cloneState(state);
  copy.result = null;
  forceTurn(copy, seat, 'action');
  copy.windowId += 1;
  return copy;
}

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

/**
 * B-POLICY-SEA+K 的一次取樣：`sea.ts` 的船位、道路位置、移船目標與含船的路線長度，必須等於 hints 與 rules。
 * `blockerMatters` 回報「帶模組與不帶模組結果不同」的次數，證明騎士 blocker 確實被比對到。
 */
function compareSea(
  step: StepInfo,
  sample: number,
  modules: readonly BotModule[],
  problems: string[],
): { compared: number; blockerMatters: number } {
  const seat = step.after.turn.seat;
  const player = step.after.players[seat];
  if (!player) return { compared: 0, blockerMatters: 0 };
  const where = `sample ${sample} seq ${step.after.seq} ${player.id}`;
  const forced = asActor(step.after, seat);
  const view = viewOf(forced, player.id);
  const hints = moduleHints(view.hints, 'seafarers');
  if (!hints) {
    problems.push(`${where}: missing seafarers hints`);
    return { compared: 0, blockerMatters: 0 };
  }
  const sorted = (edges: readonly number[]): string => JSON.stringify(edges.slice().sort((a, b) => a - b));
  let blockerMatters = 0;
  const model = boardModel(view, player.id, modules);

  const ships = shipEdgesFrom(view, player.id, {}, modules);
  const expectedShips = shipsLeft(model) > 0 ? hints.legalShips : [];
  if (sorted(ships) !== sorted(expectedShips)) problems.push(`${where}: ship edges mismatch`);
  if (sorted(ships) !== sorted(shipEdgesFrom(view, player.id))) blockerMatters += 1;

  const roads = roadEdgesFrom(view, player.id, {}, modules);
  if (sorted(roads) !== sorted(view.hints!.legalRoads)) problems.push(`${where}: road edges mismatch`);

  for (const movable of hints.movableShips) {
    const targets = shipEdgesFrom(view, player.id, { moving: movable.edge }, modules);
    if (sorted(targets) !== sorted(movable.targets)) problems.push(`${where}: movable ship ${movable.edge} targets mismatch`);
  }

  const length = routeLength(model, player.id);
  const expectedLength = longestRouteLength(forced, player.id, true);
  if (length !== expectedLength) problems.push(`${where}: route length ${length} != ${expectedLength}`);
  if (length !== routeLength(boardModel(view, player.id), player.id)) blockerMatters += 1;
  return { compared: 1, blockerMatters };
}

interface GameStats {
  profileId: string;
  players: number;
  seed: number;
  steps: number;
  winner: string | null;
  failure: unknown;
  stuck: unknown;
  watchdog: unknown;
  idleFallbacks: number;
  paidShips: number;
  islandBonuses: number;
  standardPaidShips: number;
  easyPaidShips: number;
  policyGoldChoices: number;
  recruits: number;
  activates: number;
  plays: number;
  maxImprovement: number;
  defended: number;
  overrun: number;
  metropolises: number;
  chases: number;
  eitherRobber: number;
  eitherPirate: number;
  selfPinned: number;
  movableWindows: number;
  knightOnSpot: number;
  strategyFrames: number;
  dutyFrames: number;
  seaComparisons: number;
  blockerMatters: number;
  moveRobbers: number;
  maxWindowCommands: number;
  longestStagnation: number;
}

/** 計數器的鍵取值，沒有就是 0。 */
const tally = (mechanics: Readonly<Record<string, number>>, key: string): number => mechanics[key] ?? 0;

interface PlayOptions {
  /** 這個座位（0 起算）只走保底。 */
  readonly fallbackSeat?: number;
  /** 不做 B-POLICY-SEA+K 取樣（決定性重播用不到）。 */
  readonly sea?: boolean;
}

/** 玩一局並做完 Q1 的每局斷言；回傳 Q2 要用的統計。 */
function playChecked(entry: SfckEntry, seed: number, options: PlayOptions = {}): GameStats {
  const { profileId, players } = entry;
  const profile = requireProfile(profileId);
  const limit = botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT);
  const modules = botModulesOf(profile);
  const levels = mixedLevels(players, seed);

  // 包裝 SF 與 C&K 的 answerFrame：記下策略自己作答的 frame 指令（Q2 只計策略的答案，保底的不算）。
  let lastAnswered: BotCommand | null = null;
  let seats: BotSeat[] = botSeats(levels, (level) => {
    const wrapped = modules.map((module) => {
      if ((module.id !== 'seafarers' && module.id !== CITIES_KNIGHTS) || !module.answerFrame) return module;
      return {
        ...module,
        answerFrame: (...args: Parameters<NonNullable<BotModule['answerFrame']>>) => {
          const answer = module.answerFrame!(...args);
          if (answer !== undefined && answer !== null) lastAnswered = answer;
          return answer;
        },
      };
    });
    return createBotPolicy(level, { modules: wrapped });
  });
  if (options.fallbackSeat !== undefined) seats = withFallbackSeat(seats, options.fallbackSeat);

  const checks = decisionChecks(profile, seats);
  const commandCounts: Record<string, number> = {};
  const seaProblems: string[] = [];
  let seaComparisons = 0;
  let blockerMatters = 0;
  let policyGoldChoices = 0;
  let nonFreeShipCommands = 0;
  let expectedGoldCards = 0;
  let strategyFrames = 0;
  let dutyFrames = 0;
  let stepCount = 0;

  const run = runBotGame({
    seats,
    seed,
    profileId,
    kits: KITS,
    onDecision: (state, decision) => {
      checks.check(state, decision);
      const { command, source } = decision;
      commandCounts[command.type] = (commandCounts[command.type] ?? 0) + 1;
      if (command.type === 'build.ship' && state.pending?.kind !== 'freeRoads') nonFreeShipCommands += 1;
      if (command.type === 'gold.choose') {
        const resources = (command as { resources?: unknown[] }).resources;
        if (Array.isArray(resources)) expectedGoldCards += resources.length;
        if (source !== 'fallback' && lastAnswered && JSON.stringify(lastAnswered) === JSON.stringify(command)) {
          policyGoldChoices += 1;
        }
      }
      const frame = state.pending as { kind?: string } | null;
      if (frame?.kind?.startsWith('citiesKnights.') && source === 'policy' && options.fallbackSeat === undefined) {
        if (lastAnswered && JSON.stringify(lastAnswered) === JSON.stringify(command)) strategyFrames += 1;
        else dutyFrames += 1;
      }
      lastAnswered = null;
    },
    onStep: (step) => {
      if (options.sea === false || stepCount++ % 5 !== 0) return;
      const result = compareSea(step, stepCount, modules, seaProblems);
      seaComparisons += result.compared;
      blockerMatters += result.blockerMatters;
    },
  });

  const label = `${profileId} ${players}p seed ${seed}${options.fallbackSeat === undefined ? '' : ` (seat ${options.fallbackSeat + 1} fallback)`}`;
  const m = run.mechanics;
  const slot = moduleStateOf<{ attacks: number }>(run.state, CITIES_KNIGHTS);
  const ck = (key: string) => tally(m, `citiesKnights.${key}`);
  const sf = (key: string) => tally(m, `seafarers.${key}`);
  const combined = (key: string) => tally(m, `seafarersCitiesKnights.${key}`);

  // Q1 矩陣斷言
  expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
  expect(run.stuck, `${label}: both policy and fallback idle at seq ${run.state.seq}`).toBeNull();
  expect(run.watchdog, `${label}: watchdog tripped after ${run.watchdog?.rolls} rolls without improvement`).toBeNull();
  expect(run.idleFallbacks, `${label}: policy idled while fallback acted`).toEqual([]);
  expect(run.state.result?.reason, `${label}: no victory after ${run.steps} steps`).toBe('victory');
  expect(run.state.pending, `${label}: unresolved pending`).toBeNull();
  expect(run.conservation, `${label}: conservation failed`).toEqual([]);
  expect(run.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(limit);
  expect(checks.violations, `${label}: contract violations`).toEqual([]);
  expect(checks.banditProblems, `${label}: bandit targets`).toEqual([]);
  expect(seaProblems, `${label}: sea model mismatch`).toEqual([]);
  if (options.sea !== false) expect(seaComparisons, `${label}: B-POLICY-SEA+K comparison count`).toBeGreaterThan(0);
  if (run.longestStagnation > STAGNATION_WARNING) {
    console.log(`WARNING ${label}: ${run.longestStagnation} rolls without a new high (watchdog ${72}, warning ${STAGNATION_WARNING})`);
  }

  // 交叉檢查：事件（`event.params`）與指令、終局狀態一致。
  expect(sf('paidShips'), `${label}: paidShips vs non-free ship commands`).toBe(nonFreeShipCommands);
  expect(sf('goldCards'), `${label}: goldCards vs gold.choose resources`).toBe(expectedGoldCards);
  expect(sf('islandSettlements'), `${label}: island settlements vs bonuses`).toBeGreaterThanOrEqual(sf('islandBonuses'));
  expect(ck('ev.ck.knightRecruited'), `${label}: recruit events vs commands`).toBe(commandCounts['knight.recruit'] ?? 0);
  expect(ck('ev.ck.knightActivated'), `${label}: activate events vs commands`).toBe(commandCounts['knight.activate'] ?? 0);
  expect(ck('ev.ck.progressPlayed'), `${label}: progress events vs commands`).toBe(commandCounts['progress.play'] ?? 0);
  expect(ck('maxImprovement'), `${label}: max improvement event vs final state`).toBe(maxImprovementLevel(run.state));
  expect(ck('attack.defenders') + ck('attack.barbarians'), `${label}: attack events vs state.attacks`).toBe(slot?.attacks ?? 0);
  // 追擊海盜：事件、指令、之後移動的海盜一一對應；easy 不追擊、`either` 時只移強盜。
  expect(combined('knightChasedPirate'), `${label}: chase events vs commands`).toBe(commandCounts['knight.chasePirate'] ?? 0);
  expect(combined('chased.pirate'), `${label}: pirate moves after a chase`).toBe(combined('knightChasedPirate'));
  expect(combined('easy.knightChasedPirate'), `${label}: easy seats chased the pirate`).toBe(0);
  expect(combined('either.easy.pirate'), `${label}: easy seats moved the pirate on a 7`).toBe(0);
  expect(combined('either.robber') + combined('either.pirate') + combined('chased.robber') + combined('chased.pirate'), `${label}: bandit moves vs moveRobber commands`).toBe(
    commandCounts['pending.moveRobber'] ?? 0,
  );

  return {
    profileId,
    players,
    seed,
    steps: run.steps,
    winner: run.state.result?.playerId ?? null,
    failure: run.failure,
    stuck: run.stuck,
    watchdog: run.watchdog,
    idleFallbacks: run.idleFallbacks.length,
    paidShips: sf('paidShips'),
    islandBonuses: sf('islandBonuses'),
    standardPaidShips: sf('standardPaidShips'),
    easyPaidShips: sf('easyPaidShips'),
    policyGoldChoices,
    recruits: ck('cmd.knight.recruit'),
    activates: ck('cmd.knight.activate'),
    plays: ck('cmd.progress.play'),
    maxImprovement: maxImprovementLevel(run.state),
    defended: ck('attack.defenders'),
    overrun: ck('attack.barbarians'),
    metropolises: metropolisCount(run.state),
    chases: combined('policy.knightChasedPirate'),
    eitherRobber: combined('either.robber'),
    eitherPirate: combined('either.pirate'),
    selfPinned: combined('window.selfPinned'),
    movableWindows: combined('window.movable'),
    knightOnSpot: combined('window.knightOnIslandSpot'),
    strategyFrames,
    dutyFrames,
    seaComparisons,
    blockerMatters,
    moveRobbers: checks.moveRobbers(),
    maxWindowCommands: run.maxWindowCommands,
    longestStagnation: run.longestStagnation,
  };
}

describe('Seafarers + Cities & Knights B-GAME', () => {
  const allGameStats: GameStats[] = [];

  for (const entry of SFCK_ENTRIES) {
    const { profileId, players } = entry;
    const seeds = seedsFor(requireProfile(profileId));
    it(
      `finishes with a winner and satisfies Q1 invariants (${profileId}, ${players} players, ${seeds.length} seeds)`,
      () => {
        for (const seed of seeds) allGameStats.push(playChecked(entry, seed));
      },
      GAME_TIMEOUT,
    );
  }

  const seedCount = seedsFor(requireProfile('sf-ck-new-shores-2025')).length;

  it('checks Q2 thresholds across all played games', () => {
    expect(allGameStats.length, 'allGameStats count must equal expected total games across matrix').toBe(
      SFCK_ENTRIES.length * seedCount,
    );

    console.table(
      allGameStats.map((s) => ({
        game: `${s.profileId} ${s.players}p s${s.seed}`,
        steps: s.steps,
        paid: s.paidShips,
        stdPaid: s.standardPaidShips,
        easyPaid: s.easyPaidShips,
        bonus: s.islandBonuses,
        gold: s.policyGoldChoices,
        recruit: s.recruits,
        activate: s.activates,
        maxLevel: s.maxImprovement,
        plays: s.plays,
        defended: s.defended,
        overrun: s.overrun,
        metropolis: s.metropolises,
        chase: s.chases,
        either: `${s.eitherRobber}/${s.eitherPirate}`,
        pinned: `${s.selfPinned}/${s.movableWindows}`,
        onSpot: s.knightOnSpot,
        frames: `${s.strategyFrames}/${s.dutyFrames}`,
        sea: `${s.seaComparisons}/${s.blockerMatters}`,
        maxWindow: s.maxWindowCommands,
        stagnant: s.longestStagnation,
      })),
    );

    // 每局門檻（預設與發布都檢查）：C1、C3，C&K 的 frame 由策略自己作答。
    for (const s of allGameStats) {
      const game = `${s.profileId} ${s.players}p seed ${s.seed}`;
      expect.soft(s.recruits, `C1 ${game}: knight.recruit`).toBeGreaterThanOrEqual(1);
      expect.soft(s.activates, `C1 ${game}: knight.activate`).toBeGreaterThanOrEqual(1);
      expect.soft(s.plays, `C3 ${game}: progress.play`).toBeGreaterThanOrEqual(3);
      expect.soft(s.dutyFrames, `${game}: C&K frames answered by the duty instead of the strategy`).toBe(0);
    }

    // 預設 3 種子與發布 10 種子各有門檻；其他種子數只檢查上面的每局門檻（發布門檻依 10 局等比放大）。
    const release = seedCount >= 10;
    const scaled = (atTen: number): number => Math.ceil((atTen * seedCount) / 10);
    const ratioChecked = seedCount === 3 || release;

    // 每個格子（profile × 人數）：S1、S2、C2、C4、C5。
    const S2_RELEASE: Record<number, number> = { 3: 6, 4: 5, 5: 8, 6: 8 };
    const C2_RELEASE: Record<number, number> = { 3: 7, 4: 9, 5: 9, 6: 9 };
    for (const { profileId, players } of SFCK_ENTRIES) {
      const stats = allGameStats.filter((s) => s.profileId === profileId && s.players === players);
      const label = `${profileId} ${players}p (${seedCount} seeds)`;
      expect(stats.length, `${label}: played games must equal seed count`).toBe(seedCount);
      const s1 = stats.filter((s) => s.paidShips > 0).length;
      const s2 = stats.filter((s) => s.islandBonuses > 0).length;
      const c2 = stats.filter((s) => s.maxImprovement >= 3).length;
      const defended = stats.reduce((sum, s) => sum + s.defended, 0);
      const metropolises = stats.reduce((sum, s) => sum + s.metropolises, 0);
      console.log(
        `Q2 ${label}: S1 ${s1}/${seedCount}, S2 ${s2}/${seedCount}, C1 min recruit ${Math.min(...stats.map((s) => s.recruits))} activate ${Math.min(...stats.map((s) => s.activates))}, C2 ${c2}/${seedCount}, C3 min plays ${Math.min(...stats.map((s) => s.plays))}, C4 defended ${defended}, C5 metropolises ${metropolises}, max steps ${Math.max(...stats.map((s) => s.steps))}, longest stagnation ${Math.max(...stats.map((s) => s.longestStagnation))}, max window ${Math.max(...stats.map((s) => s.maxWindowCommands))}`,
      );
      if (!ratioChecked) continue;
      if (release) {
        expect.soft(s1, `S1 ${label}: games with a paid ship ${s1}/${seedCount}`).toBeGreaterThanOrEqual(scaled(9));
        expect.soft(s2, `S2 ${label}: games with an island bonus ${s2}/${seedCount}`).toBeGreaterThanOrEqual(scaled(S2_RELEASE[players]!));
        expect.soft(c2, `C2 ${label}: games with a level-3 improvement ${c2}/${seedCount}`).toBeGreaterThanOrEqual(scaled(C2_RELEASE[players]!));
        expect.soft(defended, `C4 ${label}: defenders won ${defended}`).toBeGreaterThanOrEqual(2);
        expect.soft(metropolises, `C5 ${label}: metropolises at the end ${metropolises}`).toBeGreaterThanOrEqual(scaled(5));
      } else {
        expect.soft(s1, `S1 ${label}: games with a paid ship ${s1}/3`).toBe(3);
        expect.soft(s2, `S2 ${label}: games with an island bonus ${s2}/3`).toBeGreaterThanOrEqual(players <= 4 ? 1 : 2);
        expect.soft(c2, `C2 ${label}: games with a level-3 improvement ${c2}/3`).toBeGreaterThanOrEqual(players <= 4 ? 2 : 3);
      }
    }

    // 每個 profile 合計（3–4 人與 5–6 人各 2 × seedCount 局）：S3、S4。
    for (const profileId of ['sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025'] as const) {
      const stats = allGameStats.filter((s) => s.profileId === profileId);
      expect(stats.length, `stats for ${profileId} must equal ${2 * seedCount} games`).toBe(2 * seedCount);
      const standard = stats.filter((s) => s.standardPaidShips > 0).length;
      const easy = stats.filter((s) => s.easyPaidShips > 0).length;
      const gold = stats.filter((s) => s.policyGoldChoices > 0).length;
      const chased = stats.reduce((sum, s) => sum + s.chases, 0);
      const eitherRobber = stats.reduce((sum, s) => sum + s.eitherRobber, 0);
      const eitherPirate = stats.reduce((sum, s) => sum + s.eitherPirate, 0);
      const pinned = stats.reduce((sum, s) => sum + s.selfPinned, 0);
      const movable = stats.reduce((sum, s) => sum + s.movableWindows, 0);
      console.log(
        `Q2 ${profileId} (${stats.length} games): S3 standard ${standard}, easy ${easy}; S4 gold games ${gold}; Q3 chase ${chased}, either robber/pirate ${eitherRobber}/${eitherPirate}, self-pinned windows ${pinned}/${movable}, knight on island spot ${stats.reduce((sum, s) => sum + s.knightOnSpot, 0)}`,
      );
      if (!release) continue;
      // 門檻是「每個 profile 合計 20 局」：種子數放大時等比放大（20 局 × seedCount / 10）。
      expect.soft(standard, `S3 ${profileId}: games where a standard seat paid for a ship ${standard}/${stats.length}`).toBeGreaterThanOrEqual(scaled(12));
      expect.soft(easy, `S3 ${profileId}: games where an easy seat paid for a ship ${easy}/${stats.length}`).toBeGreaterThanOrEqual(scaled(12));
      if (profileId === 'sf-ck-new-shores-paired-2025') {
        expect.soft(gold, `S4 ${profileId}: games with a policy gold.choose ${gold}/${stats.length}`).toBeGreaterThanOrEqual(scaled(6));
      }
    }
  });

  it('exercises the knight blocker of the sea model and the bandit fold in real games', () => {
    expect(allGameStats.length).toBe(SFCK_ENTRIES.length * seedCount);
    const comparisons = allGameStats.reduce((sum, s) => sum + s.seaComparisons, 0);
    const blockerMatters = allGameStats.reduce((sum, s) => sum + s.blockerMatters, 0);
    const moveRobbers = allGameStats.reduce((sum, s) => sum + s.moveRobbers, 0);
    console.log(`B-POLICY-SEA+K: ${comparisons} comparisons, ${blockerMatters} where the knight blocker changed the answer; moveRobber decisions checked ${moveRobbers}`);
    expect(comparisons).toBeGreaterThan(100);
    expect(moveRobbers, 'moveRobber decisions checked against the fold').toBeGreaterThan(0);
  });
});

describe('fallback seat', () => {
  // 座位 2 只走保底，其餘座位照常：保底必須在真實對局裡一路合法，局面仍然終局。
  for (const entry of SFCK_ENTRIES) {
    it(
      `a fallback-only seat keeps the game legal and finished (${entry.profileId}, ${entry.players} players)`,
      () => {
        playChecked(entry, 1, { fallbackSeat: 1, sea: false });
      },
      GAME_TIMEOUT,
    );
  }
});

describe('all-fallback bounded games', () => {
  // 全部座位只走保底：不要求終局（保底不改良、不得分，看門狗必須關閉），只要求 0 拒絕、每一步都有動作。
  for (const { profileId, players } of SFCK_ENTRIES) {
    it(
      `only issues accepted commands and acts at every step (${profileId}, ${players} players, 1500 steps)`,
      () => {
        const seats: BotSeat[] = Array.from({ length: players }, (_, index) => ({
          id: `bot${index + 1}`,
          level: 'standard' as const,
          policy: fallbackPolicy,
        }));
        const kinds = new Set<string>();
        const run = runBotGame({
          seats,
          seed: 1,
          profileId,
          maxSteps: 1500,
          watchdogRolls: null,
          kits: KITS,
          onDecision: (_state, decision) => kinds.add(decision.command.type),
        });
        const label = `${profileId} ${players}p`;
        expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
        expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
        expect(run.steps, `${label}: every step has an action`).toBe(1500);
        expect(run.state.turn.phase, label).not.toBe('setup');
        expect(run.conservation, `${label}: conservation failed`).toEqual([]);
        expect([...kinds], label).toEqual(expect.arrayContaining(['setup.placeBuilding', 'setup.placeRoad', 'turn.roll', 'turn.end']));
        // 保底永遠不送移船與騎士指令（F8、F11：那些指令會被拒）。
        expect([...kinds].filter((type) => type === 'ship.move' || type.startsWith('knight.')), label).toEqual([]);
      },
      GAME_TIMEOUT,
    );
  }
});

describe('B-POLICY determinism', () => {
  const replay = (players: number, seed: number, profileId: SfckEntry['profileId']): string[] => {
    const commands: string[] = [];
    runBotGame({
      seats: botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level)),
      seed,
      profileId,
      kits: KITS,
      onDecision: (_, decision) => commands.push(`${decision.actor}:${JSON.stringify(decision.command)}`),
    });
    return commands;
  };

  it(
    'replays identically for 4 players (seed 3, sf-ck-new-shores-2025)',
    () => {
      const first = replay(4, 3, 'sf-ck-new-shores-2025');
      expect(first.length).toBeGreaterThan(0);
      expect(first).toEqual(replay(4, 3, 'sf-ck-new-shores-2025'));
    },
    GAME_TIMEOUT,
  );

  it(
    'replays identically for 6 players (seed 4, sf-ck-new-shores-paired-2025)',
    () => {
      const first = replay(6, 4, 'sf-ck-new-shores-paired-2025');
      expect(first.length).toBeGreaterThan(0);
      expect(first).toEqual(replay(6, 4, 'sf-ck-new-shores-paired-2025'));
    },
    GAME_TIMEOUT,
  );
});
