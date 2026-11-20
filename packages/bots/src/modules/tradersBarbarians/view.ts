/**
 * Traders & Barbarians 的 view 與 hints accessor（T&B 計畫 §3.2）。型別取自 rules 匯出的 `ModuleViewMap` 與
 * `ModuleHintsMap`（S0）；執行期的取值函式放在 bots。
 *
 * view 與 hints 都以 part id 為鍵，只有 profile 啟用的 part 才有項目（part 狀態未建立時是 null）。所有 accessor
 * 缺漏或形狀不對時回 undefined／空值，不 throw：保底路徑也會呼叫它們。
 */

import {
  getProfile,
  TB_SCENARIO_PART_IDS,
  TB_VARIANT_PART_IDS,
  TRADERS_BARBARIANS,
  type GameView,
  type ProfileDefinition,
  type TradersBarbariansHints,
  type TradersBarbariansView,
} from '@katan/rules';
import { moduleHints, moduleView } from '../view.ts';

export { TRADERS_BARBARIANS };

/** rules 的 part id（`TB/index.ts` 的 `SCENARIO_PARTS`、`VARIANT_PARTS`）。 */
export const TB_PART_IDS = {
  coins: 'tb-coins',
  fishing: 'tb-fishing',
  rivers: 'tb-rivers',
  trains: 'tb-merchant-trains',
  barbarianAttack: 'tb-barbarian-attack',
  traders: 'tb-traders-barbarians',
  friendlyRobber: 'friendly-robber',
  harbors: 'harbors',
} as const;

export type TbPartId = (typeof TB_PART_IDS)[keyof typeof TB_PART_IDS];

export function tbView(view: Pick<GameView, 'modules'>): TradersBarbariansView | undefined {
  return moduleView(view, TRADERS_BARBARIANS);
}

/** 傳入 `view.hints`。 */
export function tbHints(hints: GameView['hints']): TradersBarbariansHints | undefined {
  return moduleHints(hints, TRADERS_BARBARIANS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 某個 part 的 view；未啟用、狀態未建立或形狀不是物件時回 undefined。 */
export function tbPartView<K extends keyof TradersBarbariansView>(
  view: Pick<GameView, 'modules'>,
  part: K,
): NonNullable<TradersBarbariansView[K]> | undefined {
  const value = tbView(view)?.[part];
  return isRecord(value) ? (value as NonNullable<TradersBarbariansView[K]>) : undefined;
}

/** 某個 part 的 hints；未啟用或形狀不是物件時回 undefined。傳入 `view.hints`。 */
export function tbPartHints<K extends Exclude<keyof TradersBarbariansHints, 'targets' | 'board' | 'robberHexes'>>(
  hints: GameView['hints'],
  part: K,
): NonNullable<TradersBarbariansHints[K]> | undefined {
  const value = tbHints(hints)?.[part];
  return isRecord(value) ? (value as NonNullable<TradersBarbariansHints[K]>) : undefined;
}

/** 有限整數陣列；其他形狀回 null。 */
export function integers(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((entry) => Number.isInteger(entry)) ? (value as number[]) : null;
}

/** hints 根層的 `targets[key]`（各 part 合併後的盤面目標）；缺漏或形狀不對時回空陣列。 */
export function tbTargets(hints: GameView['hints'], key: string): readonly number[] {
  const targets = tbHints(hints)?.targets;
  if (!isRecord(targets) || !Object.hasOwn(targets, key)) return [];
  return integers(targets[key]) ?? [];
}

/** hints 根層的 `board.targets`（目前 frame 要的盤面選擇）；沒有選擇時回空陣列。 */
export function tbBoardTargets(hints: GameView['hints'], commandType?: string): readonly number[] {
  const board = tbHints(hints)?.board;
  if (!isRecord(board)) return [];
  if (commandType !== undefined && board.commandType !== commandType) return [];
  return integers(board.targets) ?? [];
}

/** hints 的 `robberHexes`（FR 縮減後的強盜合法格）；沒有 part 縮減時回 undefined。 */
export function tbRobberHexes(hints: GameView['hints']): readonly number[] | undefined {
  return integers(tbHints(hints)?.robberHexes) ?? undefined;
}

/** 玩家公開的 gold（`tb-coins` 的 view）；沒有 coins part 時是 0。 */
export function goldOf(view: Pick<GameView, 'modules'>, playerId: string): number {
  const gold = tbPartView(view, 'tb-coins')?.gold;
  const amount = isRecord(gold) ? gold[playerId] : undefined;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
}

/**
 * profile 啟用的 part id，順序同 rules 的 `activeParts`（劇本的 part 在前，接著是變體）。未知的劇本或變體略過，
 * 與 rules 相同；能不能玩由 `supports` 讀原始 id 另外判斷（§3.3）。
 */
export function tbPartIdsOf(profile: Pick<ProfileDefinition, 'scenario' | 'variants'>): readonly string[] {
  const out: string[] = [];
  if (profile.scenario) out.push(...(ownEntry(TB_SCENARIO_PART_IDS, profile.scenario) ?? []));
  for (const variant of profile.variants) out.push(...(ownEntry(TB_VARIANT_PART_IDS, variant) ?? []));
  return out;
}

/** 劇本或變體 → part id 的查表；`constructor` 這類原型鍵查不到（回 undefined）。 */
export function ownEntry(
  table: Readonly<Partial<Record<string, readonly string[]>>>,
  id: string,
): readonly string[] | undefined {
  return Object.hasOwn(table, id) ? table[id] : undefined;
}

/** `view.profileId` 的啟用 part；查不到 profile 時是空清單（不 throw）。 */
export function tbPartIdsOfView(view: Pick<GameView, 'profileId'>): readonly string[] {
  const profile = getProfile(view.profileId);
  return profile ? tbPartIdsOf(profile) : [];
}
