/**
 * Typed access to the Cities & Knights module's public view and advisory
 * hints (`GameView.modules.citiesKnights`, `ActionHints.modules.citiesKnights`),
 * plus the board commands the module adds. Base games have neither, so every
 * helper returns `null` (or nothing) there.
 */

import type { GameView, Resource } from '@catan/rules';
import type { Selection } from '../state/table.ts';

export type Track = 'science' | 'trade' | 'politics';
export const TRACKS: readonly Track[] = ['science', 'trade', 'politics'];
export type Commodity = 'paper' | 'cloth' | 'coin';
export const TRACK_COMMODITY: Readonly<Record<Track, Commodity>> = { science: 'paper', trade: 'cloth', politics: 'coin' };
export type EventFace = 'ship' | Track;
export type KnightLevel = 1 | 2 | 3;

export interface KnightView {
  player: string;
  vertex: number;
  level: KnightLevel;
  active: boolean;
  /** Activated in the current action window: cannot act in it. */
  fresh: boolean;
  promoted: boolean;
}

export interface AttackView {
  atSeq: number;
  barbarians: number;
  defenders: number;
  contributions: Record<string, number>;
  outcome: 'barbarians' | 'defenders';
  losers: string[];
  defender: string | null;
  tied: string[];
  pillaged: { player: string; vertex: number }[];
}

export interface CitiesKnightsModuleView {
  barbarian: { position: number; length: number; attacks: number };
  barbarianStrength: number;
  defenderStrength: number;
  robberActive: boolean;
  knights: KnightView[];
  walls: { vertex: number; player: string | null }[];
  metropolises: Record<Track, { player: string; vertex: number } | null>;
  toppled: number[];
  progressVp: Record<string, string[]>;
  progressCounts: Record<string, number>;
  decks: Record<Track, number>;
  commodityBank: Record<Commodity, number>;
  lastRoll: { event: EventFace; red: number; atSeq: number } | null;
  lastAttack: AttackView | null;
  handLimit: number;
}

export interface KnightHint {
  vertex: number;
  level: KnightLevel;
  active: boolean;
  canActivate: boolean;
  canPromote: boolean;
  canAct: boolean;
  moves: number[];
  displace: number[];
  chase: boolean;
}

export interface ImprovementOption {
  track: Track;
  level: number;
  cost: number;
  commodity: Commodity;
  metropolis: boolean;
  sites: number[];
  blocked: 'no-city' | 'max-level' | 'no-site' | 'cost' | null;
}

export interface CitiesKnightsHints {
  recruitSites: number[];
  knightSupply: Record<KnightLevel, number>;
  knights: KnightHint[];
  wallSites: number[];
  improvements: ImprovementOption[];
  commodityRates: Record<Commodity, number>;
  costs: { wall: Partial<Record<Resource, number>>; knight: Partial<Record<Resource, number>>; promote: Partial<Record<Resource, number>>; activate: Partial<Record<Resource, number>> };
  progressExcess: number;
  retreat: number[];
  pillage: number[];
  defenderDecks: Track[];
  scienceBonus: boolean;
}

/** Printed costs (CK25 pp. 8–9); hints carry the same values. */
export const WALL_COST: Partial<Record<Resource, number>> = { brick: 2 };
export const KNIGHT_COST: Partial<Record<Resource, number>> = { wool: 1, ore: 1 };
export const PROMOTE_COST: Partial<Record<Resource, number>> = { wool: 1, ore: 1 };
export const ACTIVATE_COST: Partial<Record<Resource, number>> = { grain: 1 };
export const MAX_LEVEL = 5;
export const METROPOLIS_POINTS = 2;
export const MAX_WALLS = 3;

