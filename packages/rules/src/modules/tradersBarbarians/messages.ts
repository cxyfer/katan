/**
 * Traders & Barbarians message ids. Every `emit(...)` event type and `fail(...)` code in this
 * module's sources must be listed here, and nothing else (message-ids test).
 */

export const messages = {
  eventTypes: [
    // Harbors of Catan
    'tb.strongestPorts',
    // Fishing on Catan
    'tb.fishDrawn',
    'tb.bootDrawn',
    'tb.fishRefilled',
    'tb.fishSwapped',
    'tb.fishSwapDeclined',
    'tb.fishSpent',
    'tb.robberRemoved',
    'tb.fishStole',
    'tb.fishResource',
    'tb.fishRoad',
    'tb.fishDevCard',
    'tb.bootGiven',
    // Coins (Rivers, Barbarian Attack, Traders & Barbarians)
    'tb.goldGained',
    'tb.goldBought',
    'tb.goldSold',
    // Rivers of Catan
    'tb.bridgeBuilt',
  ] as const,
  errorCodes: [
    // Fishing on Catan
    'E_TB_FISH_NOT_HELD',
    'E_TB_FISH_SHORT',
    'E_TB_NO_ROBBER',
    'E_TB_BOOT_NOT_HELD',
    'E_TB_BOOT_TARGET',
    // Coins
    'E_TB_PURCHASE_LIMIT',
    'E_TB_GOLD_SHORT',
    'E_TB_GOLD_SUPPLY_EMPTY',
  ] as const,
};
