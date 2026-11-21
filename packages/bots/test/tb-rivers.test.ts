/**
 * Rivers of Katan 的 B-GAME（Q1）與 Q2 門檻（T&B 計畫 §6.1、§6.3；S8）。
 *
 * - profile：'tb-rivers-2025'（`tb-coins` + `tb-rivers`），3、4 人；`tbMatrix`（`seedsFor` 的種子各一局，standard 與 easy 輪替，
 *   另加 bot2 只走保底的一局）。步數上限 3000、看門狗 60 次擲骰（`PROFILE_LIMITS`）。每局都要通過 `expectTbGameHealthy`，
 *   而且策略座位沒有任何指令記在 fallback。
 * - Q2（S = 每個人數的種子數，共 2S 局，不含保底席那一局；只計策略送出、被接受的指令）：
 *   - `tb.buildBridge` ≥ ⌈0.5S⌉（推測值）；
 *   - `tb.buyResource` + `tb.sellResources` ≥ S（推測值）；
 *   - standard 與 easy 各自送出 Rivers 的模組指令（`tb.buildBridge`）與 coins 的模組指令；easy 不賣（§4.2 coins 列）。
 * - 決定性：3 人種子 1 重跑一次，決策雜湊相同（R2）。
 *
 * 固定盤面、投影 → `boardModel` 的路徑、B-FAIR 與 fuzz 在 `tb-rivers-decisions.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { requireProfile } from '@katan/rules';
import { GAME_TIMEOUT, seedsFor } from './harness.ts';
import { partStateOf } from './modules/tb/part.ts';
import { commandCount, expectTbGameHealthy, runTbGame, tbMatrix, type TbGameRecord, type TbGameSpec } from './tb-game.ts';

declare const console: { table(data: unknown): void };

const PROFILE = 'tb-rivers-2025';
const S = seedsFor(requireProfile(PROFILE)).length;
const COIN_COMMANDS = ['tb.buyResource', 'tb.sellResources'];

const SPECS: readonly TbGameSpec[] = [3, 4].flatMap((players) => tbMatrix(PROFILE, players));
const played = new Map<string, TbGameRecord>();
const playedOf = (spec: TbGameSpec): TbGameRecord => {
  let record = played.get(spec.label);
  if (!record) {
    record = runTbGame(spec);
    played.set(spec.label, record);
  }
  return record;
};

const policyCount = (record: TbGameRecord, type: string): number =>
  commandCount(record, type, 'standard') + commandCount(record, type, 'easy');
const levelOf = (record: TbGameRecord, id: string | null): string => {
  if (id === null) return '-';
  const index = record.state.players.findIndex((player) => player.id === id);
  return index === record.spec.fallbackSeat ? 'fallback' : (record.spec.levels[index] ?? '?');
};
const split = (record: TbGameRecord, type: string): string =>
  `${commandCount(record, type, 'standard')}/${commandCount(record, type, 'easy')}`;
const sumOf = (records: readonly TbGameRecord[], count: (record: TbGameRecord) => number): number =>
  records.reduce((total, record) => total + count(record), 0);

describe(`B-GAME ${PROFILE}`, () => {
  for (const spec of SPECS) {
    it(`${spec.label} finishes healthy`, () => {
      const record = playedOf(spec);
      expectTbGameHealthy(record);
      // 只走保底的座位不靠策略；策略座位的指令都不該記在 fallback。
      if (spec.fallbackSeat === undefined) expect(record.commands.fallback, spec.label).toEqual({});
    }, GAME_TIMEOUT);
  }

  it('replays the same decisions for the same seed (R2)', () => {
    const spec = SPECS[0]!;
    expect(runTbGame(spec).hash).toBe(playedOf(spec).hash);
  }, GAME_TIMEOUT);
});

describe(`Q2 ${PROFILE} (S = ${S})`, () => {
  it('meets the §6.3 thresholds and both levels send Rivers and coins commands', () => {
    const all = SPECS.map(playedOf);
    const seeded = all.filter((record) => record.spec.fallbackSeat === undefined);
    expect(seeded).toHaveLength(2 * S);

    console.table(
      all.map((record) => ({
        game: record.label,
        winner: `${record.winner} (${levelOf(record, record.winner)})`,
        steps: record.steps,
        rounds: Math.round((commandCount(record, 'turn.roll') / record.spec.players) * 10) / 10,
        stagnation: record.longestStagnation,
        window: record.maxWindowCommands,
        bridge: split(record, 'tb.buildBridge'),
        buy: split(record, 'tb.buyResource'),
        sell: split(record, 'tb.sellResources'),
        gold: Object.values(partStateOf<{ gold: Record<string, number> }>(record.state, 'tb-coins')?.gold ?? {}).join(','),
      })),
    );

    const bridges = sumOf(seeded, (record) => policyCount(record, 'tb.buildBridge'));
    expect(bridges, 'tb.buildBridge by the strategy').toBeGreaterThanOrEqual(Math.ceil(0.5 * S));
    const trades = sumOf(seeded, (record) => COIN_COMMANDS.reduce((total, type) => total + policyCount(record, type), 0));
    expect(trades, 'tb.buyResource + tb.sellResources by the strategy').toBeGreaterThanOrEqual(S);
    // kit 的機制計數與策略的指令計數一致（只算策略送出的）。
    expect(sumOf(seeded, (record) => record.mechanics['tradersBarbarians.tb-rivers.bridge.standard'] ?? 0)).toBe(
      sumOf(seeded, (record) => commandCount(record, 'tb.buildBridge', 'standard')),
    );

    // DoD 1：standard 與 easy 各自送出 Rivers 與 coins 的模組指令；easy 只買不賣（§4.2）。
    for (const level of ['standard', 'easy'] as const) {
      expect(sumOf(all, (record) => commandCount(record, 'tb.buildBridge', level)), `${level} bridges`).toBeGreaterThan(0);
      expect(sumOf(all, (record) => commandCount(record, 'tb.buyResource', level)), `${level} purchases`).toBeGreaterThan(0);
    }
    expect(sumOf(all, (record) => commandCount(record, 'tb.sellResources', 'easy')), 'easy sales').toBe(0);
  }, GAME_TIMEOUT * 4);
});
