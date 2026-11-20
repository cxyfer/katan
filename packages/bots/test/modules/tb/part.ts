/**
 * T&B 各 part 的測試子 kit（T&B 計畫 §6.2）。`test/modules/tradersBarbarians.ts` 依 profile 啟用的 part（rules 順序）
 * 組合它們，對外只有一個 id 為 `tradersBarbarians` 的 `ModuleTestKit`（`kitsOf` 依 `ruleModules` 比對）。
 *
 * S2 只放守恆檢查；B-FAIR 的 `hideDifferently`、fuzz 的 `perturb` 與 Q2 的 `mechanics` 由各 part 的切片（S3–S8）補上，
 * 欄位語意與 `ModuleTestKit` 的同名欄位相同。
 *
 * 不得 import `rules/test/*`：bench 會把 kit 打包進去，那些 helper 依賴 vitest。這裡只用 `@catan/rules` 的公開 API。
 * rules 的 part 狀態型別沒有匯出，各子 kit 只宣告自己會讀的欄位。
 */

import { moduleStateOf, TRADERS_BARBARIANS, type GameState, type Rng } from '@catan/rules';
import type { MechanicsTally } from '../types.ts';

export interface TbPartKit {
  /** rules 的 part id。 */
  readonly id: string;
  /** 這個 part 的不變量；回傳違反的描述。 */
  conservation?(state: GameState): readonly string[];
  hideDifferently?(variant: GameState, viewerId: string): boolean;
  perturb?(state: GameState, rng: Rng): void;
  mechanics?(): MechanicsTally;
}

/** 某個 part 的狀態；part 未啟用或尚未建立時回 undefined。 */
export function partStateOf<T>(state: GameState, part: string): T | undefined {
  return moduleStateOf<Record<string, unknown>>(state, TRADERS_BARBARIANS)?.[part] as T | undefined;
}

export const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
