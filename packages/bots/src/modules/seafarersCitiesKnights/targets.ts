/**
 * 組合層的 `robberTargets`（SF+CK 計畫 §4.2）：依 hint `bandit` 收窄 fold 的集合。
 *
 * fold 的初值是「盜賊預設」：陸地非現位、海格非現位、海盜在場時再加 `null`。組合規則只有兩條 veto：
 * 追擊海盜之後只能移海盜、追擊強盜之後只能移強盜，所以這裡只收窄、不擴大。陸海判定與初值相同
 * （`terrain !== 'sea'` 是陸地）。
 *
 * 保底與策略共用這個函式：不得 throw、不得消耗亂數，只讀 view。
 */

import type { GameView } from '@catan/rules';
import type { BanditTarget, BotModule } from '../types.ts';
import { sfckBandit } from './view.ts';

type RobberTargets = NonNullable<BotModule['robberTargets']>;

function isSea(view: GameView, hex: number): boolean {
  return view.board.terrain[hex] === 'sea';
}

export const sfckRobberTargets: RobberTargets = (view, _selfId, targets) => {
  switch (sfckBandit(view.hints)) {
    // 追擊海盜：只留海格與外框（`null`）；陸地會被 rules 拒絕（E_ILLEGAL_TARGET，reason pirate）。
    case 'pirate':
      return targets.filter((hex: BanditTarget) => hex === null || isSea(view, hex));
    // 追擊強盜（或首攻前）：只留陸地；海格與 `null` 會被拒絕（reason robber）。
    case 'robber':
      return targets.filter((hex: BanditTarget) => hex !== null && !isSea(view, hex));
    // 首攻後擲出 7：兩者皆可；沒有 hint 時不收窄。
    default:
      return targets;
  }
};
