/**
 * 投影的銀行存量（§8.3、#137）：`view.bank` 每種只到 `BANK_VIEW_CAP`，低於上限是確切張數，
 * 等於上限表示「至少這麼多」。
 *
 * 實際送出的單一指令（銀行交易、豐收之年逐張領取、科學獎勵等）一次只拿一張，`view.bank > 0`
 * 就足以判斷是否合法。這裡只給「一回合內連續規劃好幾筆」的地方使用：把「至少」當成這種資源的
 * 全部張數（規則常數 `bankPerResource`），因此只有牌堆真的低於上限時才會受限；萬一實際張數
 * 介於上限與規劃所需之間，下一份投影會反映出來，Bot 再重新規劃，不會送出被拒絕的指令。
 */

import { BANK_VIEW_CAP, getProfile, RESOURCES, type GameView, type Resource } from '@catan/rules';

export function plannedBank(view: Pick<GameView, 'bank' | 'profileId'>): Record<Resource, number> {
  const full = getProfile(view.profileId)?.bankPerResource ?? BANK_VIEW_CAP;
  const out = {} as Record<Resource, number>;
  for (const resource of RESOURCES) {
    const shown = view.bank[resource] ?? 0;
    out[resource] = shown >= BANK_VIEW_CAP ? Math.max(shown, full) : shown;
  }
  return out;
}
