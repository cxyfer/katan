/**
 * Seafarers + Cities & Knights 組合層的 hints accessor。
 *
 * 組合層的 hints 只有三個欄位（`pirateActive`、`pirateChase`、`bandit`）。保底路徑不得 throw，所以讀值一律
 * 驗證形狀：不是預期的值就當作沒有。
 *
 * TODO(SFCK-X 合併後)：改用 rules 匯出的 `SeafarersCitiesKnightsHints`、`SfckBandit`、
 * `SEAFARERS_CITIES_KNIGHTS` 與 `moduleHints(hints, SEAFARERS_CITIES_KNIGHTS)`；下面的本地型別與 accessor 刪除。
 */

import type { GameView } from '@catan/rules';

export const SEAFARERS_CITIES_KNIGHTS = 'seafarersCitiesKnights';

/** 現在可以移動哪一個：強盜、海盜或兩者皆可。 */
export type SfckBandit = 'robber' | 'pirate' | 'either';

export interface SeafarersCitiesKnightsHints {
  readonly pirateActive: boolean;
  readonly pirateChase: readonly number[];
  readonly bandit: SfckBandit | null;
}

/** 傳入 `view.hints`；缺漏或形狀不是物件時回 undefined。 */
export function sfckHints(hints: GameView['hints']): SeafarersCitiesKnightsHints | undefined {
  const modules = hints?.modules as Record<string, unknown> | undefined;
  if (!modules || !Object.hasOwn(modules, SEAFARERS_CITIES_KNIGHTS)) return undefined;
  const entry = modules[SEAFARERS_CITIES_KNIGHTS];
  return typeof entry === 'object' && entry !== null ? (entry as SeafarersCitiesKnightsHints) : undefined;
}

/** `bandit` hint；缺漏或不是三種值之一時回 null（等同首攻前、沒有等待移動盜賊的 frame）。 */
export function sfckBandit(hints: GameView['hints']): SfckBandit | null {
  const bandit = sfckHints(hints)?.bandit;
  return bandit === 'robber' || bandit === 'pirate' || bandit === 'either' ? bandit : null;
}
