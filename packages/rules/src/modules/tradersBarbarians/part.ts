/**
 * Traders & Barbarians is a box of independent variants and scenarios, not
 * one rule set. Each lives in its own part with the same hook shape as a
 * rules module; `index.ts` composes the parts a profile selects (its scenario
 * plus its variants) into the single `tradersBarbarians` rules module.
 */

import type { ProfileDefinition } from '../../profiles.ts';
import type { ModuleCommandHandler, RulesModule } from '../types.ts';

/** Module id shared by every part (state slot, frame owner). */
export const TB = 'tradersBarbarians';

export interface TbPart extends Omit<RulesModule, 'id' | 'commands' | 'pendingCommands'> {
  /** Variant or scenario id from the registry, or a shared part id. */
  readonly id: string;
  readonly commands?: Readonly<Record<string, ModuleCommandHandler>>;
  readonly pendingCommands?: readonly string[];
  /** Pending frame kinds this part owns (`tradersBarbarians.<step>`). */
  readonly frames?: readonly string[];
}

/** Frame kind owned by the T&B module. */
export function frameKind<S extends string>(step: S): `${typeof TB}.${S}` {
  return `${TB}.${step}`;
}

/** part 要玩家在盤面上做的選擇（發布為 hints 根層的 `board`）：要送的指令與可選的 hex／邊／交點。 */
export interface TbBoardChoice {
  kind: 'hex' | 'edge' | 'vertex';
  commandType: string;
  labelId: string;
  targets: number[];
  /** 接收目標索引的指令欄位；省略時依 `kind`。 */
  field?: string;
}

export function hasVariant(profile: ProfileDefinition, variant: string): boolean {
  return profile.variants.includes(variant);
}

/** The active frame when it is a rules-module frame (base frames have no responders). */
export function moduleFrame(state: { pending: unknown }): import('../../types.ts').ModulePending | null {
  const pending = state.pending as { module?: unknown } | null;
  return pending && typeof pending.module === 'string' ? (pending as import('../../types.ts').ModulePending) : null;
}
