/**
 * bench 的閘門統計（純函式，`test/bench-stats.test.ts` 鎖定）。
 * docs/aegis/specs/2026-11-22-hard-bot-v2.md §7：閘門判定讀原始勝場數與 Wilson 下界，不讀四捨五入的勝率。
 */

/** 單邊 95% 的標準常態分位數 `z(0.95)`。 */
export const Z_ONE_SIDED_95 = 1.6448536269514722;

/** 非劣性邊界 δ（百分點）。 */
export const NON_INFERIORITY_DELTA_PP = 4;

/** 勝率的單邊 95% Wilson 信賴區間下界，單位百分比；沒有完成的局時為 0。 */
export function wilson95LowerPct(wins: number, finished: number): number {
  if (finished <= 0) return 0;
  const n = finished;
  const p = wins / n;
  const z2 = Z_ONE_SIDED_95 * Z_ONE_SIDED_95;
  const centre = p + z2 / (2 * n);
  const margin = Z_ONE_SIDED_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return (Math.max(0, centre - margin) / (1 + z2 / n)) * 100;
}

export interface NonInferiority {
  /** 兩者一樣強時的真實勝率（公平份額），百分比。 */
  p0Pct: number;
  /** `p0 − δ`，百分比。 */
  thresholdPct: number;
  lowerPct: number;
  /** Wilson 下界嚴格大於 `p0 − δ`。 */
  pass: boolean;
}

/** 1 位新策略對其餘 `players − 1` 位基線的非劣性判定：下界 > `p0 − δ`（`p0 = 1/players`）。 */
export function nonInferiority(
  wins: number,
  finished: number,
  players: number,
  deltaPp: number = NON_INFERIORITY_DELTA_PP,
): NonInferiority {
  const p0Pct = 100 / players;
  const thresholdPct = p0Pct - deltaPp;
  const lowerPct = wilson95LowerPct(wins, finished);
  return { p0Pct, thresholdPct, lowerPct, pass: lowerPct > thresholdPct };
}
