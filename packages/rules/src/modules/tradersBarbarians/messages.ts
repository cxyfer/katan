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
  ] as const,
  errorCodes: [
    // Fishing on Catan
    'E_TB_FISH_NOT_HELD',
    'E_TB_FISH_SHORT',
    'E_TB_NO_ROBBER',
    'E_TB_BOOT_NOT_HELD',
    'E_TB_BOOT_TARGET',
  ] as const,
};
