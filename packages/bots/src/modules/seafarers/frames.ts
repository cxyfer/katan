/**
 * Seafarers 的 frame 作答（SF 計畫 §4.2，`seafarers.gold`）。
 *
 * - 只處理 gold frame；其他 frame 回 undefined（不歸 SF 管，交給下一個模組與保底）。
 * - gold 是依序作答的 frame，骨架只以 `responders.includes(self)` 過濾，所以這裡自己檢查
 *   `responders[0] === self`：輪不到自己時回 null（歸我管、這次沒有動作），不是 undefined；
 *   兩者在骨架都會落到保底，而保底同樣只讓 `responders[0]` 作答，所以結果相同，null 只是更準確。
 * - 張數取自 `hints.modules.seafarers.goldRequired`（已是 `min(欠額, 銀行總數)`）；缺漏時回 null，
 *   由保底處理，不自行猜測欠額。
 * - 每張牌用 `plentyPick`（豐收之年的挑選）：先補計畫的下一步，再補整個計畫，所以計畫成本含船
 *   （SF-2a 的 `economy.costs`）時，金礦會優先補船的缺口。每挑一張就更新手牌與銀行，
 *   因此缺口隨之縮小，而且任何資源都不超過 `goldBank`（否則 E_BANK_EMPTY）。
 * - easy 同 standard：挑選是決定性的，不消耗亂數。
 */

import { GOLD_FRAME, RESOURCES, type Resource } from '@catan/rules';
import { plentyPick } from '../../base/cards.ts';
import type { Hand } from '../../economy.ts';
import type { BotModule } from '../types.ts';
import { moduleHints } from '../view.ts';

export const seafarersAnswerFrame: NonNullable<BotModule['answerFrame']> = (turn, frame) => {
  if (frame.kind !== GOLD_FRAME) return undefined;
  if (frame.responders[0] !== turn.ctx.selfId) return null;
  const hints = moduleHints(turn.view.hints, 'seafarers');
  const required = hints?.goldRequired;
  if (typeof required !== 'number' || !Number.isInteger(required) || required < 0) return null;
  const hand: Hand = { ...turn.economy.hand };
  // `view.bank` 只到 `BANK_VIEW_CAP`（#137），金礦卻可能要拿更多同種的牌：存量取自只給作答者的
  // `goldBank`（每種 `min(存量, goldRequired)`，對這次挑選而言是確切的）。
  const bank: Record<Resource, number> = { ...(hints?.goldBank ?? turn.view.bank) };
  const resources: Resource[] = [];
  while (resources.length < required) {
    const pick = plentyPick(turn, hand, bank);
    // 銀行已無牌可拿：湊不滿就不送一個必定被拒絕的指令，交給保底。
    if (pick === null) return null;
    resources.push(pick);
    hand[pick] += 1;
    bank[pick] -= 1;
  }
  // 張數的多寡才有意義，順序沒有：依 RESOURCES 排成固定的樣子，與保底的指令同形。
  resources.sort((a, b) => RESOURCES.indexOf(a) - RESOURCES.indexOf(b));
  return { type: 'gold.choose', resources };
};
