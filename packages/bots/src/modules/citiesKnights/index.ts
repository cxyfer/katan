/**
 * Cities & Knights 的 BotModule（C&K 計畫 §4）。CK-B1 註冊模組並接上保底、經濟鉤子、節奏與回應指令；
 * 策略鉤子（setup、actions、frame 偏好、plans）由 CK-B2 接上，各自改自己的檔案，不必再改這裡。
 *
 * 在 CK-G 放行之前 `supports` 回傳 false：`botsCanPlay` 仍然是 false，server 不會讓 Bot 入座 C&K 的桌子；
 * 組合骨架只看 registry，所以測試與 harness 照樣會用到這個模組。
 */

import type { BotModule } from '../types.ts';
import { cardActions } from './cards.ts';
import { interactiveCardActions } from './cards-interactive.ts';
import { defenseActions, guardedKnights } from './defense.ts';
import { citiesKnightsDuty } from './duty.ts';
import { citiesKnightsEconomy } from './economy.ts';
import { citiesKnightsAnswerFrame } from './frames.ts';
import { knightActions } from './knights.ts';
import { citiesKnightsPlanStep, citiesKnightsPlans } from './plans.ts';
import { citiesKnightsPreroll } from './preroll.ts';
import { citiesKnightsSetup } from './setup.ts';
import { tacticsActions } from './tactics.ts';
import { commodityTradeActions } from './trade.ts';
import { CITIES_KNIGHTS } from './view.ts';

/** Bot 能不能玩 C&K；CK-G 才改為 true。 */
export const CK_BOTS_RELEASED = false;

/**
 * C&K 的 13 個 pending 指令：與 rules 的 `pendingCommands` 一致（`test/ck-model.test.ts` 對照）。
 * 非行動者也可能在這些 frame 裡作答，所以全部列為回應型指令。
 */
export const CK_PENDING_COMMANDS: readonly string[] = [
  'knight.retreat',
  'barbarians.pillage',
  'barbarians.chooseDeck',
  'progress.discard',
  'science.take',
  'progress.harborAnswer',
  'progress.takeCards',
  'progress.takeProgress',
  'progress.sabotageDiscard',
  'progress.weddingGive',
  'progress.treasonRemove',
  'progress.treasonPlace',
  'progress.diplomacyRoad',
];

/**
 * 各指令的思考延遲（毫秒，C&K 計畫 §4.8）。`pending.moveRobber` 不列，沿用 base 的 1200；鍵不得與 base 或
 * Seafarers 重複（server 把它們攤平合併）。每個行動視窗的指令上限維持 40，不設 `maxCommandsPerWindow`。
 */
export const CK_PACING: Readonly<Record<string, number>> = {
  // 建造與騎士
  'build.wall': 900,
  'knight.recruit': 900,
  'city.improve': 900,
  'knight.promote': 900,
  'knight.activate': 700,
  // 移動
  'knight.move': 700,
  'knight.displace': 900,
  'knight.chaseRobber': 900,
  // 打牌
  'progress.play': 1100,
  'progress.harborOffer': 900,
  // frame 回應
  'barbarians.pillage': 1200,
  'science.take': 700,
  'progress.harborAnswer': 800,
  'knight.retreat': 900,
  'barbarians.chooseDeck': 900,
  'progress.discard': 900,
  'progress.takeCards': 900,
  'progress.takeProgress': 900,
  'progress.sabotageDiscard': 900,
  'progress.weddingGive': 900,
  'progress.treasonRemove': 900,
  'progress.treasonPlace': 900,
  'progress.diplomacyRoad': 900,
};

/** 「現在就該做」的行動：防守、進步卡、騎士、換匯；與 base 的立即建造同一份清單 pick（分數是勝利分當量）。 */
export const citiesKnightsActions: NonNullable<BotModule['actions']> = (turn) => [
  ...cardActions(turn),
  ...interactiveCardActions(turn),
  ...defenseActions(turn),
  ...knightActions(turn, guardedKnights(turn)),
  ...tacticsActions(turn),
  ...commodityTradeActions(turn),
];

export const citiesKnightsBotModule: BotModule = {
  id: CITIES_KNIGHTS,
  supports: () => CK_BOTS_RELEASED,
  duty: citiesKnightsDuty,
  answerFrame: citiesKnightsAnswerFrame,
  setup: citiesKnightsSetup,
  preroll: citiesKnightsPreroll,
  actions: citiesKnightsActions,
  planStep: citiesKnightsPlanStep,
  economy: { ...citiesKnightsEconomy, scoreExtras: citiesKnightsPlans },
  pacing: CK_PACING,
  responseCommands: CK_PENDING_COMMANDS,
};
