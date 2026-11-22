/**
 * Ruleset registry (§5.2 / §5.7).
 *
 * Every supported profile is an explicit registry entry with a stable id, rule
 * version, eligible player counts, expansion set, scenario, variants, layout
 * builder and victory target. The lobby only offers entries with
 * `enabled: true`; the server rejects anything else even if a modified client
 * submits it. Combinations are matched exactly: allowing SF+CK and CK+T&B says
 * nothing about SF+CK+T&B, so nothing is ever inferred transitively.
 */

import type { DevCardType } from './types.ts';

/**
 * base-2025.2: building and development-card costs return to the bank.
 * base-2025.3: roads stop at opponent buildings, Road Building and Year of
 * Plenty cannot stall, and an older card stays playable after buying another.
 * base-2025.4: Road Building grants two pieces when any legal road is
 * available, capped by the road supply. Saved older-version games keep their
 * recorded grant behavior and are not migrated.
 * The maintainer explicitly approved running unfinished base-2025.1 and
 * base-2025.2 games on this engine on 2026-11-02 as the PR #60 defect-fix
 * exception (SPEC §7.3, FIDELITY gap 11).
 * ep-2025.2 (Explorers & Pirates, `EP_RULE_VERSION`): a ship may enter a full
 * edge only if it can still reach a legal stop, and a stranded ship with no
 * way out ends its movement there (#97). The maintainer explicitly approved
 * running unfinished ep-2025.1 games on this engine on 2026-11-05 as the #97
 * defect-fix exception (SPEC §7.3, FIDELITY gap 11).
 */
export const BASE_RULE_VERSION = 'base-2025.4';
/** @deprecated Kept for callers that predate per-profile rule versions. */
export const ENGINE_VERSION = BASE_RULE_VERSION;

/** Expansions a profile can combine with the always-present base rules. */
export const EXPANSION_IDS = ['seafarers', 'citiesKnights', 'tradersBarbarians', 'explorersPirates'] as const;
export type ExpansionId = (typeof EXPANSION_IDS)[number];

/**
 * Scenario ids. A phase that registers a scenario appends it here and adds its
 * `scenario.<id>` message to both locales.
 */
