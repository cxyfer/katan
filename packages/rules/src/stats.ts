/**
 * Post-game statistics (賽後結算數據).
 *
 * The public log is capped, so totals cannot be rebuilt from events at the end
 * of a long game. The engine instead accumulates counters inside the snapshot
 * as transitions happen. Several counters describe hidden information (drawn
 * development cards, stolen resource identities, hidden victory points), so
 * the projection only publishes them once the game has a result.
 */

import { RESOURCES, type DevCardType, type GameState, type PlayerState, type Resource } from './types.ts';

export type ResourceCounts = Record<Resource, number>;

export const DEV_CARD_TYPES: readonly DevCardType[] = [
  'knight',
  'victoryPoint',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
];

/** Base-game card types; expansion cards are counted only once seen. */
export type BaseDevCardType = 'knight' | 'victoryPoint' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';
export type PlayableDevCardType = Exclude<BaseDevCardType, 'victoryPoint'>;

export interface PlayerStats {
  /** Action windows opened for this player. */
  turns: number;
  /** Dice rolls made by this player, and how many of them were a 7. */
  rolls: number;
  sevens: number;
  /** Resources received from dice production. */
  produced: ResourceCounts;
  /** Resources received from the second setup settlement. */
  startingResources: ResourceCounts;
  /** Resources taken from the bank with Year of Plenty. */
  yearOfPlenty: ResourceCounts;
  /** Resources collected with Monopoly, and lost to other players' Monopoly. */
  monopolyGained: ResourceCounts;
  monopolyLost: ResourceCounts;
  /** Resources stolen from opponents, and stolen from this player. */
  stolen: ResourceCounts;
  robbed: ResourceCounts;
  /** Resources discarded on a 7. */
  discarded: ResourceCounts;
  /** Resources paid for roads, settlements, cities and development cards. */
  spent: ResourceCounts;
  roadsBuilt: number;
  freeRoadsBuilt: number;
  settlementsBuilt: number;
  citiesBuilt: number;
  devCardsBought: Record<BaseDevCardType, number> & Partial<Record<DevCardType, number>>;
  devCardsPlayed: Record<PlayableDevCardType, number> & Partial<Record<Exclude<DevCardType, 'victoryPoint'>, number>>;
  bankTrades: number;
  bankGiven: ResourceCounts;
  bankReceived: ResourceCounts;
  playerTrades: number;
  tradeGiven: ResourceCounts;
  tradeReceived: ResourceCounts;
  /** Times this player moved the robber (by a 7 or a knight). */
  robberMoves: number;
  /** Rolls on which the robber blocked at least one of this player's buildings. */
  blockedRolls: number;
  /** Production withheld from this player by the robber. */
  blockedResources: ResourceCounts;
  /** Production withheld because the bank ran short. */
  starvedResources: ResourceCounts;
  /** Largest hand held at the end of any transition. */
  peakHand: number;
}

export interface GameStats {
  /**
   * False when the counters were initialised after the game began (a snapshot
   * written before statistics existed); totals then cover only part of it.
   */
  complete: boolean;
  /** Turns started after setup. */
  turns: number;
  /** Count of dice totals; index = total (0 and 1 unused). */
  dice: number[];
  /**
   * Victory points (hidden included) in `state.players` order, sampled at the
   * start of every round (when seat 0 begins a turn) and once at the end.
   */
  timeline: number[][];
  players: Record<string, PlayerStats>;
}

export function zeroResources(): ResourceCounts {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

function zeroDevCards(): Record<BaseDevCardType, number> {
  return { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 };
}

export function createPlayerStats(): PlayerStats {
  return {
    turns: 0,
    rolls: 0,
    sevens: 0,
    produced: zeroResources(),
    startingResources: zeroResources(),
    yearOfPlenty: zeroResources(),
    monopolyGained: zeroResources(),
    monopolyLost: zeroResources(),
    stolen: zeroResources(),
    robbed: zeroResources(),
    discarded: zeroResources(),
    spent: zeroResources(),
    roadsBuilt: 0,
    freeRoadsBuilt: 0,
    settlementsBuilt: 0,
    citiesBuilt: 0,
    devCardsBought: zeroDevCards(),
    devCardsPlayed: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
    bankTrades: 0,
    bankGiven: zeroResources(),
    bankReceived: zeroResources(),
    playerTrades: 0,
    tradeGiven: zeroResources(),
    tradeReceived: zeroResources(),
    robberMoves: 0,
    blockedRolls: 0,
    blockedResources: zeroResources(),
    starvedResources: zeroResources(),
    peakHand: 0,
  };
}

export function createGameStats(players: readonly PlayerState[], complete: boolean): GameStats {
  const stats: GameStats = {
    complete,
    turns: 0,
    dice: Array.from({ length: 13 }, () => 0),
    timeline: [],
    players: {},
  };
  for (const player of players) stats.players[player.id] = createPlayerStats();
  return stats;
}

/**
 * The counters of a game, created on first use. Snapshots persisted before
 * statistics existed get zeroed counters flagged as incomplete, so recovery
 * keeps working and the result screen can say the totals are partial.
 */
export function ensureStats(state: GameState): GameStats {
  if (!state.stats) {
    state.stats = createGameStats(state.players, false);
  }
  for (const player of state.players) {
    state.stats.players[player.id] ??= createPlayerStats();
  }
  return state.stats;
}

export function playerStats(state: GameState, playerId: string): PlayerStats {
  const stats = ensureStats(state);
  return (stats.players[playerId] ??= createPlayerStats());
}

export function addResource(counts: ResourceCounts, resource: Resource, amount = 1): void {
  counts[resource] += amount;
}

export function addResources(counts: ResourceCounts, amounts: Partial<Record<Resource, number>>): void {
  for (const resource of RESOURCES) counts[resource] += amounts[resource] ?? 0;
}

export function sumResources(counts: Partial<Record<Resource, number>>): number {
  return RESOURCES.reduce((sum, resource) => sum + (counts[resource] ?? 0), 0);
}

export function cloneGameStats(stats: GameStats): GameStats {
  return JSON.parse(JSON.stringify(stats)) as GameStats;
}
