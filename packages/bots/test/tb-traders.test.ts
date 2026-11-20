/**
 * Traders & Barbarians 劇本（`tb-traders-barbarians-2025`）的 B-GAME 與 Q2（T&B 計畫 §6.1、§6.3；S7）。
 *
 * - Q1：3、4 人各跑 `tbMatrix`（`seedsFor` 的種子，standard 與 easy 輪替，另加 bot2 只走保底的一局），全部
 *   `expectTbGameHealthy`。每一步另外檢查：
 *   - 策略座位在 `tbWagon`／`tbBarbarian` frame 的每個答案都來自 Traders 的 part（包裝模組的 `answerFrame` 記下答案，
 *     不是 frame 退回保底）；
 *   - 策略的車隊只在送貨或裝貨時進入據點的廣場（進入廣場就結束這一次移動，路過是浪費）；
 *   - 單一 `tbWagon` frame 內，同一座位最多送 12 個非 stop 指令（§4.4）。
 * - Q2（只計 `seedsFor` 的 2S 局，保底席那一局不算）：運貨 ≥5S、`tb.upgradeWagon` ≥S、`tb.playKnight` ≥S；standard
 *   與 easy 各自發出 Traders 的模組指令。
 * - 決定性（R2）：4 人第一個種子重跑，決策雜湊相同。
 *
 * 實測數字（局數、勝者、平均回合、最長無得分、每視窗最大指令數）以 `console.table` 印出，供 S9／QA 彙整。
 */

import { describe, expect, it } from 'vitest';
import { requireProfile, TB_FRAME_KINDS, TRADERS_BARBARIANS, type GameState, type ModulePending } from '@catan/rules';
import { botModulesOf } from '../src/index.ts';
import type { BotCommand, BotModule } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotLevel } from '../src/types.ts';
import { GAME_TIMEOUT, seedsFor, type Decision, type StepInfo } from './harness.ts';
import { commandCount, expectTbGameHealthy, runTbGame, tbMatrix, type TbGameRecord, type TbGameSpec } from './tb-game.ts';

declare const console: { table(data: unknown): void };

const PROFILE = 'tb-traders-barbarians-2025';
const S = seedsFor(requireProfile(PROFILE)).length;
const ANSWERED_FRAMES: ReadonlySet<string> = new Set([TB_FRAME_KINDS.tbWagon, TB_FRAME_KINDS.tbBarbarian]);
const FRAME_COMMAND_CAP = 12;

interface TradersGame {
  readonly record: TbGameRecord;
  /** 策略座位在 Traders frame 的決策數，以及其中由 Traders part 作答的數量。 */
  readonly frameDecisions: number;
  readonly partAnswers: number;
  /** 策略的車隊進入廣場、卻沒有送貨也沒有裝貨的次數。 */
  readonly wastedPlazas: number;
  /** 單一 `tbWagon` frame 內同一座位送出的最多非 stop 指令數。 */
  readonly maxFrameCommands: number;
}

function plazasOf(state: GameState): ReadonlySet<number> {
  const slot = (state.moduleState?.[TRADERS_BARBARIANS] as Record<string, { sites: { plaza: number }[] }> | undefined)?.[
    'tb-traders-barbarians'
  ];
  return new Set(slot?.sites.map((site) => site.plaza) ?? []);
}

function play(spec: TbGameSpec): TradersGame {
  const modules = botModulesOf(requireProfile(PROFILE));
  let lastAnswer: BotCommand | null = null;
  const policyFor = (level: BotLevel) => {
    const wrapped = modules.map((module): BotModule => {
      if (module.id !== TRADERS_BARBARIANS || !module.answerFrame) return module;
      return {
        ...module,
        answerFrame: (turn, frame) => {
          const answer = module.answerFrame!(turn, frame);
          if (answer) lastAnswer = answer;
          return answer;
        },
      };
    });
    return createBotPolicy(level, { modules: wrapped });
  };
  const fallbackActor = spec.fallbackSeat === undefined ? null : `bot${spec.fallbackSeat + 1}`;
  let frameDecisions = 0;
  let partAnswers = 0;
  let wastedPlazas = 0;
  let maxFrameCommands = 0;
  let frameCommands = 0;
  let plazas: ReadonlySet<number> | null = null;

  const onDecision = (state: GameState, decision: Decision): void => {
    const pending = state.pending as ModulePending | null;
    const strategy = decision.actor !== fallbackActor && decision.source !== 'fallback';
    if (strategy && pending && ANSWERED_FRAMES.has(pending.kind) && pending.responders[0] === decision.actor) {
      frameDecisions += 1;
      if (decision.command === lastAnswer) partAnswers += 1;
    }
    lastAnswer = null;
  };
  const onStep = (step: StepInfo): void => {
    const inFrame = (step.before.pending as ModulePending | null)?.kind === TB_FRAME_KINDS.tbWagon;
    if (!inFrame) frameCommands = 0;
    else if (step.command.type !== 'tb.wagonStop') frameCommands += 1;
    maxFrameCommands = Math.max(maxFrameCommands, frameCommands);
    if (step.command.type !== 'tb.wagonStep' || step.source !== 'policy' || step.actor === fallbackActor) return;
    plazas ??= plazasOf(step.before);
    const to = (step.command as { to?: number }).to;
    if (to === undefined || !plazas.has(to)) return;
    const used = step.events.some((event) => event.type === 'tb.commodityDelivered' || event.type === 'tb.commodityLoaded');
    if (!used) wastedPlazas += 1;
  };
  const record = runTbGame(spec, { policyFor, onDecision, onStep });
  return { record, frameDecisions, partAnswers, wastedPlazas, maxFrameCommands };
}

