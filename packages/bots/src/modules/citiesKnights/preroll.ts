/**
 * C&K 的擲骰前候選：Alchemy（C&K 計畫 §4.1）。CK-B2 只建 stub，CK-C 實作；easy 不打 Alchemy（D-CK3）。
 * 擲骰本身交給保底義務（`turn.roll`）。
 */

import type { BotModule } from '../types.ts';

export const citiesKnightsPreroll: NonNullable<BotModule['preroll']> = () => [];
