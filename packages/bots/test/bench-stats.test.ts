/** bench 的閘門統計：561／562 勝的邊界例子要分得出通過與否，四捨五入後的勝率分不出來。 */

import { describe, expect, it } from 'vitest';
import { nonInferiority, wilson95LowerPct } from '../bench/stats.ts';

describe('wilson95LowerPct', () => {
  it('matches the spec values at the 3-player boundary (1,806 finished games)', () => {
    expect(wilson95LowerPct(561, 1806)).toBeCloseTo(29.301, 3);
    expect(wilson95LowerPct(562, 1806)).toBeCloseTo(29.356, 3);
  });

  it('is 0 without finished games and never negative', () => {
    expect(wilson95LowerPct(0, 0)).toBe(0);
    expect(wilson95LowerPct(0, 50)).toBe(0);
    expect(wilson95LowerPct(50, 50)).toBeGreaterThan(90);
  });

  it('rises with the win count and tightens with the sample size', () => {
    expect(wilson95LowerPct(60, 200)).toBeGreaterThan(wilson95LowerPct(59, 200));
    expect(wilson95LowerPct(600, 2000)).toBeGreaterThan(wilson95LowerPct(60, 200));
  });
});

describe('nonInferiority', () => {
  it('passes at 562/1806 and fails at 561/1806 for 3 players (threshold 33.333 − 4 = 29.333%)', () => {
    const fail = nonInferiority(561, 1806, 3);
    const pass = nonInferiority(562, 1806, 3);
    expect(fail.thresholdPct).toBeCloseTo(29.333, 3);
    expect(fail.pass).toBe(false);
    expect(pass.pass).toBe(true);
    // 兩者四捨五入到小數一位都是 31.1%：只看百分比分不出來。
    expect(((561 / 1806) * 100).toFixed(1)).toBe(((562 / 1806) * 100).toFixed(1));
  });

  it('uses the fair share 1/players as p0', () => {
    expect(nonInferiority(0, 0, 4).p0Pct).toBe(25);
    expect(nonInferiority(0, 0, 6).thresholdPct).toBeCloseTo(100 / 6 - 4, 10);
    expect(nonInferiority(0, 0, 5).pass).toBe(false);
  });

  it('requires a strictly greater lower bound', () => {
    expect(nonInferiority(100, 100, 3).pass).toBe(true);
    expect(nonInferiority(10, 100, 3).pass).toBe(false);
  });
});