const games: TradersGame[] = [];

function expectHealthy(game: TradersGame): void {
  const { record } = game;
  expectTbGameHealthy(record);
  expect(game.frameDecisions, `${record.label}: Traders frames answered`).toBeGreaterThan(0);
  expect(game.partAnswers, `${record.label}: frames answered by the Traders part`).toBe(game.frameDecisions);
  expect(game.wastedPlazas, `${record.label}: wagon entered a plaza without delivering or loading`).toBe(0);
  expect(game.maxFrameCommands, `${record.label}: commands in one tbWagon frame`).toBeLessThanOrEqual(FRAME_COMMAND_CAP);
}

const delivered = (record: TbGameRecord, level: BotLevel): number =>
  record.mechanics[`${TRADERS_BARBARIANS}.tb-traders-barbarians.delivered.${level}`] ?? 0;

const tbCommands = (record: TbGameRecord, source: 'standard' | 'easy'): number =>
  Object.entries(record.commands[source])
    .filter(([type]) => type.startsWith('tb.'))
    .reduce((sum, [, count]) => sum + count, 0);

describe(`Traders & Barbarians B-GAME (${PROFILE})`, () => {
  for (const players of [3, 4]) {
    it(
      `${players} players: every game finishes healthy and the Traders part answers its frames`,
      () => {
        for (const spec of tbMatrix(PROFILE, players)) {
          const game = play(spec);
          games.push(game);
          expectHealthy(game);
        }
      },
      GAME_TIMEOUT,
    );
  }

  it(
    'replays a seed to the same decision hash (R2)',
    () => {
      const spec = tbMatrix(PROFILE, 4)[0]!;
      const first = games.find((game) => game.record.label === spec.label);
      expect(first, 'the 4-player game ran first').toBeDefined();
      expect(runTbGame(spec).hash).toBe(first!.record.hash);
    },
    GAME_TIMEOUT,
  );

  it('meets the Q2 thresholds over the seedsFor games', () => {
    const counted = games.filter((game) => game.record.spec.fallbackSeat === undefined).map((game) => game.record);
    expect(counted).toHaveLength(2 * S);
    const sumOf = (count: (record: TbGameRecord) => number): number => counted.reduce((sum, record) => sum + count(record), 0);
    const deliveries = sumOf((record) => delivered(record, 'standard') + delivered(record, 'easy'));
    const upgrades = sumOf((record) => commandCount(record, 'tb.upgradeWagon', 'standard') + commandCount(record, 'tb.upgradeWagon', 'easy'));
    const knights = sumOf((record) => commandCount(record, 'tb.playKnight', 'standard') + commandCount(record, 'tb.playKnight', 'easy'));

    console.table(
      games.map(({ record }) => ({
        game: record.label,
        winner: record.winner,
        winnerLevel: record.winner ? record.spec.levels[Number(record.winner.slice(3)) - 1] : null,
        rounds: Math.round((commandCount(record, 'turn.roll') / record.spec.players) * 10) / 10,
        steps: record.steps,
        stagnation: record.longestStagnation,
        window: record.maxWindowCommands,
        delivered: delivered(record, 'standard') + delivered(record, 'easy'),
        upgrades: commandCount(record, 'tb.upgradeWagon'),
        knights: commandCount(record, 'tb.playKnight'),
        boosts: commandCount(record, 'tb.wagonBoost'),
        swift: commandCount(record, 'tb.playSwiftJourney'),
        driveOff: commandCount(record, 'tb.driveOff'),
      })),
    );
    console.table({ S, deliveries, upgrades, knights });

    expect(deliveries, 'deliveries ≥ 5S').toBeGreaterThanOrEqual(5 * S);
    expect(upgrades, 'tb.upgradeWagon ≥ S').toBeGreaterThanOrEqual(S);
    expect(knights, 'tb.playKnight ≥ S').toBeGreaterThanOrEqual(S);
    // easy 不升級、不加速、不驅離、不打 Swift Journey（§4.2 easy 欄）。
    for (const type of ['tb.upgradeWagon', 'tb.wagonBoost', 'tb.driveOff', 'tb.playSwiftJourney']) {
      expect(sumOf((record) => commandCount(record, type, 'easy')), `easy ${type}`).toBe(0);
    }
    // DoD 1：standard 與 easy 各自發出 Traders 的模組指令，而且都送過貨。
    expect(sumOf((record) => tbCommands(record, 'standard')), 'standard tb.* commands').toBeGreaterThan(0);
    expect(sumOf((record) => tbCommands(record, 'easy')), 'easy tb.* commands').toBeGreaterThan(0);
    expect(sumOf((record) => delivered(record, 'standard')), 'standard deliveries').toBeGreaterThan(0);
    expect(sumOf((record) => delivered(record, 'easy')), 'easy deliveries').toBeGreaterThan(0);
  });
});