export function citiesKnightsView(view: Pick<GameView, 'modules'> | null | undefined): CitiesKnightsModuleView | null {
  const slot = view?.modules?.citiesKnights as Partial<CitiesKnightsModuleView> | undefined;
  if (!slot || !slot.barbarian) return null;
  return {
    barbarian: slot.barbarian,
    barbarianStrength: slot.barbarianStrength ?? 0,
    defenderStrength: slot.defenderStrength ?? 0,
    robberActive: !!slot.robberActive,
    knights: slot.knights ?? [],
    walls: slot.walls ?? [],
    metropolises: { science: null, trade: null, politics: null, ...(slot.metropolises ?? {}) },
    toppled: slot.toppled ?? [],
    progressVp: slot.progressVp ?? {},
    progressCounts: slot.progressCounts ?? {},
    decks: { science: 0, trade: 0, politics: 0, ...(slot.decks ?? {}) },
    commodityBank: { paper: 0, cloth: 0, coin: 0, ...(slot.commodityBank ?? {}) },
    lastRoll: slot.lastRoll ?? null,
    lastAttack: slot.lastAttack ?? null,
    handLimit: slot.handLimit ?? 4,
  };
}

export function citiesKnightsHints(view: Pick<GameView, 'hints'> | null | undefined): CitiesKnightsHints | null {
  const slot = view?.hints?.modules?.citiesKnights as Partial<CitiesKnightsHints> | undefined;
  if (!slot) return null;
  return {
    recruitSites: slot.recruitSites ?? [],
    knightSupply: slot.knightSupply ?? { 1: 0, 2: 0, 3: 0 },
    knights: slot.knights ?? [],
    wallSites: slot.wallSites ?? [],
    improvements: slot.improvements ?? [],
    commodityRates: { paper: 4, cloth: 4, coin: 4, ...(slot.commodityRates ?? {}) },
    costs: slot.costs ?? { wall: WALL_COST, knight: KNIGHT_COST, promote: PROMOTE_COST, activate: ACTIVATE_COST },
    progressExcess: slot.progressExcess ?? 0,
    retreat: slot.retreat ?? [],
    pillage: slot.pillage ?? [],
    defenderDecks: slot.defenderDecks ?? [],
    scienceBonus: !!slot.scienceBonus,
  };
}

/**
 * Board commands of the module. `knight.pickMove` and `knight.pickDisplace`
 * are client-only first steps (choose the knight); the second step sends
 * `knight.move` / `knight.displace` with `{ from, to }`.
 */
const KNIGHT_COMMANDS = new Set([
  'knight.recruit', 'knight.activate', 'knight.promote', 'knight.pickMove', 'knight.move',
  'knight.pickDisplace', 'knight.displace', 'knight.chaseRobber', 'knight.retreat',
]);

export function isKnightCommand(commandType: string | null | undefined): boolean {
  return !!commandType && KNIGHT_COMMANDS.has(commandType);
}

/** Vertex commands owned by the module (for previews and labels). */
export function isCitiesKnightsVertexCommand(commandType: string | null | undefined): boolean {
  return isKnightCommand(commandType) || commandType === 'build.wall' || commandType === 'city.improve' || commandType === 'barbarians.pillage';
}

/** Legal intersections for a module board command, from the hints. */
export function citiesKnightsTargets(view: Pick<GameView, 'hints'> | null | undefined, selection: Pick<Selection, 'commandType' | 'params'>): number[] | null {
  const hints = citiesKnightsHints(view);
  if (!hints) return null;
  const from = selection.params?.from;
  switch (selection.commandType) {
    case 'knight.recruit': return hints.recruitSites;
    case 'knight.activate': return hints.knights.filter((knight) => knight.canActivate).map((knight) => knight.vertex);
    case 'knight.promote': return hints.knights.filter((knight) => knight.canPromote).map((knight) => knight.vertex);
    case 'knight.pickMove': return hints.knights.filter((knight) => knight.moves.length > 0).map((knight) => knight.vertex);
    case 'knight.move': return hints.knights.find((knight) => knight.vertex === from)?.moves ?? [];
    case 'knight.pickDisplace': return hints.knights.filter((knight) => knight.displace.length > 0).map((knight) => knight.vertex);
    case 'knight.displace': return hints.knights.find((knight) => knight.vertex === from)?.displace ?? [];
    case 'knight.chaseRobber': return hints.knights.filter((knight) => knight.chase).map((knight) => knight.vertex);
    case 'knight.retreat': return hints.retreat;
    case 'build.wall': return hints.wallSites;
    case 'barbarians.pillage': return hints.pillage;
    case 'city.improve': {
      const track = selection.params?.track;
      return hints.improvements.find((option) => option.track === track)?.sites ?? [];
    }
    default: return null;
  }
}

