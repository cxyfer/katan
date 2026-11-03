/**
 * Built-in rules modules. Each expansion lives in its own directory and adds
 * exactly one entry here; see README.md for the hook contract.
 */

import { citiesKnightsModule } from './citiesKnights/index.ts';
import { explorersPiratesModule } from './explorersPirates/index.ts';
import { seafarersModule } from './seafarers/index.ts';
import { tradersBarbariansModule } from './tradersBarbarians/index.ts';
import type { RulesModule } from './types.ts';

export const BUILT_IN_MODULES: readonly RulesModule[] = [
  seafarersModule,
  citiesKnightsModule,
  tradersBarbariansModule,
  explorersPiratesModule,
];

