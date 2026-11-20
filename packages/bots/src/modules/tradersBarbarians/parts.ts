/**
 * T&B 的 part 表與開放清單（T&B 計畫 §3.2、§3.3）。
 *
 * `TB_READY_PARTS` 決定哪些 part 的策略已經可以上桌：profile 的每個 part 都在清單裡，`supports` 才回 true。S2 是
 * 空集合；S9 起放入全部 8 個 part，8 個 T&B profile 都可以讓 Bot 入座（easy、standard；hard 仍只有基本版）。
 * 替代方案（§5）時只放入已通過閘門的 part。
 */

import { TB_SCENARIO_PART_IDS, TB_VARIANT_PART_IDS, type ProfileDefinition } from '@catan/rules';
import { barbarianAttackBot } from './barbarianAttack.ts';
import { coinsBot } from './coins.ts';
import { fishingBot } from './fishing.ts';
import type { TbPartBot } from './part.ts';
import { riversBot } from './rivers.ts';
import { tradersBot } from './traders.ts';
import { trainsBot } from './trains.ts';
import { friendlyRobberBot, harborsBot } from './variants.ts';
import { ownEntry, tbPartIdsOf } from './view.ts';

/** 已開放給 Bot 的 part id（S9）。 */
export const TB_READY_PARTS: ReadonlySet<string> = new Set<string>([
  'tb-coins',
  'tb-rivers',
  'tb-fishing',
  'tb-merchant-trains',
  'tb-barbarian-attack',
  'tb-traders-barbarians',
  'friendly-robber',
  'harbors',
]);

/** part id → 策略。用 Map：`{}['constructor']` 這類原型鍵不會被當成 part。 */
export const TB_PART_BOTS: ReadonlyMap<string, TbPartBot> = new Map(
  [coinsBot, fishingBot, riversBot, trainsBot, barbarianAttackBot, tradersBot, friendlyRobberBot, harborsBot].map(
    (part): [string, TbPartBot] => [part.id, part],
  ),
);

/** profile 啟用的 part 策略，依 rules 順序；沒有策略的 part 略過。 */
export function tbPartsOf(
  profile: Pick<ProfileDefinition, 'scenario' | 'variants'>,
  table: ReadonlyMap<string, TbPartBot> = TB_PART_BOTS,
): readonly TbPartBot[] {
  const out: TbPartBot[] = [];
  for (const id of tbPartIdsOf(profile)) {
    const part = table.get(id);
    if (part) out.push(part);
  }
  return out;
}

/**
 * Bot 能不能玩這個 profile（§3.3）：讀原始的 `scenario` 與 `variants`，不能用 rules 的 `activeParts`，它會丟掉未知的
 * 變體（`TB/index.ts:50-53`），event-cards 會因此被放行。未知的劇本或變體（`event-cards`）、沒有任何 part，或有 part
 * 不在 `ready` 裡，都回 false。`ready` 預設 `TB_READY_PARTS`；測試注入別的集合，不改常數。
 */
export function tbSupports(
  profile: Pick<ProfileDefinition, 'scenario' | 'variants'>,
  ready: ReadonlySet<string> = TB_READY_PARTS,
): boolean {
  const ids: string[] = [];
  if (profile.scenario) {
    const scenario = ownEntry(TB_SCENARIO_PART_IDS, profile.scenario);
    if (scenario === undefined) return false;
    ids.push(...scenario);
  }
  for (const variant of profile.variants) {
    const parts = ownEntry(TB_VARIANT_PART_IDS, variant);
    if (parts === undefined) return false;
    ids.push(...parts);
  }
  return ids.length > 0 && ids.every((id) => ready.has(id));
}
