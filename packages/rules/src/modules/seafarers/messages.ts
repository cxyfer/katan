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
    'gold.required',
    'gold.chosen',
    'island.bonus',
  ] as const,
  errorCodes: [
    'E_SHIP_NOT_MOVABLE',
    'E_SHIP_ALREADY_MOVED',
    'E_SHIP_BUILT_THIS_TURN',
    'E_PIRATE_BLOCKS',
    'E_PIRATE_SAME_HEX',
  ] as const,
};
