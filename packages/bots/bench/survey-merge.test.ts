/** survey 分片的驗證、合併與拉丁方陣局集：同一 shift 內的局號不能重複，不同 shift 之間可以；組態不同一律拒絕。 */

import { describe, expect, it } from 'vitest';
import {
  checkShards,
  cohortWarning,
  latinCohort,
  mergeShards,
  poolBalanceWarning,
  ShardMergeError,
  type LatinGame,
  type Shard,
  type ShardGame,
  type ShardMeta,
} from './survey-merge.ts';

const config = { profile: 'sf-new-shores-2025', players: 3, roles: 'standard', openings: '35/78,76/63,37/57' };

/** 一局的記錄：種子、座位記錄都齊全；`extra` 可覆寫或加欄位。 */
function record(game: number, extra: Record<string, unknown> = {}): ShardGame {
  return { game, seed: 10_000 + game, seats: [{}, {}, {}], ...extra } as ShardGame;
}

/** 分片：`from`、`games` 預設由局號決定（最小局號、記錄數），`meta` 可覆寫。 */
function shard(shift: number | undefined, games: readonly number[], meta: Partial<ShardMeta> = {}): Shard<ShardMeta, ShardGame> {
  return {
    meta: { ...config, from: games.length > 0 ? Math.min(...games) : 0, games: games.length, ...(shift === undefined ? {} : { shift }), ...meta },
    games: games.map((game) => record(game)),
  };
}

/** 拉丁方陣的分片：`failed` 是這個 shift 沒有終局（看門狗）的局號。 */
function latinShard(shift: number, games: readonly number[], failed: readonly number[] = [], meta: Partial<ShardMeta> = {}): Shard<ShardMeta, LatinGame> {
  return {
    meta: { ...config, from: games.length > 0 ? Math.min(...games) : 0, games: games.length, shift, ...meta },
    games: games.map((game) => ({ ...record(game), finished: !failed.includes(game) })),
  };
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, index) => from + index);

describe('mergeShards', () => {
  it('concatenates disjoint shards of one shift', () => {
    const merged = mergeShards([shard(1, [0, 1]), shard(1, [2, 3])]);
    expect(merged.games.map((game) => game.game)).toEqual([0, 1, 2, 3]);
    expect(merged.pooled).toBe(false);
    expect(merged.meta.shift).toBe(1);
  });

  it('pools shards of different shifts that share game indices, and drops the shift', () => {
    const merged = mergeShards([shard(0, [0, 1]), shard(1, [0, 1]), shard(2, [0, 1])]);
    expect(merged.games).toHaveLength(6);
    expect(merged.pooled).toBe(true);
    expect(merged.meta.shift).toBeUndefined();
  });

  it('rejects a repeated game inside one shift even when other shifts are present', () => {
    // 同一個 shift 的兩個分片都含第 1 局，另有一個不同 shift 的分片：第 1 局不能被算兩次。
    expect(() => mergeShards([shard(0, [0, 1]), shard(0, [1, 2]), shard(1, [0, 1, 2])])).toThrow(ShardMergeError);
    expect(() => mergeShards([shard(0, [0, 1]), shard(0, [1, 2]), shard(1, [0, 1, 2])])).toThrow(
      'shards overlap: game 1 appears twice in shift 0',
    );
  });

  it('merges unscripted shards and rejects overlapping ones', () => {
    const plain = (games: readonly number[]) => shard(undefined, games, { openings: undefined });
    expect(mergeShards([plain([0, 1]), plain([2, 3])]).games).toHaveLength(4);
    expect(() => mergeShards([plain([0, 1]), plain([1, 2])])).toThrow('shards overlap: game 1 appears twice');
  });

  it('rejects shards of different configs', () => {
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { roles: 'easy' })])).toThrow('cannot merge shards of different configs');
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { profile: 'sf-ck-new-shores-2025' })])).toThrow(ShardMergeError);
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { players: 4 })])).toThrow(ShardMergeError);
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { openings: '1/2,3/4,5/6' })])).toThrow(ShardMergeError);
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { scriptRoles: 'standard' })])).toThrow(ShardMergeError);
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { setupFrom: 'naive' })])).toThrow(ShardMergeError);
  });

  it('rejects scripted and unscripted shards together, and openings without a shift', () => {
    expect(() => mergeShards([shard(undefined, [0], { openings: undefined }), shard(0, [1])])).toThrow('cannot merge shards of different configs');
    expect(() => mergeShards([shard(undefined, [0])])).toThrow('has scripted openings but no shift');
    expect(() => mergeShards([shard(1, [0], { openings: undefined })])).toThrow('has a shift but no scripted openings');
  });

  it('rejects an empty list and an empty shard', () => {
    expect(() => mergeShards([])).toThrow('nothing to merge');
    expect(() => mergeShards([shard(0, [0]), shard(0, [])])).toThrow('is empty');
  });
});

