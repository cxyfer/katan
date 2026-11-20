/**
 * Barbarian Attack 的 B-GAME（Q1）與 Q2 門檻（T&B 計畫 §6.1、§6.3；S6）。
 *
 * - profile：'tb-barbarian-attack-2025'，3、4 人；`tbMatrix`（`seedsFor` 的種子各一局，standard 與 easy 輪替，另加 bot2 只走保底的
 *   一局）。步數上限 5000、看門狗 60 次擲骰（`PROFILE_LIMITS`）。每局都要通過 `expectTbGameHealthy`。
 * - 策略真的作答：包裝 T&B 模組的 `answerFrame`，記下 standard／easy 對 6 種 BA frame 的答案；BA frame 一律由策略作答，
 *   不走保底（`answerFrame` 回 null 的次數為 0）。
 * - Q2（S = 每個人數的種子數，共 2S 局，不含保底席那一局）：
 *   - `tb.buildBaCard`（策略送出）≥ 5S；
 *   - 俘虜（Capture 加上驅逐）≥ 3S，而且每一局（含保底席）至少 1 個；
 *   - standard 與 easy 各自送出 BA 的模組指令；easy 不加速騎士。
 * - 決定性：3 人種子 1 重跑一次，決策雜湊相同（R2）。
 *
 * 固定盤面、B-FAIR 與 fuzz 在 `tb-barbarian-attack-decisions.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { requireProfile, type PublicModulePendingView } from '@catan/rules';
import { TB_FRAME_KINDS } from '../src/modules/tradersBarbarians/frames.ts';
import type { BotModule } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botModulesOf } from '../src/support.ts';
import type { BotLevel } from '../src/types.ts';
import { GAME_TIMEOUT, seedsFor } from './harness.ts';
import { commandCount, expectTbGameHealthy, runTbGame, tbMatrix, type TbGameRecord, type TbGameSpec } from './tb-game.ts';

declare const console: { table(data: unknown): void };

const PROFILE = 'tb-barbarian-attack-2025';
const S = seedsFor(requireProfile(PROFILE)).length;

const BA_FRAMES: readonly string[] = [
  TB_FRAME_KINDS.baSteal,
  TB_FRAME_KINDS.baCapture,
  TB_FRAME_KINDS.baKnighthood,
  TB_FRAME_KINDS.baSwiftKnight,
  TB_FRAME_KINDS.baTreason,
  TB_FRAME_KINDS.baKnights,
];
const BA_COMMANDS = ['tb.buildBaCard', 'tb.baCapture', 'tb.baPlaceKnight', 'tb.baTreason', 'tb.baSteal', 'tb.moveKnight', 'tb.endKnights'];

type Level = 'standard' | 'easy';

interface Played {
  readonly record: TbGameRecord;
  /** 策略對 BA frame 的答案數：`answered[level][frame kind]`。 */
  readonly answered: Record<Level, Record<string, number>>;
  /** 策略對 BA frame 回 null（骨架改走保底）的次數。 */
  readonly idle: number;
  /** 加速的騎士移動（策略座位，依難度）。 */
  readonly boosts: Record<Level, number>;
}

function play(spec: TbGameSpec): Played {
  const answered: Record<Level, Record<string, number>> = { standard: {}, easy: {} };
  const boosts: Record<Level, number> = { standard: 0, easy: 0 };
  let idle = 0;
  const modules = botModulesOf(requireProfile(PROFILE));
  const policyFor = (level: BotLevel) => {
    const wrapped = modules.map((module): BotModule => {
      if (!module.answerFrame) return module;
      return {
        ...module,
        answerFrame: (turn, frame: PublicModulePendingView) => {
          const answer = module.answerFrame!(turn, frame);
          if (BA_FRAMES.includes(frame.kind) && (level === 'standard' || level === 'easy')) {
            if (answer) answered[level][frame.kind] = (answered[level][frame.kind] ?? 0) + 1;
            else idle += 1;
          }
          return answer;
        },
      };
    });
    return createBotPolicy(level, { modules: wrapped });
  };
  const fallbackActor = spec.fallbackSeat === undefined ? null : `bot${spec.fallbackSeat + 1}`;
  const record = runTbGame(spec, {
    policyFor,
    onStep: (step) => {
      if (step.source !== 'policy' || step.actor === fallbackActor || step.command.type !== 'tb.moveKnight') return;
      if ((step.command as { boost?: unknown }).boost === true && (step.level === 'standard' || step.level === 'easy')) {
        boosts[step.level] += 1;
      }
    },
  });
  return { record, answered, idle, boosts };
}

