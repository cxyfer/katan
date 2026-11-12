/**
 * Seafarers + Cities & Knights 組合層的 BotModule（SF+CK 計畫 §4.1）。排在 `ruleModules` 的第一位
 * （`seafarersCitiesKnights`、`seafarers`、`citiesKnights`），所以它的 `robberTargets` 最先收到 fold 的初值。
 *
 * SFCK-1 只註冊模組並接上 `robberTargets` 與節奏：frame 全部屬於 base、SF 或 C&K，所以沒有 `duty`、
 * `answerFrame`、`economy`，也沒有回應指令（這幾項之後也不會有）。策略鉤子（`actions`＝追擊海盜、`setup`＝
 * 開局分數合成、`rescore`＝騎士位置的罰分）由 SFCK-2 在這個檔案掛上，實作放在 `chase.ts`、`setup.ts`、
 * `rescore.ts`。
 *
 * `supports` 在 SFCK-G 之前回傳 false：`botsCanPlay` 仍擋下兩個組合 profile，模組本身已可被 `botModulesOf`
 * 取得，測試因此能以真實的模組組合驅動保底與策略。
 */

import type { BotModule } from '../types.ts';
import { sfckRobberTargets } from './targets.ts';
import { SEAFARERS_CITIES_KNIGHTS } from './view.ts';

/** Bot 能不能玩 SF+CK；SFCK-G 才改為 true，座位開放與否仍以 `botsCanPlay(profile)` 為準。 */
export const SFCK_BOTS_RELEASED = false;

/**
 * 各指令的思考延遲（毫秒，SF+CK 計畫 §4.7）：與 C&K 的 `knight.chaseRobber` 相同；之後的
 * `pending.moveRobber` 沿用 base 的 1200。鍵不得與 base、SF 或 C&K 重複（server 把它們攤平合併）。
 */
export const SFCK_PACING: Readonly<Record<string, number>> = {
  'knight.chasePirate': 900,
};

export const seafarersCitiesKnightsBotModule: BotModule = {
  id: SEAFARERS_CITIES_KNIGHTS,
  supports: () => SFCK_BOTS_RELEASED,
  robberTargets: sfckRobberTargets,
  pacing: SFCK_PACING,
};
