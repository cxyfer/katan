/**
 * Golden replay：以凍結的 v0.4.0 driver 搭配目前的策略重跑 base 的 48 局，逐欄比對
 * `golden/base-v040.json`。平台重構（模組化骨架）不得改變 base 的任何一個決策。
 *
 * 不一致時，訊息會指出第一個不同的 checkpoint（每 100 步一個），縮小分歧的範圍。
 * fixture 在 0.4.1 內不得修改；需要重錄時，由主 agent 決定並寫明原因（見 golden/record.ts）。
 */

import { describe, expect, it } from 'vitest';
import baseV040 from './golden/base-v040.json';
import {
  CHECKPOINT_INTERVAL,
  GOLDEN_GAMES,
  playGolden,
  type GoldenGame,
  type GoldenOutcome,
  type GoldenRecord,
} from './golden/driver.ts';

// 整局模擬在忙碌的機器上可能超過預設的 5 秒（base 40 局在 load ≈ 22 時約需 50 秒）。
const GAME_TIMEOUT = 120_000;

const fixture = baseV040 as unknown as readonly GoldenRecord[];

/** 先比對的欄位；`hash`、`checkpoints` 另外處理，才能指出分歧位置。 */
const SCALAR_FIELDS = ['profileId', 'players', 'seed', 'levels', 'maxSteps', 'steps', 'seq', 'winner', 'reason'] as const;

/** 描述兩段 checkpoint 序列第一個分歧的位置；完全相同時回傳 null。 */
function describeDivergence(expected: GoldenRecord, actual: GoldenRecord): string | null {
  const shared = Math.min(expected.checkpoints.length, actual.checkpoints.length);
  for (let index = 0; index < shared; index++) {
    if (expected.checkpoints[index] === actual.checkpoints[index]) continue;
    const to = (index + 1) * CHECKPOINT_INTERVAL;
    return (
      `first differing checkpoint #${index + 1} at step ${to} ` +
      `(expected ${expected.checkpoints[index]}, got ${actual.checkpoints[index]}); ` +
      `the decisions diverged within steps ${index * CHECKPOINT_INTERVAL + 1}-${to}`
    );
  }
  if (expected.checkpoints.length !== actual.checkpoints.length) {
    return (
      `checkpoint count differs (expected ${expected.checkpoints.length}, got ${actual.checkpoints.length}); ` +
      `all ${shared} shared checkpoints match, so the games diverged after step ${shared * CHECKPOINT_INTERVAL}`
    );
  }
  if (expected.hash !== actual.hash) {
    return (
      `hash differs (expected ${expected.hash}, got ${actual.hash}) although all ${shared} checkpoints match; ` +
      `the games diverged after step ${shared * CHECKPOINT_INTERVAL}`
    );
  }
  return null;
}

/** 回傳這一局所有不一致的地方；空陣列代表與 fixture 逐欄相同。 */
function compareGame(expected: GoldenRecord, outcome: GoldenOutcome): string[] {
  const problems: string[] = [];
  const { record: actual } = outcome;
  if (outcome.failure !== null) problems.push(`engine rejected a decision: ${outcome.failure}`);
  if (outcome.stalled) problems.push(`stalled after ${actual.steps} steps`);
  for (const field of SCALAR_FIELDS) {
    if (JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) {
      problems.push(`${field}: expected ${JSON.stringify(expected[field])}, got ${JSON.stringify(actual[field])}`);
    }
  }
  const divergence = describeDivergence(expected, actual);
  if (divergence) problems.push(divergence);
  return problems.map((problem) => `${expected.id}: ${problem}`);
}

function byGroup(games: readonly GoldenGame[]): Map<string, GoldenGame[]> {
  const groups = new Map<string, GoldenGame[]>();
  for (const game of games) groups.set(game.group, [...(groups.get(game.group) ?? []), game]);
  return groups;
}

describe('golden replay: base v0.4.0', () => {
  it('has one fixture record for every defined game, in the same order', () => {
    expect(GOLDEN_GAMES).toHaveLength(48);
    expect(fixture.map((record) => record.id)).toEqual(GOLDEN_GAMES.map((game) => game.id));
  });

  // 依人數（與局型）拆成多個 it，每個都有自己的 timeout。
  for (const [group, games] of byGroup(GOLDEN_GAMES)) {
    it(
      `replays ${group} (${games.length} ${games.length === 1 ? 'game' : 'games'}) command for command`,
      () => {
        const problems: string[] = [];
        for (const game of games) {
          const expected = fixture.find((record) => record.id === game.id);
          if (!expected) {
            problems.push(`${game.id}: missing from the fixture`);
            continue;
          }
          problems.push(...compareGame(expected, playGolden(game)));
        }
        expect(problems).toEqual([]);
      },
      GAME_TIMEOUT,
    );
  }
});
