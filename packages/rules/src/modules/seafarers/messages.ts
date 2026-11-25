/**
 * Seafarers message ids. Every `emit(...)` event type and `fail(...)` code in this
 * module's sources must be listed here, and nothing else (message-ids test).
 */

export const messages = {
  eventTypes: [
    'ship.built',
    'ship.moved',
    'setup.ship',
    'pirate.moved',
    'pirate.cruised',
    'pirate.attacked',
    'pirate.gifted',
    'seven.stole',
    'seven.stealSkipped',
    'gold.required',
    'gold.chosen',
    'island.bonus',
    'fog.revealed',
    'tribe.gift',
    'harbor.placed',
    'cloth.trade',
    'cloth.produced',
    'cloth.stolen',
    'cloth.robberChosen',
    'world.harborDrawn',
    'world.harborPlaced',
    'world.harborsSkipped',
    'world.regenerated',
    'wonder.chosen',
    'wonder.built',
  ] as const,
  errorCodes: [
    'E_SHIP_NOT_MOVABLE',
    'E_SHIP_ALREADY_MOVED',
    'E_SHIP_BUILT_THIS_TURN',
    'E_PIRATE_BLOCKS',
    'E_PIRATE_SAME_HEX',
    'E_PIRATE_NEEDS_TRIBE',
    'E_WONDER_HELD',
    'E_WONDER_TAKEN',
    'E_WONDER_REQUIREMENT',
    'E_WONDER_NOT_CHOSEN',
    'E_WONDER_COMPLETE',
    'E_SHIP_LINE',
    'E_LINE_WALLED',
  ] as const,
};
