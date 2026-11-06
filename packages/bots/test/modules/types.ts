/**
 * 模組測試工具的介面（策略 §4.6；PL-2）。
 *
 * 每個擴充模組在 `test/modules/<id>.ts` 匯出一個 `ModuleTestKit`，由 family 測試檔明列、
 * 經 `harness.ts` 的 `kits` 選項傳入；harness、B-FAIR、fuzz 都只經這個介面取得模組的
 * 守恆檢查、隱藏資訊擾動與狀態擾動，所以沒有模組時（`kits` 為空）行為與 base 完全相同。
 *
 * 這裡只放型別與一個挑選函式；組合邏輯（base 加上各模組）在 `harness.ts`。
 */

import type { GameEvent, GameState, ProfileDefinition, Rng } from '@catan/rules';
import type { BotCommand, BotLevel } from '../../src/types.ts';

/** `MechanicsTally.observe` 的輸入：一個被規則引擎接受的決策。 */
export interface MechanicsStep {
  readonly actor: string;
  /** 該座位的難度（Q2 要分別統計 standard 與 easy）。 */
  readonly level: BotLevel;
  readonly command: BotCommand;
  /** 指令來自策略，還是策略閒置時由保底代為送出（Q2 只算策略）。 */
  readonly source: 'policy' | 'fallback';
  /** 套用前的狀態；不得修改。 */
  readonly before: GameState;
  /** 套用後的狀態；不得修改。 */
  readonly after: GameState;
  /**
   * 這一步 `applyCommand` 回傳的 events。計數一律從這裡逐步累計，不要在終局讀
   * `state.log`：它只保留最後 200 筆（`packages/rules/src/engine.ts:123`、`:251`），
   * 長局會少算。
   */
  readonly events: readonly GameEvent[];
}

/** 一局的機制計數器；每局建立一個新的。 */
export interface MechanicsTally {
  observe(step: MechanicsStep): void;
  /** 目前的累計；鍵由模組自訂，harness 會加上 `<kit id>.` 前綴。 */
  snapshot(): Readonly<Record<string, number>>;
}

export interface ModuleTestKit {
  /** 與 rules module id 相同。 */
  readonly id: string;

  /**
   * 守恆檢查：除了 base 的資源守恆之外，模組自己的不變量（棋子上限、goods 守恆等）。
   * 回傳違反的描述，全部通過時回傳空陣列。harness 在每局結束時呼叫一次。
   */
  conservation?(state: GameState): readonly string[];

  /**
   * B-FAIR 擾動：就地修改 `variant`（已是深拷貝），只改動 `viewerId` 看不到的模組資訊，
   * 且不改變該座位的投影。有改動時回傳 true；沒有可以改的東西時回傳 false。
   */
  hideDifferently?(variant: GameState, viewerId: string): boolean;

  /**
   * fuzz 擾動：就地修改 `state`（已是深拷貝），隨機改動模組的狀態（船、海盜位置、待決 frame
   * 等）。必須維持引擎的不變量，也只能從 `rng` 取亂數，讓擾動可重現。
   */
  perturb?(state: GameState, rng: Rng): void;

  /**
   * 合約檢查：非行動者可以送出的模組指令。必須是 `botResponseCommands(profile)` 的子集；
   * harness 會對照兩者，漂移時回報。
   */
  readonly responseCommands?: readonly string[];

  /** Q2 計數器工廠；省略表示這個模組沒有要統計的機制。 */
  mechanics?(): MechanicsTally;
}

/** 這個 profile 用得到的 kit，依 `ruleModules` 的順序；`available` 裡沒有的 id 略過。 */
export function kitsOf(
  profile: Pick<ProfileDefinition, 'ruleModules'>,
  available: readonly ModuleTestKit[],
): readonly ModuleTestKit[] {
  const out: ModuleTestKit[] = [];
  for (const id of profile.ruleModules) {
    const kit = available.find((candidate) => candidate.id === id);
    if (kit) out.push(kit);
  }
  return out;
}
