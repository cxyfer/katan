/**
 * Cities & Knights B-GAME、B-POLICY 決定性與 Q2 門檻驗收測試（C&K 計畫 §6.1、§6.2）。
 *
 * - profile 與人數：
 *   - 'ck-2025'：3、4 人
 *   - 'ck-paired-2025'：5、6 人
 * - 座位：mixedLevels（standard 與 easy 交錯），仿 BotDriver 模式
 * - 種子：seedsFor(profile)，預設 1–3，BOTS_SEEDS=10 時為 1–10
 * - 步數上限 6000，看門狗 N=72（`PROFILE_LIMITS`）
 * - Q1 斷言：有勝者；0 拒絕；沒有殘留 pending；守恆；0 次「策略閒置、但保底有動作」；每視窗每座位 ≤ 40；
 *   非行動者只送 responseCommands；paired 的 Player 2 不報價、不打 Alchemy。
 * - Q2：M1–M3 每局檢查；M4–M7 只在種子數 ≥ 10 時每格檢查（M8 屬 CK-C）。
 *   計數一律讀 `event.params.*`（kit 的 `mechanics`），每局另做交叉檢查：事件數等於指令數、蠻族攻擊次數等於
 *   終局狀態的 `attacks`、最高改良等於終局狀態。Q2 只計策略自己的指令；frame 的答案另用 `answerFrame` 包裝，
 *   確認 C&K 的 frame 都是策略自己作答、不是退回保底義務。
 */

import { describe, expect, it } from 'vitest';
import {
  CITIES_KNIGHTS,
  moduleStateOf,
  requireProfile,
  type GameState,
  type ProfileDefinition,
} from '@catan/rules';
import { botCommandLimit } from '../src/index.ts';
import type { BotModule } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botModulesOf } from '../src/support.ts';
import { MAX_OFFERS_PER_WINDOW } from '../src/trade.ts';
import type { BotCommand } from '../src/types.ts';
import {
  allowedResponseCommands,
  BOT_WINDOW_COMMAND_LIMIT,
  botSeats,
  GAME_TIMEOUT,
  mixedLevels,
  responseCommandDrift,
  runBotGame,
  seedsFor,
  type BotSeat,
  type Decision,
} from './harness.ts';
import { citiesKnightsKit, maxImprovementLevel, metropolisCount } from './modules/citiesKnights.ts';

declare const console: { table(data: unknown): void; log(...args: unknown[]): void };

const KITS = [citiesKnightsKit];

interface CkEntry {
  readonly profileId: 'ck-2025' | 'ck-paired-2025';
  readonly players: number;
}

const CK_ENTRIES: readonly CkEntry[] = [
  { profileId: 'ck-2025', players: 3 },
  { profileId: 'ck-2025', players: 4 },
  { profileId: 'ck-paired-2025', players: 5 },
  { profileId: 'ck-paired-2025', players: 6 },
];

/** 計畫 §4.1 的 F1 十二種（M7 的分母）。 */
const F1_CARDS = [
  'irrigation',
  'mining',
  'merchant',
  'merchantFleet',
  'resourceMonopoly',
  'tradeMonopoly',
  'medicine',
  'crane',
  'engineering',
  'smithing',
  'encouragement',
  'roadBuilding',
] as const;

/** 只由行動者在行動階段送出的 C&K 指令；非行動者送它們就是越權。 */
const ACTOR_ONLY = new Set([
  'build.wall',
  'city.improve',
  'knight.recruit',
  'knight.activate',
  'knight.promote',
  'knight.move',
  'knight.displace',
  'knight.chaseRobber',
  'progress.play',
  'progress.harborOffer',
]);

function contractChecks(profile: ProfileDefinition) {
  const violations: string[] = responseCommandDrift(profile, KITS).map((drift) => `response command drift: ${drift}`);
  const responseCommands = allowedResponseCommands(profile, KITS);

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
  };

  return { violations, check };
}

function slotOf(state: GameState): { attacks: number; knights: number } {
  const slot = moduleStateOf<{ attacks: number; knights: unknown[] }>(state, CITIES_KNIGHTS);
  return { attacks: slot?.attacks ?? 0, knights: slot?.knights.length ?? 0 };
}

