/** Coins（gold 買賣與估值）的策略（T&B 計畫 §4.2）。S2 只放 `id` 的 stub，策略由 S3 實作。 */

import type { TbPartBot } from './part.ts';
import { TB_PART_IDS } from './view.ts';

export const coinsBot: TbPartBot = {
  id: TB_PART_IDS.coins,
};
