/** Barbarian Attack 的策略（T&B 計畫 §4.2）。S2 只放 `id` 的 stub，策略由 S6 實作。 */

import type { TbPartBot } from './part.ts';
import { TB_PART_IDS } from './view.ts';

export const barbarianAttackBot: TbPartBot = {
  id: TB_PART_IDS.barbarianAttack,
};