interface GameStats {
  profileId: string;
  players: number;
  seed: number;
  steps: number;
  winner: string | null;
  reason: string | null;
  failure: unknown;
  stuck: unknown;
  watchdog: unknown;
  idleFallbacks: number;
  recruits: number;
  activates: number;
  promotes: number;
  moves: number;
  chases: number;
  walls: number;
  improves: number;
  maxImprovement: number;
  plays: number;
  cards: Record<string, number>;
  defended: number;
  overrun: number;
  standardExposed: number;
  standardLost: number;
  easyExposed: number;
  easyLost: number;
  metropolises: number;
  strategyFrames: number;
  dutyFrames: number;
  maxWindowCommands: number;
  longestStagnation: number;
}

/** 計數器的鍵取值，沒有就是 0。 */
const tally = (mechanics: Readonly<Record<string, number>>, key: string): number => mechanics[`citiesKnights.${key}`] ?? 0;

describe('Cities & Knights B-GAME', () => {
  const allGameStats: GameStats[] = [];

  for (const entry of CK_ENTRIES) {
    const { profileId, players } = entry;
    const profile = requireProfile(profileId);
    const seeds = seedsFor(profile);

    it(
      `finishes with a winner and satisfies Q1 invariants (${profileId}, ${players} players, ${seeds.length} seeds)`,
      () => {
        const limit = botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT);

        for (const seed of seeds) {
          const levels = mixedLevels(players, seed);
          // 包裝 C&K 的 answerFrame：記下策略自己作答的 frame 指令（Q2 只計策略的答案）。
          let lastAnswered: BotCommand | null = null;
          const seats: BotSeat[] = botSeats(levels, (level) => {
            const modules = botModulesOf(profile).map((module) => {
              if (module.id !== CITIES_KNIGHTS || !module.answerFrame) return module;
              return {
                ...module,
                answerFrame: (...args: Parameters<NonNullable<BotModule['answerFrame']>>) => {
                  const answer = module.answerFrame!(...args);
                  if (answer !== undefined && answer !== null) lastAnswered = answer;
                  return answer;
                },
              };
            });
            return createBotPolicy(level, { modules });
          });
          const contract = contractChecks(profile);
          const commandCounts: Record<string, number> = {};
          let strategyFrames = 0;
          let dutyFrames = 0;

          const run = runBotGame({
            seats,
            seed,
            profileId,
            kits: KITS,
            onDecision: (state, decision) => {
              contract.check(state, decision);
              commandCounts[decision.command.type] = (commandCounts[decision.command.type] ?? 0) + 1;
              const frame = state.pending as { kind?: string } | null;
              if (frame?.kind?.startsWith('citiesKnights.') && decision.source === 'policy') {
                if (lastAnswered && JSON.stringify(lastAnswered) === JSON.stringify(decision.command)) strategyFrames += 1;
                else dutyFrames += 1;
              }
              lastAnswered = null;
            },
          });

          const label = `${profileId} ${players}p seed ${seed}`;
          const m = run.mechanics;
          const slot = slotOf(run.state);

          let standardExposed = 0;
          let standardLost = 0;
          let easyExposed = 0;
          let easyLost = 0;
          levels.forEach((level, index) => {
            const id = `bot${index + 1}`;
            if (level === 'standard') {
              standardExposed += tally(m, `exposed.${id}`);
              standardLost += tally(m, `lost.${id}`);
            } else {
              easyExposed += tally(m, `exposed.${id}`);
              easyLost += tally(m, `lost.${id}`);
            }
          });

          const cards: Record<string, number> = {};
          for (const card of F1_CARDS) {
            const count = tally(m, `card.${card}`);
            if (count > 0) cards[card] = count;
          }

          allGameStats.push({
            profileId,
            players,
            seed,
            steps: run.steps,
            winner: run.state.result?.playerId ?? null,
            reason: run.state.result?.reason ?? null,
            failure: run.failure,
            stuck: run.stuck,
            watchdog: run.watchdog,
            idleFallbacks: run.idleFallbacks.length,
            recruits: tally(m, 'cmd.knight.recruit'),
            activates: tally(m, 'cmd.knight.activate'),
            promotes: tally(m, 'cmd.knight.promote'),
            moves: tally(m, 'cmd.knight.move') + tally(m, 'cmd.knight.displace'),
            chases: tally(m, 'cmd.knight.chaseRobber'),
            walls: tally(m, 'cmd.build.wall'),
            improves: tally(m, 'cmd.city.improve'),
            maxImprovement: maxImprovementLevel(run.state),
            plays: tally(m, 'cmd.progress.play'),
            cards,
            defended: tally(m, 'attack.defenders'),
            overrun: tally(m, 'attack.barbarians'),
            standardExposed,
            standardLost,
            easyExposed,
            easyLost,
            metropolises: metropolisCount(run.state),
            strategyFrames,
            dutyFrames,
            maxWindowCommands: run.maxWindowCommands,
            longestStagnation: run.longestStagnation,
          });

          // Q1 矩陣斷言
          expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
          expect(run.stuck, `${label}: both policy and fallback idle at seq ${run.state.seq}`).toBeNull();
          expect(run.watchdog, `${label}: watchdog tripped after ${run.watchdog?.rolls} rolls without improvement`).toBeNull();
          expect(run.idleFallbacks, `${label}: policy idled while fallback acted`).toEqual([]);
          expect(run.state.result?.reason, `${label}: no victory after ${run.steps} steps`).toBe('victory');
          expect(run.state.pending, `${label}: unresolved pending`).toBeNull();
          expect(run.conservation, `${label}: conservation failed`).toEqual([]);
          expect(run.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(limit);
          expect(contract.violations, `${label}: contract violations`).toEqual([]);

          // 交叉檢查：事件（`event.params`）與指令、終局狀態一致。
          expect(tally(m, 'ev.ck.knightRecruited'), `${label}: recruit events vs commands`).toBe(commandCounts['knight.recruit'] ?? 0);
          expect(tally(m, 'ev.ck.knightActivated'), `${label}: activate events vs commands`).toBe(commandCounts['knight.activate'] ?? 0);
          expect(tally(m, 'ev.ck.cityImproved'), `${label}: improve events vs commands`).toBeGreaterThanOrEqual(commandCounts['city.improve'] ?? 0);
          expect(tally(m, 'ev.ck.progressPlayed'), `${label}: progress events vs commands`).toBe(commandCounts['progress.play'] ?? 0);
          expect(tally(m, 'maxImprovement'), `${label}: max improvement event vs final state`).toBe(maxImprovementLevel(run.state));
          expect(
            tally(m, 'attack.defenders') + tally(m, 'attack.barbarians'),
            `${label}: attack events vs state.attacks`,
          ).toBe(slot.attacks);
          // 終局盤面上的騎士不會比招募（加上 treason 放下的）更多。
          expect(slot.knights, `${label}: knights on board vs recruited`).toBeLessThanOrEqual(
            tally(m, 'ev.ck.knightRecruited') + tally(m, 'ev.ck.treasonPlaced'),
          );
        }
      },
      GAME_TIMEOUT,
    );
  }

  const seedCount = seedsFor(requireProfile('ck-2025')).length;

  it.skipIf(seedCount !== 3 && seedCount !== 10)('checks Q2 thresholds across all played games', () => {
    expect(allGameStats.length, 'allGameStats count must equal expected total games across matrix').toBe(
      CK_ENTRIES.length * seedCount,
    );

    console.table(
      allGameStats.map((s) => ({
        game: `${s.profileId} ${s.players}p s${s.seed}`,
        steps: s.steps,
        winner: s.winner,
        recruit: s.recruits,
        activate: s.activates,
        promote: s.promotes,
        move: s.moves,
        chase: s.chases,
        wall: s.walls,
        improve: s.improves,
        maxLevel: s.maxImprovement,
        plays: s.plays,
        defended: s.defended,
        overrun: s.overrun,
        stdLost: `${s.standardLost}/${s.standardExposed}`,
        easyLost: `${s.easyLost}/${s.easyExposed}`,
        metropolis: s.metropolises,
        frames: `${s.strategyFrames}/${s.dutyFrames}`,
        maxWindow: s.maxWindowCommands,
        stagnant: s.longestStagnation,
      })),
    );

    for (const entry of CK_ENTRIES) {
      const { profileId, players } = entry;
      const stats = allGameStats.filter((s) => s.profileId === profileId && s.players === players);
      const label = `${profileId} ${players}p (${seedCount} seeds)`;
      expect(stats.length, `${label}: played games must equal seed count`).toBe(seedCount);

      // M1–M3：每局都檢查（預設與發布）。
      for (const s of stats) {
        const game = `${label} seed ${s.seed}`;
        expect.soft(s.recruits, `M1 ${game}: knight.recruit`).toBeGreaterThanOrEqual(1);
        expect.soft(s.activates, `M1 ${game}: knight.activate`).toBeGreaterThanOrEqual(1);
        expect.soft(s.maxImprovement, `M2 ${game}: highest improvement level`).toBeGreaterThanOrEqual(3);
        expect.soft(s.plays, `M3 ${game}: progress.play`).toBeGreaterThanOrEqual(3);
        // C&K 的 frame 由策略自己作答，不靠保底義務。
        expect.soft(s.dutyFrames, `${game}: C&K frames answered by the duty instead of the strategy`).toBe(0);
      }

      console.log(
        `Q2 ${label}: M1 min recruit ${Math.min(...stats.map((s) => s.recruits))} activate ${Math.min(...stats.map((s) => s.activates))}, M2 min level ${Math.min(...stats.map((s) => s.maxImprovement))}, M3 min plays ${Math.min(...stats.map((s) => s.plays))}`,
      );

      // M4–M7：每格 10 局合計，只在種子數 ≥ 10 時檢查。
      if (seedCount >= 10) {
        const defended = stats.reduce((sum, s) => sum + s.defended, 0);
        expect.soft(defended, `M4 ${label}: defenders won ${defended}`).toBeGreaterThanOrEqual(2);

        const standardExposed = stats.reduce((sum, s) => sum + s.standardExposed, 0);
        const standardLost = stats.reduce((sum, s) => sum + s.standardLost, 0);
        const easyExposed = stats.reduce((sum, s) => sum + s.easyExposed, 0);
        const easyLost = stats.reduce((sum, s) => sum + s.easyLost, 0);
        const standardRate = standardExposed === 0 ? 0 : standardLost / standardExposed;
        const easyRate = easyExposed === 0 ? 0 : easyLost / easyExposed;
        console.log(`M5 ${label}: standard ${standardLost}/${standardExposed} = ${standardRate.toFixed(3)}, easy ${easyLost}/${easyExposed} = ${easyRate.toFixed(3)}`);
        expect.soft(standardRate, `M5 ${label}: standard city-loss rate ${standardRate.toFixed(3)}`).toBeLessThanOrEqual(0.35);
        expect.soft(standardRate, `M5 ${label}: standard ${standardRate.toFixed(3)} must be below easy ${easyRate.toFixed(3)}`).toBeLessThan(easyRate);

        const metropolises = stats.reduce((sum, s) => sum + s.metropolises, 0);
        expect.soft(metropolises, `M6 ${label}: metropolises at the end ${metropolises}`).toBeGreaterThanOrEqual(5);

        const types = new Set(stats.flatMap((s) => Object.keys(s.cards)));
        console.log(`Q2 ${label}: M4 defended ${defended}, M6 metropolises ${metropolises}, M7 types ${types.size}/12, max steps ${Math.max(...stats.map((s) => s.steps))}, longest stagnation ${Math.max(...stats.map((s) => s.longestStagnation))}, max window ${Math.max(...stats.map((s) => s.maxWindowCommands))}`);
        expect.soft(types.size, `M7 ${label}: F1 card types played ${types.size}/12 (${[...types].sort().join(',')})`).toBeGreaterThanOrEqual(10);
      }
    }
  });
});

describe('B-POLICY determinism', () => {
  const replay = (players: number, seed: number, profileId: 'ck-2025' | 'ck-paired-2025'): string[] => {
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
    'replays identically for 4 players (seed 3, ck-2025)',
    () => {
      const first = replay(4, 3, 'ck-2025');
      expect(first.length).toBeGreaterThan(0);
      expect(first).toEqual(replay(4, 3, 'ck-2025'));
    },
    GAME_TIMEOUT,
  );

  it(
    'replays identically for 6 players (seed 4, ck-paired-2025)',
    () => {
      const first = replay(6, 4, 'ck-paired-2025');
      expect(first.length).toBeGreaterThan(0);
      expect(first).toEqual(replay(6, 4, 'ck-paired-2025'));
    },
    GAME_TIMEOUT,
  );
});
