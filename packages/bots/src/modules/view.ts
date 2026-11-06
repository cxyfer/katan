/**
 * 模組的 view 與 hints accessor（SF 計畫 §4.5）：型別取自 rules 匯出的 `ModuleViewMap` 與
 * `ModuleHintsMap`。rules 只新增型別與常數（P8），執行期的取值函式放在 bots。
 *
 * 只有 profile 啟用的模組才有項目，缺漏（或形狀不是物件）一律回 undefined，呼叫端要自行處理。
 */

import type { GameView, ModuleHintsMap, ModuleViewMap } from '@catan/rules';

function entryOf(record: Record<string, unknown> | undefined, id: string): unknown {
  if (!record || !Object.hasOwn(record, id)) return undefined;
  const value = record[id];
  return typeof value === 'object' && value !== null ? value : undefined;
}

/** `view.modules[id]`，型別依 `ModuleViewMap`。 */
export function moduleView<K extends keyof ModuleViewMap>(
  view: Pick<GameView, 'modules'>,
  id: K,
): ModuleViewMap[K] | undefined {
  return entryOf(view?.modules, id) as ModuleViewMap[K] | undefined;
}

/** `view.hints.modules[id]`，型別依 `ModuleHintsMap`；傳入 `view.hints`。 */
export function moduleHints<K extends keyof ModuleHintsMap>(
  hints: GameView['hints'],
  id: K,
): ModuleHintsMap[K] | undefined {
  return entryOf(hints?.modules, id) as ModuleHintsMap[K] | undefined;
}