/** The second step after picking a knight, or null when the pick is final. */
export function knightFollowUp(commandType: string, index: number): Selection | null {
  if (commandType === 'knight.pickMove') {
    return { kind: 'vertex', index: null, commandType: 'knight.move', labelId: 'ck.action.moveTarget', params: { from: index }, field: 'to' };
  }
  if (commandType === 'knight.pickDisplace') {
    return { kind: 'vertex', index: null, commandType: 'knight.displace', labelId: 'ck.action.displaceTarget', params: { from: index }, field: 'to' };
  }
  return null;
}

/** Public victory points the module adds for a player. */
export function citiesKnightsPoints(view: Pick<GameView, 'modules' | 'players'> | null | undefined, playerId: string): { metropolises: number; defenders: number; progress: number } {
  const ck = citiesKnightsView(view);
  if (!ck) return { metropolises: 0, defenders: 0, progress: 0 };
  const metropolises = TRACKS.filter((track) => ck.metropolises[track]?.player === playerId).length * METROPOLIS_POINTS;
  const defenders = view?.players.find((candidate) => candidate.id === playerId)?.defenders ?? 0;
  return { metropolises, defenders, progress: ck.progressVp[playerId]?.length ?? 0 };
}

/** Strength of a player's active knights (their share of the defence). */
export function activeStrength(ck: CitiesKnightsModuleView, playerId: string): number {
  return ck.knights.filter((knight) => knight.player === playerId && knight.active).reduce((sum, knight) => sum + knight.level, 0);
}

/** The deck each progress card belongs to (CK25 pp. 13–16). */
export const PROGRESS_TRACK: Readonly<Record<string, Track>> = {
  alchemy: 'science', crane: 'science', engineering: 'science', invention: 'science', irrigation: 'science',
  medicine: 'science', mining: 'science', printing: 'science', roadBuilding: 'science', smithing: 'science',
  commercialHarbor: 'trade', guildDues: 'trade', merchant: 'trade', merchantFleet: 'trade', resourceMonopoly: 'trade', tradeMonopoly: 'trade',
  constitution: 'politics', diplomacy: 'politics', encouragement: 'politics', espionage: 'politics', intrigue: 'politics',
  sabotage: 'politics', taxation: 'politics', treason: 'politics', wedding: 'politics',
};

/** Victory-point progress cards, revealed at once. */
export const VP_PROGRESS = new Set(['printing', 'constitution']);

/** The knight a board preview should show for a knight command at `vertex`. */
export function knightGhost(ck: CitiesKnightsModuleView | null, commandType: string | null | undefined, vertex: number, params?: Record<string, unknown>): { level: KnightLevel; active: boolean } {
  const at = (index: unknown) => ck?.knights.find((knight) => knight.vertex === index);
  switch (commandType) {
    case 'knight.promote': {
      const knight = at(vertex);
      return { level: Math.min(3, (knight?.level ?? 1) + 1) as KnightLevel, active: knight?.active ?? false };
    }
    case 'knight.activate': return { level: at(vertex)?.level ?? 1, active: true };
    case 'knight.move':
    case 'knight.displace':
    case 'knight.retreat': {
      const knight = at(params?.from) ?? at(params?.vertex);
      return { level: knight?.level ?? 1, active: commandType === 'knight.retreat' ? (knight?.active ?? false) : false };
    }
    case 'knight.recruit': return { level: 1, active: false };
    default: return { level: at(vertex)?.level ?? 1, active: at(vertex)?.active ?? false };
  }
}

export const COMMODITY_KINDS: readonly Commodity[] = ['paper', 'cloth', 'coin'];

export function isCommodityCard(card: string): card is Commodity {
  return (COMMODITY_KINDS as readonly string[]).includes(card);
}
