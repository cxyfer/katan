/**
 * Seafarers + Cities & Knights messages: event/error ids from `@catan/rules`
 * `modules/seafarersCitiesKnights`, ship variants of C&K road events and the
 * UI strings of the combination layer. Both locales define the same keys
 * (catalog parity test). Rule texts are paraphrased.
 */

import type { ModuleCatalog } from './index.ts';

export const seafarersCitiesKnights: ModuleCatalog = {
  en: {
    // --- rule events ---------------------------------------------------------
    'event.sfck.knightChasedPirate': '{player}’s knight at intersection {vertex} chased the pirate {from}.',
    // Diplomacy on a ship (`ship: true`).
    'event.ck.roadRemoved.ship': '{player} removed {owner}’s open ship on edge {edge}.',
    'event.ck.diplomacyRoadBuilt.ship': '{player} placed the ship again on edge {edge} for free.',
    // --- errors --------------------------------------------------------------
    'error.E_PIRATE_INACTIVE': 'The pirate is not in play until the first barbarian attack.',
    // --- UI ------------------------------------------------------------------
    'sfck.action.chasePirate': 'Chase the pirate',
    'sfck.bandit.robber': 'Your knight chases the robber: move it to another land hex.',
    'sfck.bandit.pirate': 'Your knight chases the pirate: move it to another sea hex or off the board.',
    'sfck.pirate.atHex': 'from sea hex {hex}',
    'sfck.panel.pirateActive': 'the pirate is in play',
    'sfck.panel.pirateWaiting': 'the pirate waits for the first attack',
  },
  'zh-Hant': {
    // --- rule events ---------------------------------------------------------
    'event.sfck.knightChasedPirate': '{player} 位於交點 {vertex} 的騎士把海盜趕走（{from}）。',
    'event.ck.roadRemoved.ship': '{player} 拆除了 {owner} 在邊 {edge} 的開放船隻。',
    'event.ck.diplomacyRoadBuilt.ship': '{player} 免費在邊 {edge} 重新放置了船隻。',
    // --- errors --------------------------------------------------------------
    'error.E_PIRATE_INACTIVE': '第一次蠻族來襲前海盜尚未登場。',
    // --- UI ------------------------------------------------------------------
    'sfck.action.chasePirate': '驅趕海盜',
    'sfck.bandit.robber': '你的騎士驅趕強盜：把強盜移到另一個陸地格。',
    'sfck.bandit.pirate': '你的騎士驅趕海盜：把海盜移到另一個海洋格，或移出版圖。',
    'sfck.pirate.atHex': '原在海洋格 {hex}',
    'sfck.panel.pirateActive': '海盜已登場',
    'sfck.panel.pirateWaiting': '海盜要等第一次蠻族來襲後才登場',
  },
};
