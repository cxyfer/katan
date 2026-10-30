/**
 * Ruleset registry (§5.2 / §5.7).
 *
 * Every supported profile is an explicit registry entry with a stable id, rule
 * version, eligible player counts, enabled modules, board/setup descriptor and
 * victory target. The lobby only offers entries with `enabled: true`; the
 * server rejects anything else even if a modified client submits it.
 */

import type { DevCardType } from './types.ts';

/**
 * base-2025.2: building and development-card costs return to the bank.
 * Unfinished base-2025.1 games run on this engine as an approved defect fix
 * (SPEC §7.3, FIDELITY gap 11); 2025.1 leaked spent cards out of the supply.
 */
export const ENGINE_VERSION = 'base-2025.2';

export interface ProfilePieces {
  settlements: number;
  cities: number;
  roads: number;
  ships: number;
  knights: number;
}

export interface ProfileDefinition {
  id: string;
  /** i18n message id for the human-readable name. */
  labelKey: string;
  playerCounts: number[];
  paired: boolean;
  modules: { base: true; seafarers: boolean; citiesKnights: boolean };
  scenario: string | null;
  victoryTarget: number;
  setupModes: ('fixed' | 'variable')[];
  boardRadius: number;
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

function baseProfile(
  id: string,
  playerCounts: number[],
  overrides: Partial<ProfileDefinition> = {},
): ProfileDefinition {
  return {
    id,
    labelKey: `profile.${id}`,
    playerCounts,
    paired: false,
    modules: { base: true, seafarers: false, citiesKnights: false },
    scenario: null,
    victoryTarget: 10,
    setupModes: ['fixed', 'variable'],
    boardRadius: 2,
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
  };
}

export const PROFILES: readonly ProfileDefinition[] = [
  baseProfile('base-2025', [3, 4], { implemented: true, enabled: true }),

  baseProfile('base-paired-2025', [5, 6], {
    paired: true,
    boardRadius: 3,
    topologyId: 'hex-r56',
    bankPerResource: 24,
    devDeck: PAIRED_DEV_DECK,
    // Paired turns and the 5–6 base setup/supply/deck fixtures are verified.
    implemented: true,
    enabled: true,
  }),

  baseProfile('sf-new-shores-2025', [3, 4], {
    modules: { base: true, seafarers: true, citiesKnights: false },
    scenario: 'new-shores',
    victoryTarget: 14,
    setupModes: ['fixed'],
    pieces: { ...BASE_PIECES, ships: 15 },
    hasPirate: true,
    longestRouteIncludesShips: true,
    unavailableReasonKey: 'profile.unavailable.seafarers',
  }),

  baseProfile('sf-new-shores-paired-2025', [5, 6], {
    paired: true,
    modules: { base: true, seafarers: true, citiesKnights: false },
    scenario: 'new-shores',
    victoryTarget: 14,
    setupModes: ['fixed'],
    bankPerResource: 24,
    pieces: { ...BASE_PIECES, ships: 15 },
    hasPirate: true,
    longestRouteIncludesShips: true,
    unavailableReasonKey: 'profile.unavailable.seafarers',
  }),

  baseProfile('ck-2025', [3, 4], {
    modules: { base: true, seafarers: false, citiesKnights: true },
    victoryTarget: 13,
    devDeck: [],
    pieces: { ...BASE_PIECES, knights: 6 },
    commodityBankPerType: 12,
    unavailableReasonKey: 'profile.unavailable.citiesKnights',
  }),

  baseProfile('ck-paired-2025', [5, 6], {
    paired: true,
    modules: { base: true, seafarers: false, citiesKnights: true },
    victoryTarget: 13,
    bankPerResource: 24,
    devDeck: [],
    pieces: { ...BASE_PIECES, knights: 6 },
    commodityBankPerType: 12,
    unavailableReasonKey: 'profile.unavailable.citiesKnights',
  }),

  baseProfile('sf-ck-new-shores-2025', [3, 4], {
    modules: { base: true, seafarers: true, citiesKnights: true },
    scenario: 'new-shores',
    victoryTarget: 16,
    setupModes: ['fixed'],
    devDeck: [],
    pieces: { ...BASE_PIECES, ships: 15, knights: 6 },
    hasPirate: true,
    longestRouteIncludesShips: true,
    commodityBankPerType: 12,
    unavailableReasonKey: 'profile.unavailable.combined',
  }),

  baseProfile('sf-ck-new-shores-paired-2025', [5, 6], {
    paired: true,
    modules: { base: true, seafarers: true, citiesKnights: true },
    scenario: 'new-shores',
    victoryTarget: 16,
    setupModes: ['fixed'],
    bankPerResource: 24,
    devDeck: [],
    pieces: { ...BASE_PIECES, ships: 15, knights: 6 },
    hasPirate: true,
    longestRouteIncludesShips: true,
    commodityBankPerType: 12,
    unavailableReasonKey: 'profile.unavailable.combined',
  }),
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

export interface CombinationRequest {
  playerCount: number;
  seafarers: boolean;
  citiesKnights: boolean;
  scenario: string | null;
  setupMode: 'fixed' | 'variable';
}

export type CombinationCheck =
  | { ok: true; profile: ProfileDefinition }
  | { ok: false; reason: 'unknown-profile' | 'disabled' | 'bad-player-count' | 'bad-setup-mode' };

/** Server-side validation of a requested ruleset combination (§5.2). */
export function resolveCombination(request: CombinationRequest): CombinationCheck {
  const match = PROFILES.find(
    (profile) =>
      profile.modules.seafarers === request.seafarers &&
      profile.modules.citiesKnights === request.citiesKnights &&
      profile.scenario === request.scenario &&
      profile.playerCounts.includes(request.playerCount),
  );
  if (!match) return { ok: false, reason: 'unknown-profile' };
  if (!match.enabled) return { ok: false, reason: 'disabled' };
  if (!match.setupModes.includes(request.setupMode)) return { ok: false, reason: 'bad-setup-mode' };
  return { ok: true, profile: match };
}

/** Entries the lobby may offer for a player count. */
export function selectableProfiles(playerCount?: number): ProfileDefinition[] {
  return PROFILES.filter(
    (profile) => profile.enabled && (playerCount === undefined || profile.playerCounts.includes(playerCount)),
  );
}
