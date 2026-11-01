/**
 * Per-module message catalogs, merged over the base catalogs by
 * `../catalogs.ts`. Each rules module edits only its own file, so parallel
 * expansion branches do not collide in `en.ts` / `zh-Hant.ts`. A module key
 * may not redefine a base key (catalog test).
 */

import type { Locale } from '@catan/protocol';
import { citiesKnights } from './citiesKnights.ts';
import { explorersPirates } from './explorersPirates.ts';
import { seafarers } from './seafarers.ts';
import { tradersBarbarians } from './tradersBarbarians.ts';

export type ModuleCatalog = Readonly<Record<Locale, Readonly<Record<string, string>>>>;

export const MODULE_CATALOGS: Readonly<Record<string, ModuleCatalog>> = {
  seafarers,
  citiesKnights,
  tradersBarbarians,
  explorersPirates,
};
