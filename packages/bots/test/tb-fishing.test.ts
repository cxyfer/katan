/**
 * Fishing on Katan 的 B-GAME（Q1）與 Q2 門檻（T&B 計畫 §6.1、§6.3；S4）。
 *
 * - profile：'tb-fishing-2025'，3、4 人；`tbMatrix`（`seedsFor` 的種子各一局，standard 與 easy 輪替，另加 bot2 只走保底的一局）。
 *   步數上限 3000、看門狗 60 次擲骰（`PROFILE_LIMITS`）。每局都要通過 `expectTbGameHealthy`。
 * - 策略真的作答：包裝 T&B 模組的 `answerFrame`，記下 standard／easy 對 `fishSwap` 的答案；`fishSwap` 一律由策略作答，不走保底
 *   （`answerFrame` 回 null 的次數為 0）。
 * - Q2（S = 每個人數的種子數，共 2S 局，不含保底席那一局）：
 *   - `tb.spendFish`（策略送出）≥ 2S（推測值）；
 *   - standard 與 easy 各自送出 `tb.spendFish`；easy 只用在道路、取資源與發展卡，而且不交換（只放棄）。
 * - 決定性：3 人種子 1 重跑一次，決策雜湊相同（R2）。
 *
 * 固定盤面、B-FAIR 與 fuzz 在 `tb-fishing-decisions.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { requireProfile, type PublicModulePendingView } from '@katan/rules';
import { TB_FRAME_KINDS } from '../src/modules/tradersBarbarians/frames.ts';
import type { BotModule } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botModulesOf } from '../src/support.ts';
import type { BotLevel } from '../src/types.ts';
import { GAME_TIMEOUT, seedsFor } from './harness.ts';
import { commandCount, expectTbGameHealthy, runTbGame, tbMatrix, type TbGameRecord, type TbGameSpec } from './tb-game.ts';

declare const console: { table(data: unknown): void };

const PROFILE = 'tb-fishing-2025';
const S = seedsFor(requireProfile(PROFILE)).length;
const FISH_COMMANDS = ['tb.spendFish', 'tb.giveBoot', 'tb.fishSwap'];
const EASY_USES: readonly string[] = ['road', 'takeResource', 'devCard'];

type Level = 'standard' | 'easy';

interface Played {
  readonly record: TbGameRecord;
  /** 策略對 `fishSwap` 的答案：`swaps[level]` 是換掉的面額（null 是放棄）。 */
  readonly swaps: Record<Level, (number | null)[]>;
  /** 策略對 `fishSwap` 回 null（骨架改走保底）的次數。 */
  readonly idle: number;
  /** 策略座位花魚的用途，依難度。 */
  readonly uses: Record<Level, Record<string, number>>;
}

