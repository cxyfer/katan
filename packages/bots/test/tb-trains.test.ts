/**
 * Merchant Trains 的 B-GAME（Q1）與 Q2 門檻（T&B 計畫 §6.1、§6.3；S5）。
 *
 * - profile：'tb-merchant-trains-2025'，3、4 人；`tbMatrix`（`seedsFor` 的種子各一局，standard 與 easy 輪替，另加 bot2 只走保底的
 *   一局）。步數上限 3000、看門狗 60 次擲骰（`PROFILE_LIMITS`）。每局都要通過 `expectTbGameHealthy`。
 * - 策略真的作答：包裝 T&B 模組的 `answerFrame`，記下 standard／easy 對三種投票 frame 的答案。輪到自己的投票 frame 一律由策略
 *   作答，不走保底：依序回應的 `wagonBid` 只有 `responders[0]` 作答，同時回應的 `wagonAssign` 是 `includes(self)`；
 *   `wagonPlace` 可能由非行動者（過半或出價最高者）放置，也要涵蓋到。
 * - Q2（S = 每個人數的種子數，共 2S 局，不含保底席那一局；kit 的 `mechanics`，只計策略送出的指令）：
 *   - wool + grain > 0 的出價 ≥ S；
 *   - 放置的車廂 ≥ 5S；
 *   - standard 與 easy 各自送出 Trains 的模組指令；easy 一律出價 0。
 * - 決定性：3 人種子 1 重跑一次，決策雜湊相同（R2）。
 *
 * 固定盤面、B-FAIR 與 fuzz 在 `tb-trains-decisions.test.ts`。
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

const PROFILE = 'tb-merchant-trains-2025';
const S = seedsFor(requireProfile(PROFILE)).length;

const VOTE_FRAMES: readonly string[] = [TB_FRAME_KINDS.wagonBid, TB_FRAME_KINDS.wagonAssign, TB_FRAME_KINDS.wagonPlace];
const TRAINS_COMMANDS = ['tb.bidWagon', 'tb.assignWagon', 'tb.placeWagon'];

type Level = 'standard' | 'easy';

interface Played {
  readonly record: TbGameRecord;
  /** 策略對投票 frame 的答案數：`answered[level][frame kind]`。 */
  readonly answered: Record<Level, Record<string, number>>;
  /** 輪到自己（依序 frame 是 `responders[0]`，同時 frame 是 `includes`）卻回 null 的次數。 */
  readonly idle: number;
  /** 策略座位送出的出價張數（wool + grain），依難度。 */
  readonly bidCards: Record<Level, number>;
  /** 非行動者送出的 `tb.placeWagon`（策略座位）。 */
  readonly nonActorPlacements: number;
}

function play(spec: TbGameSpec): Played {
  const answered: Record<Level, Record<string, number>> = { standard: {}, easy: {} };
  const bidCards: Record<Level, number> = { standard: 0, easy: 0 };
  let idle = 0;
  let nonActorPlacements = 0;
  const modules = botModulesOf(requireProfile(PROFILE));
  const policyFor = (level: BotLevel) => {
    const wrapped = modules.map((module): BotModule => {
      if (!module.answerFrame) return module;
      return {
        ...module,
        answerFrame: (turn, frame: PublicModulePendingView) => {
          const answer = module.answerFrame!(turn, frame);
          if (VOTE_FRAMES.includes(frame.kind) && (level === 'standard' || level === 'easy')) {
            const self = turn.ctx.selfId;
            const due = frame.kind === TB_FRAME_KINDS.wagonAssign ? frame.responders.includes(self) : frame.responders[0] === self;
            if (answer) answered[level][frame.kind] = (answered[level][frame.kind] ?? 0) + 1;
            else if (due) idle += 1;
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
      if (step.source !== 'policy' || step.actor === fallbackActor) return;
      if (step.level !== 'standard' && step.level !== 'easy') return;
      if (step.command.type === 'tb.bidWagon') {
        const bid = step.command as unknown as { wool: number; grain: number };
        bidCards[step.level] += bid.wool + bid.grain;
      }
      if (step.command.type === 'tb.placeWagon' && step.actor !== step.before.players[step.before.turn.seat]!.id) {
        nonActorPlacements += 1;
      }
    },
  });
  return { record, answered, idle, bidCards, nonActorPlacements };
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

const mechanic = (entry: Played, name: string): number => entry.record.mechanics[`tradersBarbarians.tb-merchant-trains.${name}`] ?? 0;
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
      expect(idle, `${spec.label}: vote frames the strategy left to the fallback`).toBe(0);
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
  it('meets the §6.3 thresholds and both levels play the scenario', () => {
    const all = SPECS.map(playedOf);
    const seeded = all.filter((entry) => entry.record.spec.fallbackSeat === undefined);
    expect(seeded).toHaveLength(2 * S);

    console.table(
      all.map((entry) => {
        const { record } = entry;
        return {
          game: record.label,
          winner: `${record.winner} (${levelOf(record, record.winner)})`,
          steps: record.steps,
          rounds: Math.round((commandCount(record, 'turn.roll') / record.spec.players) * 10) / 10,
          stagnation: record.longestStagnation,
          window: record.maxWindowCommands,
          bids: `${commandCount(record, 'tb.bidWagon', 'standard')}/${commandCount(record, 'tb.bidWagon', 'easy')}`,
          positiveBids: mechanic(entry, 'positiveBids'),
          bidCards: `${entry.bidCards.standard}/${entry.bidCards.easy}`,
          assigns: commandCount(record, 'tb.assignWagon'),
          places: commandCount(record, 'tb.placeWagon'),
          nonActorPlaces: entry.nonActorPlacements,
          wagons: mechanic(entry, 'wagonsPlaced'),
        };
      }),
    );

    const positive = seeded.reduce((total, entry) => total + mechanic(entry, 'positiveBids'), 0);
    expect(positive, 'bids with wool + grain > 0').toBeGreaterThanOrEqual(S);
    const wagons = seeded.reduce((total, entry) => total + mechanic(entry, 'wagonsPlaced'), 0);
    expect(wagons, 'wagons placed').toBeGreaterThanOrEqual(5 * S);

    // DoD 1：standard 與 easy 各自送出 Trains 的模組指令，而且投票 frame 由策略作答。
    for (const level of ['standard', 'easy'] as const) {
      const sent = TRAINS_COMMANDS.reduce(
        (total, type) => total + all.reduce((inner, entry) => inner + commandCount(entry.record, type, level), 0),
        0,
      );
      expect(sent, `${level} Trains commands`).toBeGreaterThan(0);
      const frames = new Set(all.flatMap((entry) => Object.keys(entry.answered[level])));
      expect(frames.has(TB_FRAME_KINDS.wagonBid), `${level} answers wagonBid`).toBe(true);
      expect(frames.has(TB_FRAME_KINDS.wagonPlace), `${level} answers wagonPlace`).toBe(true);
    }
    // standard 會出價並參與分配；easy 一律出 0（§4.2）。
    expect(all.reduce((total, entry) => total + entry.bidCards.standard, 0), 'standard bid cards').toBeGreaterThan(0);
    expect(all.reduce((total, entry) => total + entry.bidCards.easy, 0), 'easy bid cards').toBe(0);
  }, GAME_TIMEOUT * 4);
});
