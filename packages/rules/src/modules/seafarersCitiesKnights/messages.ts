/**
 * Seafarers + Cities & Knights combination-layer message ids. Every `emit(...)`
 * event type and `fail(...)` code in this module's sources must be listed
 * here, and nothing else (message-ids test).
 */

export const messages = {
  eventTypes: ['sfck.knightChasedPirate'] as const,
  errorCodes: ['E_PIRATE_INACTIVE', 'E_SHIP_PINNED_BY_KNIGHT'] as const,
};