function play(spec: TbGameSpec): Played {
  const swaps: Record<Level, (number | null)[]> = { standard: [], easy: [] };
  const uses: Record<Level, Record<string, number>> = { standard: {}, easy: {} };
  let idle = 0;
  const modules = botModulesOf(requireProfile(PROFILE));
  const policyFor = (level: BotLevel) => {
    const wrapped = modules.map((module): BotModule => {
      if (!module.answerFrame) return module;
      return {
        ...module,
        answerFrame: (turn, frame: PublicModulePendingView) => {
          const answer = module.answerFrame!(turn, frame);
          if (frame.kind === TB_FRAME_KINDS.fishSwap && (level === 'standard' || level === 'easy')) {
            if (answer) swaps[level].push((answer as { token?: number | null }).token ?? null);
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
      if (step.source !== 'policy' || step.actor === fallbackActor || step.command.type !== 'tb.spendFish') return;
      if (step.level !== 'standard' && step.level !== 'easy') return;
      const action = String((step.command as { action?: unknown }).action);
      uses[step.level][action] = (uses[step.level][action] ?? 0) + 1;
    },
  });
  return { record, swaps, idle, uses };
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

const policyCount = (record: TbGameRecord, type: string): number =>
  commandCount(record, type, 'standard') + commandCount(record, type, 'easy');
const levelOf = (record: TbGameRecord, id: string | null): string => {
  if (id === null) return '-';
  const index = record.state.players.findIndex((player) => player.id === id);
  return index === record.spec.fallbackSeat ? 'fallback' : (record.spec.levels[index] ?? '?');
};
const usesText = (uses: Record<string, number>): string =>
  Object.entries(uses)
    .map(([action, count]) => `${action}:${count}`)
    .join(' ');

describe(`B-GAME ${PROFILE}`, () => {
  for (const spec of SPECS) {
    it(`${spec.label} finishes healthy`, () => {
      const { record, idle } = playedOf(spec);
      expectTbGameHealthy(record);
      expect(idle, `${spec.label}: fishSwap frames the strategy left to the fallback`).toBe(0);
      // 只走保底的座位不靠策略；它的指令都記在 fallback。
      if (spec.fallbackSeat === undefined) expect(record.commands.fallback, spec.label).toEqual({});
    }, GAME_TIMEOUT);
  }

  it('replays the same decisions for the same seed (R2)', () => {
    const spec = SPECS[0]!;
    expect(play(spec).record.hash).toBe(playedOf(spec).record.hash);
  }, GAME_TIMEOUT);
});

describe(`Q2 ${PROFILE} (S = ${S})`, () => {
  it('meets the §6.3 threshold and both levels fish', () => {
    const all = SPECS.map(playedOf);
    const seeded = all.filter((entry) => entry.record.spec.fallbackSeat === undefined);
    expect(seeded).toHaveLength(2 * S);

    console.table(
      all.map(({ record, uses, swaps }) => ({
        game: record.label,
        winner: `${record.winner} (${levelOf(record, record.winner)})`,
        steps: record.steps,
        rounds: Math.round((commandCount(record, 'turn.roll') / record.spec.players) * 10) / 10,
        stagnation: record.longestStagnation,
        window: record.maxWindowCommands,
        spend: `${commandCount(record, 'tb.spendFish', 'standard')}/${commandCount(record, 'tb.spendFish', 'easy')}`,
        standard: usesText(uses.standard),
        easy: usesText(uses.easy),
        boot: `${commandCount(record, 'tb.giveBoot', 'standard')}/${commandCount(record, 'tb.giveBoot', 'easy')}`,
        swaps: `${swaps.standard.filter((token) => token !== null).length}/${swaps.standard.length} · ${swaps.easy.length}`,
      })),
    );

    const spends = seeded.reduce((total, entry) => total + policyCount(entry.record, 'tb.spendFish'), 0);
    expect(spends, 'tb.spendFish by the strategy').toBeGreaterThanOrEqual(2 * S);

    // DoD 1：standard 與 easy 各自送出 Fishing 的模組指令，而且花了魚。
    for (const level of ['standard', 'easy'] as const) {
      const sent = FISH_COMMANDS.reduce(
        (total, type) => total + all.reduce((inner, entry) => inner + commandCount(entry.record, type, level), 0),
        0,
      );
      expect(sent, `${level} fishing commands`).toBeGreaterThan(0);
      expect(all.reduce((total, entry) => total + commandCount(entry.record, 'tb.spendFish', level), 0), `${level} spendFish`).toBeGreaterThan(0);
    }
    // easy 只用在道路、取資源與發展卡，不交換（§4.2）；standard 只換面額 1。
    for (const entry of all) {
      for (const action of Object.keys(entry.uses.easy)) expect(EASY_USES, `${entry.record.label}: easy ${action}`).toContain(action);
      expect(entry.swaps.easy.every((token) => token === null), `${entry.record.label}: easy swaps`).toBe(true);
      expect(entry.swaps.standard.every((token) => token === null || token === 1), `${entry.record.label}: standard swaps`).toBe(true);
    }
  }, GAME_TIMEOUT * 4);
});
