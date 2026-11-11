/**
 * `dedupeCandidates`（E-11）：鍵依內容遞迴正規化。物件的 key 順序不影響結果，陣列的順序有意義。
 */

import { describe, expect, it } from 'vitest';
import { dedupeCandidates } from '../src/heuristic.ts';
import type { BotCommand, Scored } from '../src/modules/types.ts';

const cmd = (value: Record<string, unknown>): BotCommand => value as unknown as BotCommand;

describe('dedupeCandidates', () => {
  it('完全相同的平面指令只留一個：分數取最高，位置取第一次出現的', () => {
    const out = dedupeCandidates([
      { item: { type: 'build.settlement', vertex: 3 }, score: 1 },
      { item: { type: 'build.city', vertex: 4 }, score: 5 },
      { item: { vertex: 3, type: 'build.settlement' }, score: 2 },
    ]);
    expect(out.map((entry) => [entry.item, entry.score])).toEqual([
      [{ type: 'build.settlement', vertex: 3 }, 2],
      [{ type: 'build.city', vertex: 4 }, 5],
    ]);
  });

  it('巢狀物件的 key 順序不同仍視為同一個指令', () => {
    const a = cmd({ type: 'progress.play', card: 'smithing', targets: { first: { vertex: 1, level: 2 }, second: 7 } });
    const b = cmd({ targets: { second: 7, first: { level: 2, vertex: 1 } }, card: 'smithing', type: 'progress.play' });
    const out = dedupeCandidates([
      { item: a, score: 0.4 },
      { item: b, score: 0.9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.item).toBe(a);
    expect(out[0]!.score).toBe(0.9);
  });

  it('陣列內的物件也遞迴正規化，但陣列順序不同是不同的指令', () => {
    const same = dedupeCandidates([
      { item: cmd({ type: 'x', steps: [{ a: 1, b: 2 }, { c: 3 }] }), score: 1 },
      { item: cmd({ type: 'x', steps: [{ b: 2, a: 1 }, { c: 3 }] }), score: 1 },
    ]);
    expect(same).toHaveLength(1);
    const reordered = dedupeCandidates([
      { item: cmd({ type: 'x', steps: [1, 2] }), score: 1 },
      { item: cmd({ type: 'x', steps: [2, 1] }), score: 1 },
    ]);
    expect(reordered).toHaveLength(2);
  });

  it('值不同、或有 null／缺欄位的差異不會被誤合併', () => {
    const candidates: Scored<BotCommand>[] = [
      { item: cmd({ type: 'x', target: null }), score: 1 },
      { item: cmd({ type: 'x' }), score: 1 },
      { item: cmd({ type: 'x', target: { vertex: 1 } }), score: 1 },
      { item: cmd({ type: 'x', target: { vertex: 2 } }), score: 1 },
    ];
    expect(dedupeCandidates(candidates)).toHaveLength(4);
  });
});
