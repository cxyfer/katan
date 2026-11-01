/** Public surface of the rules-module system (see README.md). */

export { BUILT_IN_MODULES } from './builtins.ts';
export * from './types.ts';
export { MODULE_MESSAGES, type ModuleMessages } from './messages.ts';
export { registerRulesModule, rulesModulesOf, getRulesModule, moduleCommandTypes } from './registry.ts';
