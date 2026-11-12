/**
 * 組合層的開局放置（SF+CK 計畫 §4.4、D5）。SF 的 `setup` 回答每一輪的 setup building，C&K 的只回答第 2 輪，
 * 依 `ruleModules` 順序 SF 先於 C&K，所以 C&K 的第 2 輪城市評分永遠不會被問到：組合層排在最前面，攔截 building 階段，
 * 依輪次合成部件的評分（純函式，不另設鉤子）：
 *
 * - 第 1 輪（聚落）：`setupSpotScore`（base）＋ `islandSetupBonus`（SF），與 SF 單獨時完全相同。
 * - 第 2 輪（城市，起始資源每格一張）：`citySetupScore`（C&K）＋ `islandSetupBonus`，並且複製
 *   `citiesKnightsSetup` 的硬篩選：有相鄰 ore 或 grain 的合法點時只在它們之中選，一個都沒有才用全部。
 *   **不把 `setupSpotScore` 與 `citySetupScore` 相加**：兩者都含產能與缺資源的加成，相加會重複計算。
 * - road 階段回 undefined：放路或放船由 SF 決定。
 *
 * 合法性一律取自 `hints.legalSettlements`（只列主島）。easy 同 standard，由 `turn.pick` 的 topK 3 挑選（與 SF、C&K 的
 * easy 相同）。決定性（P4）：不讀事件，不額外消耗亂數（挑選只經 `turn.pick`）。
 */

import { setupSpotScore } from '../../base/setup.ts';
import { playerYield } from '../../board.ts';
import { citySetupScore, touchesOreOrGrain } from '../citiesKnights/setup.ts';
import { islandSetupBonus } from '../seafarers/setup.ts';
import type { BotModule } from '../types.ts';

export const sfckSetup: NonNullable<BotModule['setup']> = (turn) => {
  const setup = turn.view.turn.setup;
  if (setup?.stage !== 'building') return undefined;
  const { model } = turn;
  const legal = turn.view.hints?.legalSettlements ?? [];
  if (setup.round === 2) {
    const mine = playerYield(model, turn.ctx.selfId, true);
    const fitting = legal.filter((candidate) => touchesOreOrGrain(model, candidate));
    const pool = fitting.length > 0 ? fitting : legal;
    const vertex = turn.pick(pool.map((item) => ({ item, score: citySetupScore(model, item, mine) + islandSetupBonus(turn, item) })));
    return vertex === null ? null : { type: 'setup.placeBuilding', vertex };
  }
  const vertex = turn.pick(legal.map((item) => ({ item, score: setupSpotScore(turn, item) + islandSetupBonus(turn, item) })));
  return vertex === null ? null : { type: 'setup.placeBuilding', vertex };
};
