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
export function frameKind(step: string): `${string}.${string}` {
  return `${TB}.${step}`;
}

export function hasVariant(profile: ProfileDefinition, variant: string): boolean {
  return profile.variants.includes(variant);
}
