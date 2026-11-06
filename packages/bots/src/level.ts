/** 難度參數（規格 §6）；standard 完全決定，easy 從前幾名候選中隨機挑選。 */

import type { BotLevel } from './types.ts';

export interface LevelParams {
  /** 從前幾名候選中隨機挑選；1 代表永遠選最佳。 */
  readonly topK: number;
  /** 是否主動對全桌開價。 */
  readonly proposeOffers: boolean;
  /** 是否為了最大騎士團主動打騎士（否則只在強盜壓到自己時打）。 */
  readonly eagerKnights: boolean;
  /** 接受報價需要的最低效用增益。 */
  readonly acceptMargin: number;
  /** 壟斷至少預期拿到幾張才打。 */
  readonly monopolyMin: number;
}

export const LEVEL_PARAMS: Readonly<Record<BotLevel, LevelParams>> = {
  standard: { topK: 1, proposeOffers: true, eagerKnights: true, acceptMargin: 0.6, monopolyMin: 3 },
  easy: { topK: 3, proposeOffers: false, eagerKnights: false, acceptMargin: 1.6, monopolyMin: 4 },
};
