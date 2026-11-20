/**
 * Traders & Barbarians 的 ModuleTestKit（T&B 計畫 §3.2、§6.1–§6.2；S2）。
 *
 * kit 的 `id` 必須是 `tradersBarbarians`：`kitsOf` 依 `profile.ruleModules` 比對（`test/modules/types.ts`）。T&B 的
 * 八個 profile 共用這一個 rules module，所以 kit 依 `state.profileId` 啟用的 part（rules 順序，`tbPartIdsOf`）在內部
 * 組合 `test/modules/tb/*.ts` 的子 kit：
 *
 * - conservation：各 part 的不變量（§6.2），訊息前面加上 part id；資源守恆（含 Trains 投標中的牌）另見 `tbConservationProblems`；
 * - hideDifferently、perturb：依 part 順序套用（S2 的子 kit 都還沒有）；
 * - mechanics：每局為每個啟用 part 各建一個計數器，鍵加上 `<part id>.` 前綴（harness 再加 `tradersBarbarians.`）；
 * - responseCommands：rules 的 15 個 pending 指令。
 *
 * 不得 import `rules/test/*`：bench 會把 kit 打包進去，那些 helper 依賴 vitest。這裡只用 `@catan/rules` 的公開 API。
 */

import { getProfile, TB_PENDING_COMMANDS, TRADERS_BARBARIANS, type GameState, type Rng } from '@catan/rules';
import { tbPartIdsOf } from '../../src/modules/tradersBarbarians/view.ts';
import { barbarianAttackPartKit } from './tb/barbarianAttack.ts';
import { coinsPartKit } from './tb/coins.ts';
import { fishingPartKit } from './tb/fishing.ts';
import type { TbPartKit } from './tb/part.ts';
import { riversPartKit } from './tb/rivers.ts';
import { tradersPartKit } from './tb/traders.ts';
import { resourceSupplyProblems, trainsPartKit } from './tb/trains.ts';
import { friendlyRobberPartKit, harborsPartKit } from './tb/variants.ts';
import type { MechanicsTally, ModuleTestKit } from './types.ts';

/** part id → 子 kit。 */
export const TB_PART_KITS: ReadonlyMap<string, TbPartKit> = new Map(
  [
    coinsPartKit,
    fishingPartKit,
    riversPartKit,
    trainsPartKit,
    barbarianAttackPartKit,
    tradersPartKit,
    friendlyRobberPartKit,
    harborsPartKit,
  ].map((kit): [string, TbPartKit] => [kit.id, kit]),
);

/** 這一局啟用的子 kit，依 rules 的 part 順序；查不到 profile 時是空清單。 */
export function tbPartKitsOf(profileId: string): readonly TbPartKit[] {
  const profile = getProfile(profileId);
  if (!profile) return [];
  return tbPartIdsOf(profile).flatMap((id) => {
    const kit = TB_PART_KITS.get(id);
    return kit ? [kit] : [];
  });
}

function conservation(state: GameState): readonly string[] {
  return tbPartKitsOf(state.profileId).flatMap((kit) =>
    (kit.conservation?.(state) ?? []).map((problem) => `${kit.id}: ${problem}`),
  );
}

/**
 * T&B 對局的完整守恆：資源（算進投標中的牌，`resourceSupplyProblems`）加上各 part 的不變量。`test/tb-game.ts` 每 50 步與
 * 終局都用它檢查；harness 的 `RunResult.conservation` 的 base 資源守恆不算投標中的牌，T&B 的對局不讀它。
 */
export function tbConservationProblems(state: GameState): string[] {
  return [...resourceSupplyProblems(state), ...conservation(state)];
}

function hideDifferently(variant: GameState, viewerId: string): boolean {
  let changed = false;
  for (const kit of tbPartKitsOf(variant.profileId)) if (kit.hideDifferently?.(variant, viewerId)) changed = true;
  return changed;
}

function perturb(state: GameState, rng: Rng): void {
  for (const kit of tbPartKitsOf(state.profileId)) kit.perturb?.(state, rng);
}

/** 第一步才知道 profile：計數器延後到第一次 `observe` 時依 `before.profileId` 建立。 */
function mechanics(): MechanicsTally {
  let tallies: { id: string; tally: MechanicsTally }[] | null = null;
  return {
    observe(step) {
      tallies ??= tbPartKitsOf(step.before.profileId).flatMap((kit) =>
        kit.mechanics ? [{ id: kit.id, tally: kit.mechanics() }] : [],
      );
      for (const { tally } of tallies) tally.observe(step);
    },
    snapshot() {
      const out: Record<string, number> = {};
      for (const { id, tally } of tallies ?? []) {
        for (const [name, count] of Object.entries(tally.snapshot())) out[`${id}.${name}`] = count;
      }
      return out;
    },
  };
}

export const tradersBarbariansKit: ModuleTestKit = {
  id: TRADERS_BARBARIANS,
  conservation,
  hideDifferently,
  perturb,
  responseCommands: TB_PENDING_COMMANDS,
  mechanics,
};
