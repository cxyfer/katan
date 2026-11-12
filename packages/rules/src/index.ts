import type { CitiesKnightsHints, CitiesKnightsView } from './modules/citiesKnights/index.ts';
import type { ExplorersPiratesHints, ExplorersPiratesView } from './modules/explorersPirates/index.ts';
import type { SeafarersHints, SeafarersView } from './modules/seafarers/index.ts';
import type { SeafarersCitiesKnightsHints, SeafarersCitiesKnightsView } from './modules/seafarersCitiesKnights/index.ts';

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
export { SHIP_COST } from './modules/seafarers/ships.ts';
export { GOLD_FRAME } from './modules/seafarers/gold.ts';
export type { CitiesKnightsView, CitiesKnightsHints } from './modules/citiesKnights/index.ts';
export {
  CITIES_KNIGHTS,
  TRACKS as CK_TRACKS,
  TRACK_COMMODITY as CK_TRACK_COMMODITY,
  MAX_LEVEL as CK_MAX_LEVEL,
  ABILITY_LEVEL as CK_ABILITY_LEVEL,
  METROPOLIS_LEVEL as CK_METROPOLIS_LEVEL,
  PERMANENT_METROPOLIS_LEVEL as CK_PERMANENT_METROPOLIS_LEVEL,
  drawThreshold as ckDrawThreshold,
  WALL_COST as CK_WALL_COST,
  KNIGHT_COST as CK_KNIGHT_COST,
  PROMOTE_COST as CK_PROMOTE_COST,
  ACTIVATE_COST as CK_ACTIVATE_COST,
  MAX_WALLS as CK_MAX_WALLS,
  WALL_HAND_BONUS as CK_WALL_HAND_BONUS,
  KNIGHTS_PER_LEVEL as CK_KNIGHTS_PER_LEVEL,
  BARBARIAN_TRACK_LENGTH as CK_BARBARIAN_TRACK_LENGTH,
  PROGRESS_HAND_LIMIT as CK_PROGRESS_HAND_LIMIT,
  EVENT_FACES as CK_EVENT_FACES,
  PROGRESS_DECKS as CK_PROGRESS_DECKS,
  VP_PROGRESS_CARDS as CK_VP_PROGRESS_CARDS,
  type Track as CkTrack,
  type KnightLevel as CkKnightLevel,
  type EventFace as CkEventFace,
} from './modules/citiesKnights/constants.ts';
export { MEDICINE_COST as CK_MEDICINE_COST, FIXED_DISCS as CK_FIXED_DISCS } from './modules/citiesKnights/cards-science.ts';
export type { ImprovementOption as CkImprovementOption } from './modules/citiesKnights/cities.ts';
export type { ProgressCardHint as CkProgressCardHint } from './modules/citiesKnights/cards.ts';
export type { BlockReason as CkBlockReason } from './modules/citiesKnights/card-common.ts';
// pending frame 的 kind 字串；frame data 的型別由 bots 自己宣告。
export { PILLAGE_FRAME as CK_PILLAGE_FRAME, DEFENDER_FRAME as CK_DEFENDER_FRAME } from './modules/citiesKnights/barbarians.ts';
export { DISPLACED_FRAME as CK_DISPLACED_FRAME } from './modules/citiesKnights/knights.ts';
export { PROGRESS_DISCARD_FRAME as CK_PROGRESS_DISCARD_FRAME } from './modules/citiesKnights/progress.ts';
export { SCIENCE_FRAME as CK_SCIENCE_FRAME } from './modules/citiesKnights/production.ts';
export { RESOLVE_ROLL_FRAME as CK_RESOLVE_ROLL_FRAME } from './modules/citiesKnights/dice.ts';
export {
  HARBOR_FRAME as CK_HARBOR_FRAME,
  GUILD_DUES_FRAME as CK_GUILD_DUES_FRAME,
  ESPIONAGE_FRAME as CK_ESPIONAGE_FRAME,
  SABOTAGE_FRAME as CK_SABOTAGE_FRAME,
  WEDDING_FRAME as CK_WEDDING_FRAME,
  TREASON_REMOVE_FRAME as CK_TREASON_REMOVE_FRAME,
  TREASON_PLACE_FRAME as CK_TREASON_PLACE_FRAME,
  DIPLOMACY_FRAME as CK_DIPLOMACY_FRAME,
} from './modules/citiesKnights/card-common.ts';
export type { SeafarersCitiesKnightsView, SeafarersCitiesKnightsHints, SfckBandit } from './modules/seafarersCitiesKnights/index.ts';
export { SEAFARERS_CITIES_KNIGHTS } from './modules/seafarersCitiesKnights/index.ts';
export * from './modules/index.ts';
export * from './analysis.ts';
export * from './profiles.ts';
export * from './engine.ts';
export * from './project.ts';
export * from './bank-view.ts';
export * from './stats.ts';

/**
 * Module id → the shape of its entry in `GameView.modules` (types only; other
 * modules are added as they need them). Only modules the profile enables have
 * an entry, so consumers should treat the map as `Partial`.
 */
export interface ModuleViewMap {
  seafarers: SeafarersView;
  explorersPirates: ExplorersPiratesView;
  citiesKnights: CitiesKnightsView;
  seafarersCitiesKnights: SeafarersCitiesKnightsView;
}

/**
 * Module id → the shape of its entry in `ActionHints.modules`. Only modules
 * the profile enables have an entry, so consumers should treat the map as
 * `Partial`.
 */
export interface ModuleHintsMap {
  seafarers: SeafarersHints;
  explorersPirates: ExplorersPiratesHints;
  citiesKnights: CitiesKnightsHints;
  seafarersCitiesKnights: SeafarersCitiesKnightsHints;
}
