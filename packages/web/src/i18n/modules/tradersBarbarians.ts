/**
 * Traders & Barbarians messages: event/error ids from `@catan/rules` `modules/tradersBarbarians`,
 * `play.pending.tradersBarbarians.<step>` prompts and any UI strings the module adds.
 * Both locales must define the same keys (catalog parity test). Rule texts are
 * paraphrases, never the rulebook's wording.
 */

import type { ModuleCatalog } from './index.ts';

const en: Record<string, string> = {
  // Registry vocabulary
  'profile.tb-friendly-robber-2025': 'Traders & Barbarians — The Friendly Robber, 3–4 players',
  'profile.tb-harbors-2025': 'Traders & Barbarians — Harbors of Catan, 3–4 players',
  'profile.tb-friendly-robber-harbors-2025': 'Traders & Barbarians — Friendly Robber + Harbors, 3–4 players',
  'profile.tb-event-cards-2025': 'Traders & Barbarians — Event Cards, 3–4 players',
  'profile.tb-event-cards-friendly-robber-2025': 'Traders & Barbarians — Event Cards + Friendly Robber, 3–4 players',
  'profile.tb-event-cards-harbors-2025': 'Traders & Barbarians — Event Cards + Harbors, 3–4 players',
  'profile.tb-event-cards-friendly-robber-harbors-2025': 'Traders & Barbarians — Event Cards + Friendly Robber + Harbors, 3–4 players',
  'profile.unavailable.tbEventDeck': 'The event deck’s card list is not in the 2025 rulebook, so event-card games are not enabled.',
  'scenario.tb-fishing': 'Fishing on Catan',
  'scenario.tb-rivers': 'Rivers of Catan',
  'scenario.tb-merchant-trains': 'Merchant Trains',
  'scenario.tb-barbarian-attack': 'Barbarian Attack',
  'scenario.tb-traders-barbarians': 'Traders & Barbarians',
  'variant.friendly-robber': 'The Friendly Robber',
  'variant.harbors': 'Harbors of Catan',
  'variant.event-cards': 'Event Cards',

  // Shared terms
  'tb.nobody': 'nobody',

  // Events
  'event.tb.strongestPorts': '{player} now holds Strongest Ports ({points} VP on ports).',

  // Panels and help
  'tb.harbors.title': 'Strongest Ports',
  'tb.harbors.holder': 'Holder: {player}',
  'tb.harbors.none': 'Not claimed yet — first to 3 VP in port buildings',
  'tb.harbors.points': '{player}: {points} VP on ports',
  'tb.help.friendly-robber': 'The robber may not visit a hex next to a player with only 2 VP. If no hex qualifies it returns to the desert and robs only players above 2 VP.',
  'tb.help.harbors': 'The first player with 3 VP in buildings on harbours takes Strongest Ports (2 VP); a player with more takes it over. You need 11 VP to win.',
  'tb.help.event-cards': 'Each turn reveals an event card instead of rolling: its event happens first, then its number produces.',
};

const zhHant: Record<string, string> = {
  'profile.tb-friendly-robber-2025': '商人與野蠻人 — 友善的強盜，3–4 人',
  'profile.tb-harbors-2025': '商人與野蠻人 — 卡坦港口，3–4 人',
  'profile.tb-friendly-robber-harbors-2025': '商人與野蠻人 — 友善的強盜＋卡坦港口，3–4 人',
  'profile.tb-event-cards-2025': '商人與野蠻人 — 事件卡，3–4 人',
  'profile.tb-event-cards-friendly-robber-2025': '商人與野蠻人 — 事件卡＋友善的強盜，3–4 人',
  'profile.tb-event-cards-harbors-2025': '商人與野蠻人 — 事件卡＋卡坦港口，3–4 人',
  'profile.tb-event-cards-friendly-robber-harbors-2025': '商人與野蠻人 — 事件卡＋友善的強盜＋卡坦港口，3–4 人',
  'profile.unavailable.tbEventDeck': '2025 年版規則書未列出事件卡牌組的內容，因此尚未啟用事件卡對局。',
  'scenario.tb-fishing': '卡坦漁夫',
  'scenario.tb-rivers': '卡坦河流',
  'scenario.tb-merchant-trains': '商隊',
  'scenario.tb-barbarian-attack': '野蠻人來襲',
  'scenario.tb-traders-barbarians': '商人與野蠻人',
  'variant.friendly-robber': '友善的強盜',
  'variant.harbors': '卡坦港口',
  'variant.event-cards': '事件卡',

  'tb.nobody': '無人',

  'event.tb.strongestPorts': '{player} 取得最強港口（港口建築共 {points} 分）。',

  'tb.harbors.title': '最強港口',
  'tb.harbors.holder': '持有者：{player}',
  'tb.harbors.none': '尚無人取得 — 港口建築先達 3 分者獲得',
  'tb.harbors.points': '{player}：港口建築 {points} 分',
  'tb.help.friendly-robber': '強盜不能移到只有 2 分玩家的建築旁的地形；若無地形可去，強盜回到沙漠，且只能向分數高於 2 分的玩家搶奪。',
  'tb.help.harbors': '港口上的建築先累積 3 分的玩家取得最強港口（2 分）；之後港口建築分數更高者立即接手。獲勝需 11 分。',
  'tb.help.event-cards': '每回合翻開一張事件卡取代擲骰：先處理事件，再以卡上的數字生產。',
};

export const tradersBarbarians: ModuleCatalog = {
  en,
  'zh-Hant': zhHant,
};
