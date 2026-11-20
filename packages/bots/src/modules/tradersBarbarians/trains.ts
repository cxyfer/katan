/** Merchant Trains 的策略（T&B 計畫 §4.2）。S2 只放 `id` 的 stub，策略由 S5 實作。 */

import type { TbPartBot } from './part.ts';
import { TB_PART_IDS } from './view.ts';

export const trainsBot: TbPartBot = {
  id: TB_PART_IDS.trains,
};