describe('checkShards', () => {
  it('accepts the same game index in different shifts (latin squares share the seeds)', () => {
    expect(() => checkShards([shard(0, [0, 1, 2]), shard(1, [0, 1, 2]), shard(2, [0, 1, 2])])).not.toThrow();
  });

  it('rejects a repeated game within a shift', () => {
    expect(() => checkShards([shard(1, [5]), shard(1, [5])])).toThrow('in shift 1');
  });

  it('rejects a shard whose record count differs from its meta (truncated file)', () => {
    expect(() => checkShards([shard(0, [0, 1], { from: 0, games: 3 })])).toThrow('meta says 3');
    expect(() => checkShards([shard(0, [0, 1], { from: 0, games: 2 })])).not.toThrow();
  });

  it('rejects a game outside the declared range', () => {
    expect(() => checkShards([shard(0, [0, 5], { from: 0, games: 2 })])).toThrow('outside its declared range');
  });

  it('rejects a game whose seed is missing, not an integer, or not 10000 + game', () => {
    const withGame = (game: unknown): Shard<ShardMeta, ShardGame> => ({
      meta: { ...config, from: 3, games: 1, shift: 0 },
      games: [game as unknown as ShardGame],
    });
    const { seed: _omitted, ...noSeed } = record(3);
    expect(() => checkShards([withGame(noSeed)])).toThrow('needs an integer seed, got undefined');
    expect(() => checkShards([withGame(record(3, { seed: 10_003.5 }))])).toThrow('needs an integer seed');
    expect(() => checkShards([withGame(record(3, { seed: '10003' }))])).toThrow('needs an integer seed');
    expect(() => checkShards([withGame(record(3, { seed: null }))])).toThrow('needs an integer seed');
    expect(() => checkShards([withGame(record(3, { seed: 10_004 }))])).toThrow('seed 10004, expected 10003');
    expect(() => checkShards([withGame(record(3))])).not.toThrow();
  });

  it('rejects the same missing or wrong seed through merge and latin', () => {
    const { seed: _omitted, ...noSeed } = record(1);
    const broken = (shift: number): Shard<ShardMeta, LatinGame> => ({
      meta: { ...config, from: 0, games: 2, shift },
      games: [{ ...record(0), finished: true }, { ...noSeed, finished: true } as unknown as LatinGame],
    });
    expect(() => mergeShards([broken(0)])).toThrow('needs an integer seed');
    expect(() => latinCohort([broken(0), latinShard(1, range(0, 2)), latinShard(2, range(0, 2))])).toThrow('needs an integer seed');
    // 另一個 shift 的種子與局號不符：不能靠局號配對。
    const shifted = latinShard(1, range(0, 2));
    shifted.games = shifted.games.map((game) => ({ ...game, seed: game.seed + 1 }));
    expect(() => latinCohort([latinShard(0, range(0, 2)), shifted, latinShard(2, range(0, 2))])).toThrow('seed 10001, expected 10000');
  });

  it('rejects missing seat records and a missing or non-integer meta.from / meta.games', () => {
    const noSeats: Shard<ShardMeta, ShardGame> = { meta: { ...config, from: 3, games: 1, shift: 0 }, games: [{ game: 3, seed: 10_003 } as unknown as ShardGame] };
    expect(() => checkShards([noSeats])).toThrow('needs 3 seat records');
    const twoSeats: Shard<ShardMeta, ShardGame> = { meta: { ...config, from: 3, games: 1, shift: 0 }, games: [record(3, { seats: [{}, {}] })] };
    expect(() => checkShards([twoSeats])).toThrow('needs 3 seat records, got 2');
    expect(() => checkShards([shard(0, [0], { from: undefined } as unknown as Partial<ShardMeta>)])).toThrow('needs integer meta.from and meta.games');
    expect(() => checkShards([shard(0, [0], { games: undefined } as unknown as Partial<ShardMeta>)])).toThrow('needs integer meta.from and meta.games');
    expect(() => checkShards([shard(0, [0], { from: 0.5 })])).toThrow('needs integer meta.from and meta.games');
  });
});

