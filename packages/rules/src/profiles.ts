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
 * The maintainer explicitly approved running unfinished base-2025.1 and
 * base-2025.2 games on this engine on 2026-11-02 as the PR #60 defect-fix
 * exception (SPEC §7.3, FIDELITY gap 11).
 */
export const BASE_RULE_VERSION = 'base-2025.3';
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
export const SOURCE_IDS = ['B25', 'B56-25', 'SF25', 'SF56-25', 'CK25', 'CK56-25', 'COMB', 'TB25', 'EP25', 'EP25-M'] as const;
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

export type SetupMode = 'fixed' | 'variable';

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
const TB_RULE_VERSION = 'tb-2025.1';

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
    ruleVersion: 'ep-2025.1',
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
    // Paired turns and the 5–6 base setup/supply/deck fixtures are verified.
    implemented: true,
    enabled: true,
  }),

  // SF25 Heading for New Shores, printed 3- and 4-player maps
  // (`seafarers-boards.ts`); rules in `modules/seafarers/`.
  baseProfile('sf-new-shores-2025', [3, 4], {
    ruleVersion: 'sf-2025.1',
    expansions: ['seafarers'],
    scenario: 'new-shores',
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
    ruleVersion: 'sf-2025.1',
    expansions: ['seafarers'],
    scenario: 'new-shores',
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
