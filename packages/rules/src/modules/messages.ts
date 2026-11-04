/**
 * Per-module message lists, merged into `COMMAND_ERROR_CODES` and
 * `RULE_EVENT_TYPES` by `../messages.ts`. Each module edits only its own file.
 */

import { messages as citiesKnights } from './citiesKnights/messages.ts';
import { messages as explorersPirates } from './explorersPirates/messages.ts';
import { messages as seafarers } from './seafarers/messages.ts';
import { messages as seafarersCitiesKnights } from './seafarersCitiesKnights/messages.ts';
import { messages as tradersBarbarians } from './tradersBarbarians/messages.ts';

export interface ModuleMessages {
  readonly eventTypes: readonly string[];
  readonly errorCodes: readonly string[];
}

export const MODULE_MESSAGES = {
  seafarers,
  citiesKnights,
  tradersBarbarians,
  explorersPirates,
  seafarersCitiesKnights,
} as const satisfies Record<string, ModuleMessages>;