describe('latinCohort', () => {
  it('keeps everything when the shifts are identical', () => {
    const ids = range(0, 5);
    const cohort = latinCohort([latinShard(0, ids), latinShard(1, ids), latinShard(2, ids)]);
    expect(cohort.ids).toEqual(ids);
    expect([...cohort.stats.values()].every((slot) => slot.dropped === 0)).toBe(true);
    expect(cohortWarning(cohort)).toBeNull();
    // 每個 shift 的局集與 ids 逐一對應。
    for (const shift of cohort.shifts) expect(cohort.byShift.get(shift)!.map((game) => game.game)).toEqual(ids);
  });

  it('uses the intersection when the shifts cover different game ranges', () => {
    // shift 0：0–5、shift 1：0–3、shift 2：2–6（另有一個分片補 7–8）；交集是 2–3。
    const cohort = latinCohort([latinShard(0, range(0, 6)), latinShard(1, range(0, 4)), latinShard(2, range(2, 7)), latinShard(2, [7, 8])]);
    expect(cohort.ids).toEqual([2, 3]);
    expect(cohort.stats.get(0)).toEqual({ games: 6, finished: 6, kept: 2, dropped: 4 });
    expect(cohort.stats.get(1)).toEqual({ games: 4, finished: 4, kept: 2, dropped: 2 });
    expect(cohort.stats.get(2)).toEqual({ games: 7, finished: 7, kept: 2, dropped: 5 });
    expect(cohortWarning(cohort)).toContain('kept 2 games');
    for (const shift of cohort.shifts) expect(cohort.byShift.get(shift)!.map((game) => game.game)).toEqual([2, 3]);
  });

  it('drops a game that did not finish in any one shift from every shift', () => {
    // 同一個範圍，但看門狗失敗的局不同：shift 0 的第 1 局、shift 2 的第 3 局沒有終局。
    const cohort = latinCohort([latinShard(0, range(0, 5), [1]), latinShard(1, range(0, 5)), latinShard(2, range(0, 5), [3])]);
    expect(cohort.ids).toEqual([0, 2, 4]);
    expect(cohort.stats.get(0)).toEqual({ games: 5, finished: 4, kept: 3, dropped: 2 });
    expect(cohort.stats.get(1)).toEqual({ games: 5, finished: 5, kept: 3, dropped: 2 });
    expect(cohort.stats.get(2)).toEqual({ games: 5, finished: 4, kept: 3, dropped: 2 });
    // 保留的局在每個 shift 都是終局。
    for (const shift of cohort.shifts) expect(cohort.byShift.get(shift)!.every((game) => game.finished)).toBe(true);
    expect(cohortWarning(cohort)).toContain('shift 1: 5 games, 5 finished, 2 dropped');
  });

  it('keeps the games when different failures leave the same cohort for every shift', () => {
    const cohort = latinCohort([latinShard(0, range(0, 4), [0]), latinShard(1, range(0, 4), [0]), latinShard(2, range(0, 4), [0])]);
    expect(cohort.ids).toEqual([1, 2, 3]);
  });

  it('rejects an empty cohort', () => {
    expect(() => latinCohort([latinShard(0, [0, 1]), latinShard(1, [2, 3]), latinShard(2, [4, 5])])).toThrow('no game is present and finished in every shift');
    expect(() => latinCohort([latinShard(0, [0], [0]), latinShard(1, [0]), latinShard(2, [0])])).toThrow('no game is present and finished in every shift');
  });

  it('rejects missing, repeated or out-of-range shifts', () => {
    const ids = range(0, 3);
    expect(() => latinCohort([latinShard(0, ids), latinShard(1, ids)])).toThrow('--latin needs one shift per 0..2, got 0,1');
    expect(() => latinCohort([latinShard(0, ids), latinShard(1, ids), latinShard(1, range(3, 6))])).toThrow('--latin needs one shift per 0..2, got 0,1');
    expect(() => latinCohort([latinShard(0, ids), latinShard(1, ids), latinShard(3, ids)])).toThrow('needs a scripted shift in 0..2, got 3');
    expect(() => latinCohort([latinShard(0, ids), latinShard(1, ids), latinShard(2, ids), latinShard(2, ids)])).toThrow('shards overlap');
  });

  it('rejects a shard without a shift and shards of different configs', () => {
    const ids = range(0, 3);
    const noShift: Shard<ShardMeta, LatinGame> = { meta: { ...config, from: 0, games: ids.length }, games: ids.map((game) => ({ ...record(game), finished: true })) };
    expect(() => latinCohort([noShift, latinShard(1, ids), latinShard(2, ids)])).toThrow('has scripted openings but no shift');
    expect(() => latinCohort([latinShard(0, ids), latinShard(1, ids, [], { roles: 'easy' }), latinShard(2, ids)])).toThrow('different configs');
    expect(() => latinCohort([latinShard(0, ids), latinShard(1, ids, [], { openings: '1/2,3/4,5/6' }), latinShard(2, ids)])).toThrow('different configs');
  });
});

describe('poolBalanceWarning', () => {
  it('is silent for a complete, equally sized pool and for a single shift', () => {
    const full = [0, 1, 2].map((shift) => latinShard(shift, range(0, 4)));
    expect(poolBalanceWarning(full)).toBeNull();
    expect(poolBalanceWarning([latinShard(1, range(0, 4)), latinShard(1, range(4, 8))])).toBeNull();
  });

  it('warns when a shift is missing or the shifts have different sizes', () => {
    expect(poolBalanceWarning([latinShard(0, range(0, 4)), latinShard(1, range(0, 4))])).toContain('missing shift 2');
    expect(poolBalanceWarning([latinShard(0, range(0, 4)), latinShard(1, range(0, 4)), latinShard(2, range(0, 3))])).toContain('shift 2: 3/3 finished');
    expect(poolBalanceWarning([latinShard(0, range(0, 4)), latinShard(1, range(0, 4), [1]), latinShard(2, range(0, 4))])).toContain('shift 1: 3/4 finished');
  });

  it('does not apply to unscripted shards', () => {
    expect(poolBalanceWarning([shard(undefined, [0, 1], { openings: undefined })])).toBeNull();
    expect(poolBalanceWarning([shard(undefined, [0, 1], { openings: undefined }), shard(undefined, [2, 3], { openings: undefined })])).toBeNull();
  });
});