const SPECS: readonly TbGameSpec[] = [3, 4].flatMap((players) => tbMatrix(PROFILE, players));
const played = new Map<string, Played>();
const playedOf = (spec: TbGameSpec): Played => {
  let entry = played.get(spec.label);
  if (!entry) {
    entry = play(spec);
    played.set(spec.label, entry);
  }
  return entry;
};

const mechanic = (entry: Played, name: string): number => entry.record.mechanics[`tradersBarbarians.tb-barbarian-attack.${name}`] ?? 0;
const policyCount = (record: TbGameRecord, type: string): number =>
  commandCount(record, type, 'standard') + commandCount(record, type, 'easy');
const levelOf = (record: TbGameRecord, id: string | null): string => {
  if (id === null) return '-';
  const index = record.state.players.findIndex((player) => player.id === id);
  return index === record.spec.fallbackSeat ? 'fallback' : (record.spec.levels[index] ?? '?');
};

describe(`B-GAME ${PROFILE}`, () => {
  for (const spec of SPECS) {
    it(`${spec.label} finishes healthy`, () => {
      const { record, idle } = playedOf(spec);
      expectTbGameHealthy(record);
      expect(idle, `${spec.label}: BA frames the strategy left to the fallback`).toBe(0);
      // 只走保底的座位不靠策略；它的 BA 指令都記在 fallback。
      if (spec.fallbackSeat === undefined) expect(record.commands.fallback, spec.label).toEqual({});
    }, GAME_TIMEOUT);
  }

  it('replays the same decisions for the same seed (R2)', () => {
    const spec = SPECS[0]!;
    expect(play(spec).record.hash).toBe(playedOf(spec).record.hash);
  }, GAME_TIMEOUT);
});

describe(`Q2 ${PROFILE} (S = ${S})`, () => {
  it('meets the §6.3 thresholds and both levels play the scenario', () => {
    const all = SPECS.map(playedOf);
    const seeded = all.filter((entry) => entry.record.spec.fallbackSeat === undefined);
    expect(seeded).toHaveLength(2 * S);

    console.table(
      all.map(({ record, boosts }) => ({
        game: record.label,
        winner: `${record.winner} (${levelOf(record, record.winner)})`,
        steps: record.steps,
        rounds: Math.round((commandCount(record, 'turn.roll') / record.spec.players) * 10) / 10,
        stagnation: record.longestStagnation,
        window: record.maxWindowCommands,
        baCards: `${commandCount(record, 'tb.buildBaCard', 'standard')}/${commandCount(record, 'tb.buildBaCard', 'easy')}`,
        prisoners: mechanic(playedOf(record.spec), 'prisoners'),
        expels: mechanic(playedOf(record.spec), 'expels'),
        conquered: mechanic(playedOf(record.spec), 'conquered'),
        boosts: `${boosts.standard}/${boosts.easy}`,
      })),
    );

    const cards = seeded.reduce((total, entry) => total + policyCount(entry.record, 'tb.buildBaCard'), 0);
    expect(cards, 'tb.buildBaCard by the strategy').toBeGreaterThanOrEqual(5 * S);
    const prisoners = seeded.reduce((total, entry) => total + mechanic(entry, 'prisoners'), 0);
    expect(prisoners, 'prisoners').toBeGreaterThanOrEqual(3 * S);
    for (const entry of all) expect(mechanic(entry, 'prisoners'), `${entry.record.label}: prisoners`).toBeGreaterThanOrEqual(1);

    // DoD 1：standard 與 easy 各自送出 BA 的模組指令，而且 BA 的 frame 由策略作答。
    for (const level of ['standard', 'easy'] as const) {
      const sent = BA_COMMANDS.reduce(
        (total, type) => total + all.reduce((inner, entry) => inner + commandCount(entry.record, type, level), 0),
        0,
      );
      expect(sent, `${level} BA commands`).toBeGreaterThan(0);
      expect(all.reduce((total, entry) => total + commandCount(entry.record, 'tb.buildBaCard', level), 0), `${level} BA cards`).toBeGreaterThan(0);
      expect(all.reduce((total, entry) => total + commandCount(entry.record, 'tb.moveKnight', level), 0), `${level} knight moves`).toBeGreaterThan(0);
      const frames = new Set(all.flatMap((entry) => Object.keys(entry.answered[level])));
      expect(frames.has(TB_FRAME_KINDS.baKnights), `${level} answers baKnights`).toBe(true);
    }
    // easy 不加速（§4.2）。
    expect(all.reduce((total, entry) => total + entry.boosts.easy, 0), 'easy boosts').toBe(0);
  }, GAME_TIMEOUT * 4);
});
