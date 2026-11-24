import type { CitiesKnightsHints, CitiesKnightsView } from './modules/citiesKnights/index.ts';
import type { ExplorersPiratesHints, ExplorersPiratesView } from './modules/explorersPirates/index.ts';
import type { SeafarersHints, SeafarersView } from './modules/seafarers/index.ts';
import type { SeafarersCitiesKnightsHints, SeafarersCitiesKnightsView } from './modules/seafarersCitiesKnights/index.ts';
import type { TradersBarbariansHints, TradersBarbariansView } from './modules/tradersBarbarians/index.ts';

export * from './types.ts';
export * from './messages.ts';
export * from './pending.ts';
export * from './topology.ts';
export * from './topology-registry.ts';
export * from './rng.ts';
export * from './layout.ts';
export * from './layout-registry.ts';
export * from './official-56-board.ts';
export * from './sample-boards.ts';
export * from './seafarers-boards.ts';
export { EP_SCENARIOS, epScenario, type EpScenarioId, type EpMission, type EpRegion, type EpTile } from './explorers-pirates-boards.ts';
export type { ExplorersPiratesView, ExplorersPiratesHints } from './modules/explorersPirates/index.ts';
export type { SeafarersView, SeafarersHints, SeafarersGoldPendingView } from './modules/seafarers/index.ts';
export {
  COSTS as EP_COSTS,
  TRACK_VALUES as EP_TRACK_VALUES,
  EP_PIECES,
  COIN_SUPPLY as EP_COIN_SUPPLY,
  FISH_HAULS as EP_FISH_HAULS,
  START_GOLD as EP_START_GOLD,
  BASE_MP as EP_BASE_MP,
  EXTRA_MP as EP_EXTRA_MP,
  LAIR_TOKENS as EP_LAIR_TOKENS,
  TRACK_BONUS as EP_TRACK_BONUS,
} from './modules/explorersPirates/core.ts';
export { DISCOVERY_GOLD as EP_DISCOVERY_GOLD } from './modules/explorersPirates/explore.ts';
export { SWIFT_MAX as EP_SWIFT_MAX } from './modules/explorersPirates/movement.ts';
export { GOLD_BUYS_PER_TURN as EP_GOLD_BUYS_PER_TURN } from './modules/explorersPirates/economy.ts';
export { PIRATE_FRAME as EP_PIRATE_FRAME } from './modules/explorersPirates/pirate.ts';
export type { SetupStep as EpSetupStep } from './modules/explorersPirates/setup.ts';
export { CARGO_SIZE as EP_CARGO_SIZE, HOLD_CAPACITY as EP_HOLD_CAPACITY } from './modules/explorersPirates/state.ts';
export type { Cargo as EpCargo, SpiceAbility as EpSpiceAbility, EpSite } from './modules/explorersPirates/state.ts';
export { SHIP_COST } from './modules/seafarers/ships.ts';
export { GOLD_FRAME } from './modules/seafarers/gold.ts';
export { WONDERS, WONDER_IDS, WONDER_LEVELS } from './modules/seafarers/wonders.ts';
export { FT_VARIABLE_RESTRICTED, WC_VARIABLE_NO_RED } from './seafarers-scenario-boards.ts';
export type { WonderDef, WonderId, WonderCondition } from './modules/seafarers/wonders.ts';
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
// Traders & Barbarians：view／hints 型別、frame data 與規則常數（bots 0.4.4 用）。
export {
  TB_FRAME_KINDS,
  TB_PENDING_COMMANDS,
  TB_SCENARIO_PART_IDS,
  TB_VARIANT_PART_IDS,
  type TradersBarbariansView,
  type TradersBarbariansHints,
} from './modules/tradersBarbarians/index.ts';
export { TB as TRADERS_BARBARIANS, type TbBoardChoice } from './modules/tradersBarbarians/part.ts';
export {
  GOLD_SUPPLY,
  GOLD_PER_RESOURCE,
  GOLD_PER_SALE,
  PURCHASES_PER_TURN,
  type TbCoinsView,
  type TbCoinsHints,
} from './modules/tradersBarbarians/coins/index.ts';
export {
  FISH_COSTS,
  FISH_LIMIT,
  FISH_SUPPLY,
  type FishAction as TbFishAction,
  type FishValue as TbFishValue,
  type TbFishingView,
  type TbFishingHints,
} from './modules/tradersBarbarians/fishing/index.ts';
export {
  BRIDGE_COST,
  BRIDGE_GOLD,
  BRIDGES_PER_PLAYER,
  RIVER_BUILD_GOLD,
  WEALTHIEST_POINTS,
  POOR_POINTS,
  type TbRiversView,
  type TbRiversHints,
} from './modules/tradersBarbarians/rivers/index.ts';
export {
  WAGON_SUPPLY,
  BETWEEN_WAGONS_POINTS,
  type VoteData as TbVoteData,
  type TbTrainsView,
  type TbTrainsHints,
} from './modules/tradersBarbarians/trains/index.ts';
export {
  CARD_COST as BA_CARD_COST,
  BA_DECK,
  BARBARIAN_SUPPLY as BA_BARBARIAN_SUPPLY,
  KNIGHTS_PER_PLAYER as BA_KNIGHTS_PER_PLAYER,
  CONQUER_AT,
  KNIGHT_RANGE as BA_KNIGHT_RANGE,
  KNIGHT_BOOSTED_RANGE as BA_KNIGHT_BOOSTED_RANGE,
  TREASON_GOLD as BA_TREASON_GOLD,
  CONSOLATION_GOLD as BA_CONSOLATION_GOLD,
  type BaCard as TbBaCard,
  type TreasonData as TbTreasonData,
  type KnightsData as TbKnightsData,
  type TbBarbarianAttackView,
  type TbBarbarianAttackHints,
} from './modules/tradersBarbarians/barbarians/index.ts';
export {
  STARTING_GOLD as TRADERS_STARTING_GOLD,
  WAGON_LEVELS,
  UPGRADE_COSTS,
  FULL_UPGRADE_POINTS,
  BOOST_MP,
  type MoveData as TbMoveData,
  type TbTradersView,
  type TbTradersHints,
} from './modules/tradersBarbarians/traders/index.ts';
export {
  STRONGEST_PORTS_POINTS,
  MINIMUM as STRONGEST_PORTS_MINIMUM,
  type TbHarborsView,
} from './modules/tradersBarbarians/variants/harbors.ts';
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
  tradersBarbarians: TradersBarbariansView;
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
  tradersBarbarians: TradersBarbariansHints;
}
