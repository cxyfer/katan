/**
 * Rules-module registry. Built-in modules are registered at load; tests (and
 * only tests) may register fixture modules for fixture profiles.
 */

import type { ProfileDefinition } from '../profiles.ts';
import { BUILT_IN_MODULES } from './builtins.ts';
import type { RulesModule } from './types.ts';

let registry: Map<string, RulesModule> | null = null;

function modules(): Map<string, RulesModule> {
  // Built lazily: module files may import engine helpers that import this file.
  registry ??= new Map(BUILT_IN_MODULES.map((module) => [module.id, module]));
  return registry;
}

export function registerRulesModule(module: RulesModule): void {
  const known = modules();
  if (known.has(module.id)) throw new Error(`rules module already registered: ${module.id}`);
  known.set(module.id, module);
}

export function getRulesModule(id: string): RulesModule | undefined {
  return modules().get(id);
}

const EMPTY: readonly RulesModule[] = [];
const resolved = new WeakMap<ProfileDefinition, readonly RulesModule[]>();

/** The profile's modules in hook order. Base profiles have none. */
export function rulesModulesOf(profile: ProfileDefinition): readonly RulesModule[] {
  if (profile.ruleModules.length === 0) return EMPTY;
  const cached = resolved.get(profile);
  if (cached) return cached;
  const list = profile.ruleModules.map((id) => {
    const module = modules().get(id);
    if (!module) throw new Error(`profile ${profile.id} lists unknown rules module: ${id}`);
    return module;
  });
  resolved.set(profile, list);
  return list;
}

/** Every command type the profile's modules handle. */
export function moduleCommandTypes(profile: ProfileDefinition): string[] {
  return rulesModulesOf(profile).flatMap((module) => Object.keys(module.commands ?? {}));
}
