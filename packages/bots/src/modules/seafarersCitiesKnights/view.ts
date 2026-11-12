/**
 * Seafarers + Cities & Knights 組合層的 view 與 hints accessor。型別取自 rules 匯出的 `ModuleViewMap` 與
 * `ModuleHintsMap`（SFCK-X）；執行期的取值函式放在 bots。
 *
 * 保底路徑不得 throw，所以 `bandit` 一律驗證形狀：不是三種值之一就當作沒有。
 */

import {
  SEAFARERS_CITIES_KNIGHTS,
  type GameView,
  type SeafarersCitiesKnightsHints,
  type SeafarersCitiesKnightsView,
  type SfckBandit,
} from '@catan/rules';
import { moduleHints, moduleView } from '../view.ts';

export { SEAFARERS_CITIES_KNIGHTS };
export type { SeafarersCitiesKnightsHints, SeafarersCitiesKnightsView, SfckBandit };

export function sfckView(view: Pick<GameView, 'modules'>): SeafarersCitiesKnightsView | undefined {
  return moduleView(view, SEAFARERS_CITIES_KNIGHTS);
}

/** 傳入 `view.hints`；缺漏或形狀不是物件時回 undefined。 */
export function sfckHints(hints: GameView['hints']): SeafarersCitiesKnightsHints | undefined {
  return moduleHints(hints, SEAFARERS_CITIES_KNIGHTS);
}

/** `bandit` hint；缺漏或不是三種值之一時回 null（等同首攻前、沒有等待移動盜賊的 frame）。 */
export function sfckBandit(hints: GameView['hints']): SfckBandit | null {
  const bandit = sfckHints(hints)?.bandit;
  return bandit === 'robber' || bandit === 'pirate' || bandit === 'either' ? bandit : null;
}
