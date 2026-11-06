import type { ExplorersPiratesHints, ExplorersPiratesView } from './modules/explorersPirates/index.ts';
import type { SeafarersHints, SeafarersView } from './modules/seafarers/index.ts';

export * from './types.ts';
export * from './messages.ts';
export * from './pending.ts';
export * from './topology.ts';
export * from './topology-registry.ts';
export * from './rng.ts';
export * from './layout.ts';
export * from './layout-registry.ts';
export * from './sample-boards.ts';
export * from './seafarers-boards.ts';
export { EP_SCENARIOS, epScenario, type EpScenarioId, type EpMission, type EpRegion, type EpTile } from './explorers-pirates-boards.ts';
export type { ExplorersPiratesView, ExplorersPiratesHints } from './modules/explorersPirates/index.ts';
export type { SeafarersView, SeafarersHints, SeafarersGoldPendingView } from './modules/seafarers/index.ts';
export { COSTS as EP_COSTS, TRACK_VALUES as EP_TRACK_VALUES, EP_PIECES } from './modules/explorersPirates/core.ts';
export type { Cargo as EpCargo, SpiceAbility as EpSpiceAbility, EpSite } from './modules/explorersPirates/state.ts';
export * from './modules/index.ts';
// Keep this after modules/index.ts: loading seafarers/index.ts before it enters the module import cycle at the wrong end (BUILT_IN_MODULES gets undefined entries).
export { SHIP_COST, GOLD_FRAME } from './modules/seafarers/index.ts';
export * from './analysis.ts';
export * from './profiles.ts';
export * from './engine.ts';
export * from './project.ts';
export * from './stats.ts';

/** Module id → the shape of its entry in `GameView.modules` (types only; other modules are added as they need them). */
export interface ModuleViewMap {
  seafarers: SeafarersView;
  explorersPirates: ExplorersPiratesView;
}

/** Module id → the shape of its entry in `ActionHints.modules`. */
export interface ModuleHintsMap {
  seafarers: SeafarersHints;
  explorersPirates: ExplorersPiratesHints;
}
