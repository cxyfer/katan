/** survey 分片的合併檢查：同一 shift 內的局號不能重複，不同 shift 之間可以；組態不同一律拒絕。 */

import { describe, expect, it } from 'vitest';
import { checkShards, mergeShards, ShardMergeError, type Shard, type ShardGame, type ShardMeta } from './survey-merge.ts';

const base: ShardMeta = { profile: 'sf-new-shores-2025', players: 3, roles: 'standard', openings: '35/78,76/63,37/57' };

function shard(shift: number | undefined, games: readonly number[], meta: Partial<ShardMeta> = {}): Shard<ShardMeta, ShardGame> {
  return {
    meta: { ...base, ...(shift === undefined ? {} : { shift }), ...meta },
    games: games.map((game) => ({ game })),
  };
}

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

  it('rejects overlapping unscripted shards', () => {
    expect(() => mergeShards([shard(undefined, [0, 1]), shard(undefined, [1, 2])])).toThrow('shards overlap: game 1 appears twice');
  });

  it('rejects shards of different configs', () => {
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { roles: 'easy' })])).toThrow('cannot merge shards of different configs');
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { profile: 'sf-ck-new-shores-2025' })])).toThrow(ShardMergeError);
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { players: 4 })])).toThrow(ShardMergeError);
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { openings: '1/2,3/4,5/6' })])).toThrow(ShardMergeError);
    expect(() => mergeShards([shard(0, [0]), shard(0, [1], { scriptRoles: 'standard' })])).toThrow(ShardMergeError);
  });

  it('rejects an empty list', () => {
    expect(() => mergeShards([])).toThrow('nothing to merge');
  });
});

describe('checkShards', () => {
  it('accepts the same game index in different shifts (latin squares share the seeds)', () => {
    expect(() => checkShards([shard(0, [0, 1, 2]), shard(1, [0, 1, 2]), shard(2, [0, 1, 2])])).not.toThrow();
  });

  it('rejects a repeated game within a shift', () => {
    expect(() => checkShards([shard(1, [5]), shard(1, [5])])).toThrow('in shift 1');
  });
});