export const SCENARIO_IDS = [
  'new-shores',
  // Traders & Barbarians (TB25)
  'tb-fishing',
  'tb-rivers',
  'tb-merchant-trains',
  'tb-barbarian-attack',
  'tb-traders-barbarians',
  // Seafarers further scenarios (SF25 pp. 6–20, D8)
  'four-islands',
  'fog-islands',
  'through-the-desert',
  'forgotten-tribe',
  'cloth-for-catan',
  'pirate-islands',
  'wonders-of-catan',
  'new-world',
  'land-ho', 'pirate-lairs', 'fish', 'spices', 'explorers-pirates',
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

/**
 * Optional rule variants layered on a profile (for example Traders &
 * Barbarians event cards). None is registered yet; ids are kebab-case and
 * owned by the rules module that implements them.
 */
export const VARIANT_IDS: readonly string[] = [
  // Traders & Barbarians (TB25 pp. 4–6)
  'friendly-robber',
  'harbors',
  'event-cards',
];
export type VariantId = string;

/** Rulebook source ids from SPEC §5.3. Later phases append their own. */
export const SOURCE_IDS = ['B25', 'B56-25', 'SF25', 'SF56-25', 'CK25', 'CK56-25', 'COMB', 'TB25', 'EP25', 'EP25-M', 'SFCN-20'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export interface ProfileSource {
  id: SourceId;
  /** Pages or sections the profile relies on, as cited in SPEC/FIDELITY. */
  pages: string;
}

/**
 * Physical boxes a table needs to play the profile. Display metadata for the
 * lobby only; it never takes part in validation.
 */
export const BOX_IDS = [
  'base',
  'base-5-6',
  'seafarers',
  'seafarers-5-6',
  'citiesKnights',
  'citiesKnights-5-6',
  'tradersBarbarians',
  'explorersPirates',
] as const;
export type BoxId = (typeof BOX_IDS)[number];

export interface ProfilePieces {
  settlements: number;
  cities: number;
  roads: number;
  ships: number;
  knights: number;
}

/**
 * `official` 只有 `base-paired-2025` 提供：官方 5–6 人版圖（對稱形狀、
 * 數字依 A→BB 固定順序、框上印好的港口），見 `official-56-board.ts`。
 */
/**
 * 島嶼獎勵規則：每位玩家每座島第一個村落得 `points` 分。`skip: 'main'` 不算主島
 * （島編號 `MAIN_ISLAND` = 1；S4 外地、S8 小島都是主島以外的島），`skip: 'home'`
 * 不算該玩家設置階段村落碰到的島（`SeafarersState.home`）。交叉點碰到多個島時，
 * 先剔除不計分的島，其餘各算一次（S4 沙漠與外地之間的交叉點歸外地）。
 */
export interface IslandBonusRule {
  points: number;
  skip: 'main' | 'home';
}

const NEW_SHORES_ISLAND_BONUS: IslandBonusRule = { points: 2, skip: 'main' };

export type SetupMode = 'fixed' | 'variable' | 'official';

export interface ProfileDefinition {
  id: string;
  /** i18n message id for the human-readable name. */
  labelKey: string;
  /**
   * Rules this profile's games are created under; stored in the snapshot as
   * `engineVersion` so a deploy never silently changes an in-progress game.
   */
  ruleVersion: string;
  /** Expansion set on top of the base rules (order is not significant). */
  expansions: readonly ExpansionId[];
  scenario: ScenarioId | null;
  /** 島嶼獎勵的靜態規則（spec §5.1）；省略表示沒有獎勵。 */
  islandBonus?: IslandBonusRule;
  variants: readonly VariantId[];
  /** Rules modules the engine runs for this profile, in hook order. */
  ruleModules: readonly string[];
  sources: readonly ProfileSource[];
  requiredBoxes: readonly BoxId[];
  playerCounts: number[];
  paired: boolean;
  victoryTarget: number;
  setupModes: SetupMode[];
  /** Layout builder id (`layouts.ts`); the builder chooses the topology. */
  layoutId: string;
  /** Default topology handed to the layout builder. */
  topologyId: string;
  bankPerResource: number;
  commodityBankPerType: number;
  pieces: ProfilePieces;
  devDeck: readonly DevCardType[];
  hasPirate: boolean;
  longestRouteIncludesShips: boolean;
  retainLargestArmy: boolean;
  /**
   * The engine can execute this profile's rules. Separate from `enabled` so
   * fixtures can exercise an implemented profile while the lobby still refuses
   * to advertise it until its evidence is complete.
   */
  implemented: boolean;
  /** False until the profile's rules and fixtures have passed. */
  enabled: boolean;
  /** i18n message id explaining why an entry is unavailable. */
  unavailableReasonKey?: string;
}

const BASE_DEV_DECK: readonly DevCardType[] = [
  ...Array<DevCardType>(14).fill('knight'),
  ...Array<DevCardType>(5).fill('victoryPoint'),
  ...Array<DevCardType>(2).fill('roadBuilding'),
  ...Array<DevCardType>(2).fill('yearOfPlenty'),
  ...Array<DevCardType>(2).fill('monopoly'),
];

const PAIRED_DEV_DECK: readonly DevCardType[] = [
  ...BASE_DEV_DECK,
  ...Array<DevCardType>(6).fill('knight'),
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
];

const BASE_PIECES: ProfilePieces = {
  settlements: 5,
  cities: 4,
  roads: 15,
  ships: 0,
  knights: 0,
};

type ProfileOverrides = Partial<Omit<ProfileDefinition, 'ruleModules'>> & { ruleModules?: readonly string[] };

function baseProfile(
  id: string,
  playerCounts: number[],
  overrides: ProfileOverrides = {},
): ProfileDefinition {
  const expansions = overrides.expansions ?? [];
  const variants = overrides.variants ?? [];
  return {
    id,
    labelKey: `profile.${id}`,
    ruleVersion: BASE_RULE_VERSION,
    expansions,
    scenario: null,
    variants,
    ruleModules: overrides.ruleModules ?? [...expansions, ...variants],
    sources: [{ id: 'B25', pages: 'entire rulebook' }],
    requiredBoxes: ['base'],
    playerCounts,
    paired: false,
    victoryTarget: 10,
    setupModes: ['fixed', 'variable'],
    layoutId: 'base',
    topologyId: 'hex-r2',
    bankPerResource: 19,
    commodityBankPerType: 0,
    pieces: { ...BASE_PIECES },
    devDeck: BASE_DEV_DECK,
    hasPirate: false,
    longestRouteIncludesShips: false,
    retainLargestArmy: true,
    implemented: false,
    enabled: false,
    ...overrides,
  } as ProfileDefinition;
}

const PAIRED_BASE = {
  paired: true,
  topologyId: 'hex-r56',
  bankPerResource: 24,
} as const;

/**
 * Traders & Barbarians (TB25, CN3089) on the base board, 3–4 players. Every
 * scenario/variant combination the phase supports is its own row; the module
 * composes the selected parts (`modules/tradersBarbarians`).
 */
const TB_RULE_VERSION = 'tb-2025.2';

function tbProfile(
  id: string,
  scenario: ScenarioId | null,
  variants: readonly VariantId[],
  pages: string,
  overrides: ProfileOverrides = {},
): ProfileDefinition {
  return baseProfile(id, [3, 4], {
    ruleVersion: TB_RULE_VERSION,
    expansions: ['tradersBarbarians'],
    scenario,
    variants,
    ruleModules: ['tradersBarbarians'],
    sources: [{ id: 'B25', pages: 'entire rulebook' }, { id: 'TB25', pages }],
    requiredBoxes: ['base', 'tradersBarbarians'],
    implemented: true,
    ...overrides,
  });
}

/**
 * Seafarers 其餘八個劇本（SF25 pp. 6–20，spec 2026-11-22-seafarers-scenarios.md §7.1）。
 * 只做 3–4 人，一個劇本一個 profile，共用規則版本 `sf-2025.3`。S0 只登記：
 * `implemented` 與 `enabled` 都是 false，各切片補齊轉錄與規則證據後才逐一啟用。
 * 尚未啟用的劇本，layout builder 與 topology 尚未存在（各切片自行登記），
 * `topologyId` 沿用 `baseProfile` 的預設值，只是佔位；在 `enabled: false`
 * 之下 `resolveCombination` 一律回 `disabled`，不會走到建圖。四島群島（S2）
 * 已有版圖與規則證據，故啟用。
 * 不在 bot 支援清單內（`bots/src/modules/seafarers` 的 `SUPPORTED_SCENARIOS`），
 * 因此一律拒絕 bot 座位。
 */
const SF_SCENARIO_RULE_VERSION = 'sf-2025.3';

function seafarersScenarioProfile(
  id: string,
  scenario: ScenarioId,
  victoryTarget: number,
  pages: string,
  overrides: ProfileOverrides = {},
): ProfileDefinition {
  return baseProfile(id, [3, 4], {
    ruleVersion: SF_SCENARIO_RULE_VERSION,
    expansions: ['seafarers'],
    scenario,
    sources: [
      { id: 'B25', pages: 'entire rulebook' },
      { id: 'SF25', pages: `pp. 2–3, ${pages}` },
      { id: 'SFCN-20', pages: 'cross-check only' },
    ],
    requiredBoxes: ['base', 'seafarers'],
    victoryTarget,
    setupModes: ['fixed'],
    layoutId: id.replace(/-2025$/, ''),
    pieces: { ...BASE_PIECES, ships: 15 },
    // §7.1：S8 在規則內關閉海盜，S6、S7 在規則內關閉最長道路；registry 欄位一律先填 true。
    hasPirate: true,
    longestRouteIncludesShips: true,
    implemented: false,
    enabled: false,
    unavailableReasonKey: 'profile.unavailable.seafarersScenario',
    ...overrides,
  });
}

const SEAFARERS_SCENARIO_PROFILES: readonly ProfileDefinition[] = [
  seafarersScenarioProfile('sf-four-islands-2025', 'four-islands', 13, 'pp. 6–7', {
    islandBonus: { points: 2, skip: 'home' },
    // 3、4 人同為 35 格外框，layout builder 依人數選港口位置不同的 topology。
    topologyId: 'sf-four-islands-3',
    implemented: true,
    enabled: true,
  }),
  seafarersScenarioProfile('sf-fog-islands-2025', 'fog-islands', 12, 'pp. 8–9'),
  seafarersScenarioProfile('sf-through-the-desert-2025', 'through-the-desert', 14, 'pp. 10–11', { islandBonus: { points: 2, skip: 'main' } }),
  seafarersScenarioProfile('sf-forgotten-tribe-2025', 'forgotten-tribe', 13, 'pp. 12–13'),
  // 目標 14 分；另有「回合結束時部落耗盡」的終局與共同勝利（D12），在 S6 實作。
  seafarersScenarioProfile('sf-cloth-for-catan-2025', 'cloth-for-catan', 14, 'pp. 14–15'),
  // 真正條件是「收復自己的堡壘且 10 分」，複合條件在 S7 實作；此處只放分數部分。
  seafarersScenarioProfile('sf-pirate-islands-2025', 'pirate-islands', 10, 'pp. 16–17'),
  // 真正條件是「完成奇觀，或 10 分且層數最高」，複合條件在 S8 實作；此處只放分數部分。
  seafarersScenarioProfile('sf-wonders-of-catan-2025', 'wonders-of-catan', 10, 'pp. 18–19', { islandBonus: { points: 1, skip: 'main' } }),
  seafarersScenarioProfile('sf-new-world-2025', 'new-world', 12, 'p. 20', { setupModes: ['variable'], islandBonus: { points: 1, skip: 'home' } }),
];

/**
 * 五個 E&P profile 共用的規則版本。ep-2025.2 修正 #97 的擱淺死結；未完成的
 * ep-2025.1 遊戲經維護者核准（2026-11-05）直接改走這一版的行為，不依版本分支。
 */
const EP_RULE_VERSION = 'ep-2025.2';

/**
 * Explorers & Pirates (EP25 / EP25-M, CN3085): one profile per mission set, in
 * book order; rules in `modules/explorersPirates/`, maps in
 * `explorers-pirates-boards.ts`. E&P is standalone: no development cards,
 * cities, robber, ports, Longest Road or Largest Army (EP25-M p. 2), and it is
 * never combined with Seafarers. Harbour settlements are base settlements
 * the module marks, so settlements 9 = 5 plain + 4 harbour settlements;
 * the module keeps plain settlements at 5.
 */
function explorersPiratesProfile(
  id: string,
  scenario: ScenarioId,
  victoryTarget: number,
  setupModes: SetupMode[],
  pages: string,
  overrides: ProfileOverrides = {},
): ProfileDefinition {
  return baseProfile(id, [3, 4], {
    ruleVersion: EP_RULE_VERSION,
    expansions: ['explorersPirates'],
    scenario,
    sources: [
      { id: 'B25', pages: 'entire rulebook' },
      { id: 'EP25', pages: 'pp. 2–15' },
      { id: 'EP25-M', pages },
    ],
    requiredBoxes: ['base', 'explorersPirates'],
    victoryTarget,
    setupModes,
    layoutId: 'explorers-pirates',
    topologyId: scenario === 'land-ho' ? 'ep-land-ho' : scenario === 'spices' ? 'ep-spices' : scenario === 'explorers-pirates' ? 'ep-full' : 'ep-pirate-lairs',
    pieces: { settlements: 9, cities: 0, roads: 15, ships: 3, knights: 0 },
    devDeck: [],
    implemented: true,
    enabled: true,
    unavailableReasonKey: 'profile.unavailable.explorersPirates',
    ...overrides,
  });
}

const EXPLORERS_PIRATES_PROFILES: readonly ProfileDefinition[] = [
  explorersPiratesProfile('ep-land-ho-2025', 'land-ho', 8, ['fixed'], 'pp. 2–7'),
  explorersPiratesProfile('ep-pirate-lairs-2025', 'pirate-lairs', 12, ['fixed'], 'pp. 2–13'),
  explorersPiratesProfile('ep-fish-2025', 'fish', 15, ['variable'], 'pp. 2–15'),
  explorersPiratesProfile('ep-spices-2025', 'spices', 15, ['variable'], 'pp. 2–18'),
  explorersPiratesProfile('ep-full-2025', 'explorers-pirates', 17, ['variable'], 'pp. 2–3', { sources: [
    { id: 'B25', pages: 'entire rulebook' },
    { id: 'EP25', pages: 'pp. 2–15' },
    { id: 'EP25-M', pages: 'pp. 2–3' },
  ] }),
];

/** Event-card rows stay closed: TB25 does not list the deck's cards (FIDELITY). */
const EVENT_DECK_CLOSED = { implemented: false, enabled: false, unavailableReasonKey: 'profile.unavailable.tbEventDeck' } as const;

const TRADERS_BARBARIANS_PROFILES: readonly ProfileDefinition[] = [
  tbProfile('tb-friendly-robber-2025', null, ['friendly-robber'], 'p. 4', { enabled: true }),
  tbProfile('tb-harbors-2025', null, ['harbors'], 'p. 4', { victoryTarget: 11, enabled: true }),
  tbProfile('tb-friendly-robber-harbors-2025', null, ['friendly-robber', 'harbors'], 'pp. 2, 4', {
    victoryTarget: 11,
    enabled: true,
  }),
  tbProfile('tb-fishing-2025', 'tb-fishing', [], 'pp. 9–10', {
    layoutId: 'tb-fishing',
    topologyId: 'tb-r2',
    setupModes: ['variable'],
    enabled: true,
  }),
  tbProfile('tb-rivers-2025', 'tb-rivers', [], 'pp. 11–12', {
    layoutId: 'tb-rivers',
    topologyId: 'tb-r2',
    setupModes: ['variable'],
    enabled: true,
  }),
  tbProfile('tb-merchant-trains-2025', 'tb-merchant-trains', [], 'pp. 13–14', {
    layoutId: 'tb-merchant-trains',
    topologyId: 'tb-r2',
    setupModes: ['variable'],
    victoryTarget: 12,
    enabled: true,
  }),
  tbProfile('tb-barbarian-attack-2025', 'tb-barbarian-attack', [], 'pp. 15–19', {
    layoutId: 'tb-barbarian-attack',
    topologyId: 'tb-r2',
    setupModes: ['variable'],
    victoryTarget: 12,
    // The scenario's own cards replace the base deck; no Largest Army.
    devDeck: [],
    retainLargestArmy: false,
    pieces: { settlements: 5, cities: 4, roads: 15, ships: 0, knights: 6 },
    enabled: true,
  }),
  tbProfile('tb-traders-barbarians-2025', 'tb-traders-barbarians', [], 'pp. 20–24', {
    layoutId: 'tb-traders-barbarians',
    topologyId: 'tb-traders-r2',
    setupModes: ['variable'],
    victoryTarget: 13,
    // 16 Knight, 3 Road Building, 3 Swift Journey, 3 Victory Point (p. 20).
    devDeck: [
      ...Array<DevCardType>(16).fill('barbarianKnight'),
      ...Array<DevCardType>(3).fill('roadBuilding'),
      ...Array<DevCardType>(3).fill('swiftJourney'),
      ...Array<DevCardType>(3).fill('victoryPoint'),
    ],
    enabled: true,
  }),
  tbProfile('tb-event-cards-2025', null, ['event-cards'], 'pp. 4–6', EVENT_DECK_CLOSED),
  tbProfile('tb-event-cards-friendly-robber-2025', null, ['event-cards', 'friendly-robber'], 'pp. 2, 4–6', EVENT_DECK_CLOSED),
  tbProfile('tb-event-cards-harbors-2025', null, ['event-cards', 'harbors'], 'pp. 2, 4–6', {
    victoryTarget: 11,
    ...EVENT_DECK_CLOSED,
  }),
  tbProfile('tb-event-cards-friendly-robber-harbors-2025', null, ['event-cards', 'friendly-robber', 'harbors'], 'pp. 2, 4–6', {
    victoryTarget: 11,
    ...EVENT_DECK_CLOSED,
  }),
];

export const PROFILES: readonly ProfileDefinition[] = [
  baseProfile('base-2025', [3, 4], { implemented: true, enabled: true }),

  baseProfile('base-paired-2025', [5, 6], {
    ...PAIRED_BASE,
    devDeck: PAIRED_DEV_DECK,
    sources: [{ id: 'B25', pages: 'entire rulebook' }, { id: 'B56-25', pages: 'p. 3' }],
    requiredBoxes: ['base', 'base-5-6'],
    setupModes: ['fixed', 'variable', 'official'],
    // Paired turns and the 5–6 base setup/supply/deck fixtures are verified.
    implemented: true,
    enabled: true,
  }),

  // SF25 Heading for New Shores, printed 3- and 4-player maps
  // (`seafarers-boards.ts`); rules in `modules/seafarers/`.
  baseProfile('sf-new-shores-2025', [3, 4], {
    ruleVersion: 'sf-2025.2',
    expansions: ['seafarers'],
    scenario: 'new-shores',
    islandBonus: NEW_SHORES_ISLAND_BONUS,
    sources: [{ id: 'B25', pages: 'entire rulebook' }, { id: 'SF25', pages: 'pp. 2–5' }],
    requiredBoxes: ['base', 'seafarers'],
    victoryTarget: 14,
    setupModes: ['fixed'],
    layoutId: 'sf-new-shores',
    topologyId: 'sf-new-shores-4',
    pieces: { ...BASE_PIECES, ships: 15 },
    hasPirate: true,
    longestRouteIncludesShips: true,
    // R-SF fixtures pass and the SF25/SF56-25 evidence is in docs/FIDELITY.md.
    implemented: true,
    enabled: true,
  }),

  // SF56-25 Heading for New Shores: fixed small islands, a variable main
  // island and random ports on the marked positions, so the only setup mode
  // is `variable`. B56-25 supply and development deck.
  baseProfile('sf-new-shores-paired-2025', [5, 6], {
    ...PAIRED_BASE,
    ruleVersion: 'sf-2025.2',
    expansions: ['seafarers'],
    scenario: 'new-shores',
    islandBonus: NEW_SHORES_ISLAND_BONUS,
    sources: [
      { id: 'B56-25', pages: 'pp. 3–4' },
      { id: 'SF25', pages: 'pp. 2–5' },
      { id: 'SF56-25', pages: 'pp. 1–4' },
    ],
    requiredBoxes: ['base', 'base-5-6', 'seafarers', 'seafarers-5-6'],
    victoryTarget: 14,
    setupModes: ['variable'],
    layoutId: 'sf-new-shores',
    topologyId: 'sf-new-shores-56',
    devDeck: PAIRED_DEV_DECK,
    pieces: { ...BASE_PIECES, ships: 15 },
    hasPirate: true,
    longestRouteIncludesShips: true,
    // R-SF fixtures pass and the SF25/SF56-25 evidence is in docs/FIDELITY.md.
    implemented: true,
    enabled: true,
  }),

  // CK25 in `modules/citiesKnights/`: the core rules (P2) and the 54 progress
  // cards with the merchant (P3). Enabled after the R-CK fixtures and a full
  // browser game passed (docs/FIDELITY.md).
  baseProfile('ck-2025', [3, 4], {
    ruleVersion: 'ck-2025.1',
    expansions: ['citiesKnights'],
    sources: [{ id: 'B25', pages: 'entire rulebook' }, { id: 'CK25', pages: 'pp. 2–11, 13–16' }],
    requiredBoxes: ['base', 'citiesKnights'],
    victoryTarget: 13,
    devDeck: [],
    pieces: { ...BASE_PIECES, knights: 6 },
    // 36 commodity cards, 12 of each (CK25 p. 3).
    commodityBankPerType: 12,
    implemented: true,
    enabled: true,
  }),

  baseProfile('ck-paired-2025', [5, 6], {
    ...PAIRED_BASE,
    ruleVersion: 'ck-2025.1',
    expansions: ['citiesKnights'],
    sources: [
      { id: 'B56-25', pages: 'pp. 3–4' },
      { id: 'CK25', pages: 'pp. 2–11, 13–16' },
      { id: 'CK56-25', pages: 'pp. 2–4' },
    ],
    requiredBoxes: ['base', 'base-5-6', 'citiesKnights', 'citiesKnights-5-6'],
    victoryTarget: 13,
    devDeck: [],
    pieces: { ...BASE_PIECES, knights: 6 },
    // 36 + 18 commodity cards, 18 of each (CK25 p. 3, CK56-25 pp. 2–3).
    commodityBankPerType: 18,
    implemented: true,
    enabled: true,
  }),

  // Heading for New Shores with Cities & Knights (SF25 pp. 4–5 maps, CK25
  // rules, CK25 p. 12 and COMB for the combination). The combination layer
  // runs first so its vetoes (pirate before the first attack, knight chases,
  // ship moves next to knights) precede both expansions' hooks; Seafarers
  // then queues gold before the C&K science bonus. Enabled after the R-COMB
  // fixtures, the simulated games and a browser game passed (docs/FIDELITY.md).
  baseProfile('sf-ck-new-shores-2025', [3, 4], {
    ruleVersion: 'sf-ck-2025.1',
    expansions: ['seafarers', 'citiesKnights'],
    ruleModules: ['seafarersCitiesKnights', 'seafarers', 'citiesKnights'],
    scenario: 'new-shores',
    islandBonus: NEW_SHORES_ISLAND_BONUS,
    sources: [
      { id: 'B25', pages: 'entire rulebook' },
      { id: 'SF25', pages: 'pp. 2–5' },
      { id: 'CK25', pages: 'pp. 2–16' },
      { id: 'COMB', pages: 'catan.com/seafarers, accessed 2026-11-02' },
    ],
    requiredBoxes: ['base', 'seafarers', 'citiesKnights'],
    // New Shores' 14 + 2 (COMB).
    victoryTarget: 16,
    setupModes: ['fixed'],
    layoutId: 'sf-new-shores',
    topologyId: 'sf-new-shores-4',
    devDeck: [],
    pieces: { ...BASE_PIECES, ships: 15, knights: 6 },
    hasPirate: true,
    longestRouteIncludesShips: true,
    commodityBankPerType: 12,
    implemented: true,
    enabled: true,
  }),

  // SF56-25 map (fixed small islands, variable main island and ports) with
  // CK56-25 supply; both 5–6 rulebooks' paired turns apply.
  baseProfile('sf-ck-new-shores-paired-2025', [5, 6], {
    ...PAIRED_BASE,
    ruleVersion: 'sf-ck-2025.1',
    expansions: ['seafarers', 'citiesKnights'],
    ruleModules: ['seafarersCitiesKnights', 'seafarers', 'citiesKnights'],
    scenario: 'new-shores',
    islandBonus: NEW_SHORES_ISLAND_BONUS,
    sources: [
      { id: 'B56-25', pages: 'pp. 3–4' },
      { id: 'SF25', pages: 'pp. 2–5' },
      { id: 'SF56-25', pages: 'pp. 1–4' },
      { id: 'CK25', pages: 'pp. 2–16' },
      { id: 'CK56-25', pages: 'pp. 2–4' },
      { id: 'COMB', pages: 'catan.com/seafarers, accessed 2026-11-02' },
    ],
    requiredBoxes: [
      'base', 'base-5-6', 'seafarers', 'seafarers-5-6', 'citiesKnights', 'citiesKnights-5-6',
    ],
    victoryTarget: 16,
    setupModes: ['variable'],
    layoutId: 'sf-new-shores',
    topologyId: 'sf-new-shores-56',
    devDeck: [],
    pieces: { ...BASE_PIECES, ships: 15, knights: 6 },
    hasPirate: true,
    longestRouteIncludesShips: true,
    // 36 + 18 commodity cards, 18 of each (CK25 p. 3, CK56-25 pp. 2–3).
    commodityBankPerType: 18,
    implemented: true,
    enabled: true,
  }),

  ...SEAFARERS_SCENARIO_PROFILES,
  ...EXPLORERS_PIRATES_PROFILES,
  ...TRADERS_BARBARIANS_PROFILES,
];

const byId = new Map(PROFILES.map((profile) => [profile.id, profile]));

export function getProfile(id: string): ProfileDefinition | undefined {
  return byId.get(id);
}

export function requireProfile(id: string): ProfileDefinition {
  const profile = byId.get(id);
  if (!profile) throw new Error(`unknown ruleset profile: ${id}`);
  return profile;
}

/**
 * Registers a profile that only tests use. It can be looked up by id, but it is
 * never listed in `PROFILES`, offered by the lobby or matched by
 * `resolveCombination`, so no network request can create a game with it.
 */
export function registerFixtureProfile(
  id: string,
  playerCounts: number[],
  overrides: ProfileOverrides = {},
): ProfileDefinition {
  if (PROFILES.some((profile) => profile.id === id)) {
    throw new Error(`fixture profile would shadow a registered profile: ${id}`);
  }
  const profile = baseProfile(id, playerCounts, { implemented: true, ...overrides });
  byId.set(id, profile);
  return profile;
}

export function hasExpansion(profile: ProfileDefinition, expansion: ExpansionId): boolean {
  return profile.expansions.includes(expansion);
}

export interface CombinationRequest {
  expansions: readonly string[];
  scenario: string | null;
  variants: readonly string[];
  playerCount: number;
  setupMode: SetupMode;
}

export type CombinationRejection =
  | 'invalid-request'
  | 'unknown-profile'
  | 'disabled'
  | 'bad-player-count'
  | 'bad-setup-mode';

export type CombinationCheck =
  | { ok: true; profile: ProfileDefinition }
  | { ok: false; reason: CombinationRejection };

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function isSet(values: unknown): values is readonly string[] {
  return Array.isArray(values) &&
    values.every((value) => typeof value === 'string') &&
    new Set(values).size === values.length;
}

/**
 * Server-side validation of a requested ruleset combination (§5.2).
 *
 * The expansion set, scenario and variant set must equal one registered
 * profile's exactly (order-insensitive); the player count then has to be one
 * that profile supports. A combination is never inferred from its parts.
 */
export function resolveCombination(request: CombinationRequest): CombinationCheck {
  if (!request || !isSet(request.expansions) || !isSet(request.variants ?? [])) {
    return { ok: false, reason: 'invalid-request' };
  }
  const variants = request.variants ?? [];
  const scenario = request.scenario ?? null;
  const family = PROFILES.filter(
    (profile) =>
      sameSet(profile.expansions, request.expansions) &&
      profile.scenario === scenario &&
      sameSet(profile.variants, variants),
  );
  if (family.length === 0) return { ok: false, reason: 'unknown-profile' };
  const match = family.find((profile) => profile.playerCounts.includes(request.playerCount));
  if (!match) return { ok: false, reason: 'bad-player-count' };
  if (!match.enabled) return { ok: false, reason: 'disabled' };
  if (!match.setupModes.includes(request.setupMode)) return { ok: false, reason: 'bad-setup-mode' };
  return { ok: true, profile: match };
}

/** The combination request that resolves to exactly this profile. */
export function combinationOf(
  profile: ProfileDefinition,
  playerCount: number,
  setupMode: SetupMode,
): CombinationRequest {
  return {
    expansions: profile.expansions,
    scenario: profile.scenario,
    variants: profile.variants,
    playerCount,
    setupMode,
  };
}

/** Entries the lobby may offer for a player count. */
export function selectableProfiles(playerCount?: number): ProfileDefinition[] {
  return PROFILES.filter(
    (profile) => profile.enabled && (playerCount === undefined || profile.playerCounts.includes(playerCount)),
  );
}
