/**
 * 開啟網頁時的啟動進度。
 *
 * 第一步「下載遊戲程式」由 `index.html` 的靜態啟動畫面負責（React 尚未執行），
 * React 掛載時即視為完成；其餘步驟對應 `bootstrap()` 的各個請求，各自完成時更新。
 * 靜態畫面以同一組權重計算第一步的進度，兩段畫面的進度條因此能接續而不倒退。
 */

export const BOOT_STEPS = ['assets', 'config', 'session', 'profiles', 'games'] as const;
export type BootStepId = (typeof BOOT_STEPS)[number];
export type BootStepStatus = 'pending' | 'done' | 'failed' | 'skipped';
export type BootProgress = Readonly<Record<BootStepId, BootStepStatus>>;

/** 各步驟占整條進度的百分比；`assets` 的 40 與 `index.html` 內嵌腳本一致。 */
export const BOOT_WEIGHTS: Readonly<Record<BootStepId, number>> = {
  assets: 40,
  config: 15,
  session: 15,
  profiles: 15,
  games: 15,
};

export function initialBootProgress(): BootProgress {
  return { assets: 'done', config: 'pending', session: 'pending', profiles: 'pending', games: 'pending' };
}

/** 已結束（含失敗與略過）的步驟累計權重，0–100。 */
export function bootPercent(progress: BootProgress): number {
  return BOOT_STEPS.reduce((sum, step) => sum + (progress[step] === 'pending' ? 0 : BOOT_WEIGHTS[step]), 0);
}

/** 目前等待中的第一個步驟；全部結束時為 null。 */
export function activeBootStep(progress: BootProgress): BootStepId | null {
  return BOOT_STEPS.find((step) => progress[step] === 'pending') ?? null;
}
