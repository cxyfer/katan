/**
 * Seafarers B-GAME、B-POLICY 決定性、B-POLICY-SEA 取樣與 Q2 門檻驗收測試（SF 計畫 §6.1、§6.2）。
 *
 * - profile 與人數：
 *   - 'sf-new-shores-2025': 3、4 人
 *   - 'sf-new-shores-paired-2025': 5、6 人
 * - 座位：mixedLevels（standard 與 easy 交錯），仿 BotDriver 模式
 * - 種子：seedsFor(profile)，預設 1–3，BOTS_SEEDS=10 時為 1–10
 * - 步數上限 5000，看門狗 N=60
 * - 斷言：
 *   - 有勝者；0 拒絕；沒有殘留 pending；資源守恆；道路與船各 ≤ 15；
 *   - 0 次「策略閒置、但保底有動作」；每視窗每座位 ≤ 40；非行動者只送 responseCommands。
 * - B-POLICY-SEA：每 5 步取樣一次，sea.ts 算出的船位與道路位置等於 hints，含船的路線長度等於 longestRouteLength。
 * - B-POLICY 決定性：4 人種子 3、6 人種子 4，各重播兩次，指令序列逐一相同。
 * - Q2 門檻：Q2-1 到 Q2-5 依規格嚴格判定。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  getTopology,
  longestRouteLength,
  projectGame,
  requireProfile,
  type GameState,
  type GameView,
  type ProfileDefinition,
} from '@catan/rules';
import { forceTurn } from '../../rules/test/helpers.ts';
import { boardModel, routeLength } from '../src/board.ts';
import { turnContext } from '../src/heuristic.ts';
import { botCommandLimit } from '../src/index.ts';
import { seafarersAnswerFrame } from '../src/modules/seafarers/frames.ts';
import { moduleHints } from '../src/modules/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import { roadEdgesFrom, shipEdgesFrom, shipsLeft } from '../src/sea.ts';
import { botSeed } from '../src/seed.ts';
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
  type BotSeat,
  type Decision,
  type StepInfo,
  viewFor,
} from './harness.ts';
import { seafarersKit } from './modules/seafarers.ts';

declare const console: { table(data: unknown): void; log(...args: unknown[]): void };

const KITS = [seafarersKit];

interface SFEntry {
  readonly profileId: 'sf-new-shores-2025' | 'sf-new-shores-paired-2025';
  readonly players: number;
}

const SF_ENTRIES: readonly SFEntry[] = [
  { profileId: 'sf-new-shores-2025', players: 3 },
  { profileId: 'sf-new-shores-2025', players: 4 },
  { profileId: 'sf-new-shores-paired-2025', players: 5 },
  { profileId: 'sf-new-shores-paired-2025', players: 6 },
];

function robberTarget(command: BotCommand): number | null {
  if (command.type === 'pending.moveRobber' || command.type === 'dev.playKnight') {
    return command.hex as number | null;
  }
  return null;
}

function topologyHexes(state: GameState, vertex: number): number[] {
  return getTopology(state.board.layout.topologyId).vertices[vertex]!.hexes;
}

function ownsOnlyBuildingsOn(state: GameState, playerId: string, hex: number): boolean {
  const owners = new Set<string>();
  state.board.buildings.forEach((building, vertex) => {
    if (!building) return;
    if (topologyHexes(state, vertex).includes(hex)) owners.add(building.player);
  });
  return owners.size > 0 && [...owners].every((owner) => owner === playerId);
}

function contractChecks(seats: readonly BotSeat[], profile: ProfileDefinition) {
  const violations: string[] = responseCommandDrift(profile, KITS).map(
    (drift) => `response command drift: ${drift}`,
  );
  const responseCommands = allowedResponseCommands(profile, KITS);

  const check = (state: GameState, decision: Decision): void => {
    const { actor, command } = decision;
    const turnActor = state.players[state.turn.seat]!.id;
    const where = `seq ${state.seq} ${actor} ${command.type}`;

    if (actor !== turnActor && !responseCommands.has(command.type)) {
      violations.push(`non-actor: ${where}`);
    }
    if (actor !== turnActor && command.type === 'build.road' && state.pending?.kind !== 'freeRoads') {
      violations.push(`non-actor road: ${where}`);
    }

    const paired = requireProfile(state.profileId).paired && state.turn.pairedActor === 2;
    if (paired && actor === turnActor && (command.type === 'trade.offer' || command.type === 'trade.settle')) {
      violations.push(`paired second trades: ${where}`);
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

    const seat = seats.find((candidate) => candidate.id === actor);
    const robberHex = robberTarget(command);
    if (
      seat?.level === 'standard' &&
      robberHex !== null &&
      state.board.layout.terrain[robberHex] !== 'sea' &&
      ownsOnlyBuildingsOn(state, actor, robberHex)
    ) {
      violations.push(`robber on own hex: ${where} hex ${robberHex}`);
    }
  };

  return { violations, check };
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
  paidShips: number;
  islandBonuses: number;
  standardPaidShips: number;
  easyPaidShips: number;
  policyGoldChoices: number;
  standardShipsMoved: number;
  maxWindowCommands: number;
  longestStagnation: number;
}

describe('Seafarers B-GAME', () => {
  const allGameStats: GameStats[] = [];

  for (const entry of SF_ENTRIES) {
    const { profileId, players } = entry;
    const profile = requireProfile(profileId);
    const seeds = seedsFor(profile);

    it(
      `finishes with a winner and satisfies Q1 invariants (${profileId}, ${players} players, ${seeds.length} seeds)`,
      () => {
        const limit = botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT);

        for (const seed of seeds) {
          const seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
          const contract = contractChecks(seats, profile);
          const seaProblems: string[] = [];
          let seaComparisons = 0;
          let policyGoldChoices = 0;
          let stepCount = 0;

          const run = runBotGame({
            seats,
            seed,
            profileId,
            kits: KITS,
            onDecision: (state, decision) => {
              contract.check(state, decision);
              if (decision.command.type === 'gold.choose' && decision.source !== 'fallback') {
                const seat = seats.find((s) => s.id === decision.actor)!;
                const view = viewFor(state, decision.actor);
                const ctx = {
                  selfId: decision.actor,
                  level: seat.level,
                  seed: botSeed('test', decision.actor, state.seq),
                  offerPhases: {},
                };
                const pending = view.pending as Parameters<typeof seafarersAnswerFrame>[1];
                const own = seafarersAnswerFrame(turnContext(view, ctx, seat.level), pending);
                if (own && JSON.stringify(own) === JSON.stringify(decision.command)) {
                  policyGoldChoices += 1;
                }
              }
            },
            onStep: (step: StepInfo) => {
              if (stepCount++ % 5 === 0) {
                // B-POLICY-SEA: 取樣比對 sea.ts 與 hints / rules
                const seat = step.after.turn.seat;
                const player = step.after.players[seat];
                if (player) {
                  const forced = asActor(step.after, seat);
                  const view = viewOf(forced, player.id);
                  const hints = moduleHints(view.hints, 'seafarers');
                  if (!hints) {
                    seaProblems.push(`step ${stepCount} seq ${step.after.seq} ${player.id}: missing seafarers hints`);
                  } else {
                    seaComparisons += 1;
                    const model = boardModel(view, player.id);
                    const ships = shipEdgesFrom(view, player.id).slice().sort((a, b) => a - b);
                    const expectedShips = shipsLeft(model) > 0 ? hints.legalShips : [];
                    if (JSON.stringify(ships) !== JSON.stringify(expectedShips)) {
                      seaProblems.push(
                        `step ${stepCount} seq ${step.after.seq} ${player.id}: ship edges mismatch`,
                      );
                    }
                    const roads = roadEdgesFrom(view, player.id).slice().sort((a, b) => a - b);
                    if (JSON.stringify(roads) !== JSON.stringify(view.hints!.legalRoads)) {
                      seaProblems.push(
                        `step ${stepCount} seq ${step.after.seq} ${player.id}: road edges mismatch`,
                      );
                    }
                    for (const movable of hints.movableShips) {
                      const targets = shipEdgesFrom(view, player.id, { moving: movable.edge }).slice().sort((a, b) => a - b);
                      const expected = movable.targets.slice().sort((a, b) => a - b);
                      if (JSON.stringify(targets) !== JSON.stringify(expected)) {
                        seaProblems.push(
                          `step ${stepCount} seq ${step.after.seq} ${player.id}: movable ship ${movable.edge} targets mismatch`,
                        );
                      }
                    }
                    const length = routeLength(model, player.id);
                    const expectedLength = longestRouteLength(forced, player.id, true);
                    if (length !== expectedLength) {
                      seaProblems.push(
                        `step ${stepCount} seq ${step.after.seq} ${player.id}: route length ${length} != ${expectedLength}`,
                      );
                    }
                  }
                }
              }
            },
          });

          const label = `${profileId} ${players}p seed ${seed}`;

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
            paidShips: run.mechanics['seafarers.paidShips'] ?? 0,
            islandBonuses: run.mechanics['seafarers.islandBonuses'] ?? 0,
            standardPaidShips: run.mechanics['seafarers.standardPaidShips'] ?? 0,
            easyPaidShips: run.mechanics['seafarers.easyPaidShips'] ?? 0,
            policyGoldChoices,
            standardShipsMoved: run.mechanics['seafarers.standardShipsMoved'] ?? 0,
            maxWindowCommands: run.maxWindowCommands,
            longestStagnation: run.longestStagnation,
          });

          // Q1 矩陣斷言
          expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
          expect(run.stuck, `${label}: both policy and fallback idle at seq ${run.state.seq}`).toBeNull();
          expect(
            run.watchdog,
            `${label}: watchdog tripped after ${run.watchdog?.rolls} rolls without improvement`,
          ).toBeNull();
          expect(run.idleFallbacks, `${label}: policy idled while fallback acted`).toEqual([]);
          expect(run.state.result?.reason, `${label}: no victory after ${run.steps} steps`).toBe('victory');
          expect(run.state.pending, `${label}: unresolved pending`).toBeNull();
          expect(run.conservation, `${label}: conservation failed`).toEqual([]);
          expect(run.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(limit);
          expect(contract.violations, `${label}: contract violations`).toEqual([]);
          expect(seaProblems, `${label}: sea model mismatch`).toEqual([]);
          expect(seaComparisons, `${label}: B-POLICY-SEA comparison count`).toBeGreaterThan(0);

          // 道路與船各 ≤ 15
          for (const player of run.state.players) {
            const roads = run.state.board.roads.filter((r) => r && r.player === player.id && !r.ship).length;
            const shipsCount = run.state.board.roads.filter((r) => r && r.player === player.id && r.ship).length;
            expect(roads, `${label}: ${player.id} roads count`).toBeLessThanOrEqual(15);
            expect(shipsCount, `${label}: ${player.id} ships count`).toBeLessThanOrEqual(15);
          }
        }
      },
      GAME_TIMEOUT,
    );
  }

  const seedCount = seedsFor(requireProfile('sf-new-shores-2025')).length;

  it.skipIf(seedCount !== 3 && seedCount !== 10)('checks Q2 thresholds across all played games', () => {
    expect(allGameStats.length, 'allGameStats count must equal expected total games across matrix').toBe(
      SF_ENTRIES.length * seedCount,
    );

    console.table(
      allGameStats.map((s) => ({
        game: `${s.profileId} ${s.players}p s${s.seed}`,
        steps: s.steps,
        winner: s.winner,
        reason: s.reason,
        watchdog: s.watchdog ? 'TRIPPED' : 'ok',
        paidShips: s.paidShips,
        islandBonuses: s.islandBonuses,
        stdPaid: s.standardPaidShips,
        easyPaid: s.easyPaidShips,
        goldPolicy: s.policyGoldChoices,
        stdMoved: s.standardShipsMoved,
        maxWindow: s.maxWindowCommands,
        stagnant: s.longestStagnation,
      })),
    );

    // 依 profile 與人數分組檢查 Q2 門檻
    for (const entry of SF_ENTRIES) {
      const { profileId, players } = entry;
      const stats = allGameStats.filter((s) => s.profileId === profileId && s.players === players);
      const label = `${profileId} ${players}p (${seedCount} seeds)`;
      expect(stats.length, `${label}: played games must equal seed count`).toBe(seedCount);

      const q2_1Games = stats.filter((s) => s.paidShips > 0).length;
      const q2_2Games = stats.filter((s) => s.islandBonuses > 0).length;

      if (seedCount === 3) {
        // 預設 3 種子：Q2-1 需 3/3，Q2-2 需 ≥ 2/3
        expect(q2_1Games, `Q2-1 (${label}) paid build.ship games: ${q2_1Games}/${seedCount}`).toBe(3);
        expect(
          q2_2Games,
          `Q2-2 (${label}) island bonus games: ${q2_2Games}/${seedCount}`,
        ).toBeGreaterThanOrEqual(2);
      } else if (seedCount === 10) {
        // 10 種子：Q2-1 ≥ 9/10，Q2-2 ≥ 8/10
        expect(
          q2_1Games,
          `Q2-1 (${label}) paid build.ship games: ${q2_1Games}/${seedCount}`,
        ).toBeGreaterThanOrEqual(9);
        expect(
          q2_2Games,
          `Q2-2 (${label}) island bonus games: ${q2_2Games}/${seedCount}`,
        ).toBeGreaterThanOrEqual(8);
      }
    }

    // 10 種子時檢查 Q2-3、Q2-4、Q2-5（每個 profile 合計 20 局）
    if (seedCount === 10) {
      for (const pid of ['sf-new-shores-2025', 'sf-new-shores-paired-2025'] as const) {
        const stats = allGameStats.filter((s) => s.profileId === pid);
        expect(stats.length, `stats for ${pid} must equal 20 games`).toBe(20);

        const q2_3Standard = stats.filter((s) => s.standardPaidShips > 0).length;
        const q2_3Easy = stats.filter((s) => s.easyPaidShips > 0).length;
        const q2_4Games = stats.filter((s) => s.policyGoldChoices > 0).length;
        const q2_5Games = stats.filter((s) => s.standardShipsMoved > 0).length;

        expect(q2_3Standard, `Q2-3 (${pid}) standard paid ship games: ${q2_3Standard}/20`).toBeGreaterThanOrEqual(
          12,
        );
        expect(q2_3Easy, `Q2-3 (${pid}) easy paid ship games: ${q2_3Easy}/20`).toBeGreaterThanOrEqual(12);
        expect(q2_4Games, `Q2-4 (${pid}) policy gold.choose games: ${q2_4Games}/20`).toBeGreaterThanOrEqual(4);
        expect(q2_5Games, `Q2-5 (${pid}) standard ship.move games: ${q2_5Games}/20`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('B-POLICY determinism', () => {
  it(
    'replays identically for 4 players (seed 3, sf-new-shores-2025)',
    () => {
      const seats = (seed: number) =>
        botSeats(mixedLevels(4, seed), (level) => createBotPolicy(level));

      const run1Commands: string[] = [];
      const run2Commands: string[] = [];

      runBotGame({
        seats: seats(3),
        seed: 3,
        profileId: 'sf-new-shores-2025',
        kits: KITS,
        onDecision: (_, d) => run1Commands.push(`${d.actor}:${JSON.stringify(d.command)}`),
      });

      runBotGame({
        seats: seats(3),
        seed: 3,
        profileId: 'sf-new-shores-2025',
        kits: KITS,
        onDecision: (_, d) => run2Commands.push(`${d.actor}:${JSON.stringify(d.command)}`),
      });

      expect(run1Commands.length).toBeGreaterThan(0);
      expect(run1Commands).toEqual(run2Commands);
    },
    GAME_TIMEOUT,
  );

  it(
    'replays identically for 6 players (seed 4, sf-new-shores-paired-2025)',
    () => {
      const seats = (seed: number) =>
        botSeats(mixedLevels(6, seed), (level) => createBotPolicy(level));

      const run1Commands: string[] = [];
      const run2Commands: string[] = [];

      runBotGame({
        seats: seats(4),
        seed: 4,
        profileId: 'sf-new-shores-paired-2025',
        kits: KITS,
        onDecision: (_, d) => run1Commands.push(`${d.actor}:${JSON.stringify(d.command)}`),
      });

      runBotGame({
        seats: seats(4),
        seed: 4,
        profileId: 'sf-new-shores-paired-2025',
        kits: KITS,
        onDecision: (_, d) => run2Commands.push(`${d.actor}:${JSON.stringify(d.command)}`),
      });

      expect(run1Commands.length).toBeGreaterThan(0);
      expect(run1Commands).toEqual(run2Commands);
    },
    GAME_TIMEOUT,
  );
});
