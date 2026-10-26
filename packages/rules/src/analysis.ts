/**
 * Board analysis: connectivity, awards, scoring, harbor rates, legality and
 * production. These helpers are pure functions of a `GameState` so that both
 * the rules engine and the server's projections share one source of truth.
 */

import { getTopology } from './topology-registry.ts';
import { verticesOfHex, type BoardTopology } from './topology.ts';
import {
  RESOURCES,
  TERRAIN_RESOURCE,
  type GameState,
  type PlayerState,
  type Resource,
  type Terrain,
} from './types.ts';

export function topologyOf(state: GameState): BoardTopology {
  return getTopology(state.board.layout.topologyId);
}

export function playerById(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

export function playerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((p) => p.id === playerId);
}

export function seatOf(state: GameState, playerId: string): number {
  const index = playerIndex(state, playerId);
  return index < 0 ? -1 : state.players[index]!.seat;
}

export function countBuildings(state: GameState, playerId: string, kind: 'settlement' | 'city'): number {
  let count = 0;
  for (const building of state.board.buildings) {
    if (!building || building.player !== playerId) continue;
    if (kind === 'city' ? building.city : !building.city) count++;
  }
  return count;
}

export function countRoads(state: GameState, playerId: string): number {
  let count = 0;
  for (const road of state.board.roads) if (road && road.player === playerId) count++;
  return count;
}

/** Vertices adjacent to `vertex` (connected by one edge). */
export function neighborsOfVertex(topo: BoardTopology, vertex: number): number[] {
  return topo.vertices[vertex]!.edges.map((edge) => {
    const [a, b] = topo.edges[edge]!.vertices;
    return a === vertex ? b : a;
  });
}

export function isBlockedFor(state: GameState, vertex: number, playerId: string): boolean {
  const building = state.board.buildings[vertex];
  return !!building && building.player !== playerId;
}

/**
 * Longest route length for a player. Opponent buildings interrupt a route;
 * the route may not reuse a road, and cycles do not add length.
 */
export function longestRouteLength(state: GameState, playerId: string, includeShips = false): number {
  const topo = topologyOf(state);
  const incident = new Map<number, number[]>();
  const usable: number[] = [];
  state.board.roads.forEach((road, edge) => {
    if (!road || road.player !== playerId) return;
    if (road.ship && !includeShips) return;
    usable.push(edge);
    for (const vertex of topo.edges[edge]!.vertices) {
      const list = incident.get(vertex) ?? [];
      list.push(edge);
      incident.set(vertex, list);
    }
  });
  if (usable.length === 0) return 0;

  const blocked = new Set<number>();
  for (const edge of usable) {
    for (const vertex of topo.edges[edge]!.vertices) {
      if (isBlockedFor(state, vertex, playerId)) blocked.add(vertex);
    }
  }

  const used = new Set<number>();
  const walk = (vertex: number): number => {
    let best = 0;
    for (const edge of incident.get(vertex) ?? []) {
      if (used.has(edge)) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      used.add(edge);
      const length = 1 + (blocked.has(next) ? 0 : walk(next));
      used.delete(edge);
      if (length > best) best = length;
    }
    return best;
  };

  let longest = 0;
  for (const vertex of incident.keys()) {
    if (blocked.has(vertex)) continue;
    const length = walk(vertex);
    if (length > longest) longest = length;
  }
  return longest;
}

export interface AwardRules {
  minLongestRoad: number;
  minLargestArmy: number;
  longestRouteIncludesShips: boolean;
  retainLargestArmy: boolean;
}

export const BASE_AWARD_RULES: AwardRules = {
  minLongestRoad: 5,
  minLargestArmy: 3,
  longestRouteIncludesShips: false,
  retainLargestArmy: true,
};

/**
 * Recomputes Longest Road / Largest Army holders.
 *
 * Incumbent retention: a challenger must strictly exceed the current holder
 * (or the holder must have lost eligibility) to take the award.
 */
export function recomputeAwards(state: GameState, rules: AwardRules = BASE_AWARD_RULES): void {
  for (const player of state.players) {
    player.longestRoadLength = longestRouteLength(
      state,
      player.id,
      rules.longestRouteIncludesShips,
    );
  }

  const roadCandidates = state.players.filter((p) => p.longestRoadLength >= rules.minLongestRoad);
  const currentRoad = state.awards.longestRoad;
  const currentRoadHolder = currentRoad ? playerById(state, currentRoad) : undefined;
  if (!currentRoadHolder || currentRoadHolder.longestRoadLength < rules.minLongestRoad) {
    state.awards.longestRoad = bestBy(
      roadCandidates,
      (p) => p.longestRoadLength,
      currentRoad,
    );
  } else {
    const challenger = roadCandidates.find((p) => p.longestRoadLength > currentRoadHolder.longestRoadLength);
    state.awards.longestRoad = challenger ? challenger.id : currentRoadHolder.id;
  }

  const armyCandidates = state.players.filter((p) => p.playedKnights >= rules.minLargestArmy);
  const currentArmy = state.awards.largestArmy;
  const currentArmyHolder = currentArmy ? playerById(state, currentArmy) : undefined;
  if (!currentArmyHolder || currentArmyHolder.playedKnights < rules.minLargestArmy) {
    state.awards.largestArmy = bestBy(armyCandidates, (p) => p.playedKnights, currentArmy);
  } else {
    const challenger = armyCandidates.find((p) => p.playedKnights > currentArmyHolder.playedKnights);
    state.awards.largestArmy = challenger ? challenger.id : currentArmyHolder.id;
  }
}

function bestBy(
  candidates: PlayerState[],
  metric: (player: PlayerState) => number,
  incumbent: string | null,
): string | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  for (const candidate of candidates) {
    if (metric(candidate) > metric(best)) best = candidate;
  }
  const tied = candidates.filter((candidate) => metric(candidate) === metric(best));
  if (tied.length > 1) {
    const incumbentStillEligible = tied.find((candidate) => candidate.id === incumbent);
    if (incumbentStillEligible) return incumbentStillEligible.id;
    // Deterministic fallback: the earliest seat among the tied leaders.
    return tied.slice().sort((a, b) => a.seat - b.seat)[0]!.id;
  }
  return best.id;
}

export interface ScoreOptions {
  includeHidden: boolean;
  awardPoints?: { longestRoad: number; largestArmy: number };
}

export function scoreOf(state: GameState, playerId: string, options: ScoreOptions): number {
  const player = playerById(state, playerId);
  if (!player) return 0;
  const awardPoints = options.awardPoints ?? { longestRoad: 2, largestArmy: 2 };
  let score = 0;
  for (const building of state.board.buildings) {
    if (!building || building.player !== playerId) continue;
    score += building.city ? 2 : 1;
  }
  if (state.awards.longestRoad === playerId) score += awardPoints.longestRoad;
  if (state.awards.largestArmy === playerId) score += awardPoints.largestArmy;
  score += player.bonusPoints;
  if (options.includeHidden) {
    // Victory-point cards count for their owner from the moment they are drawn,
    // including cards bought on the current turn.
    score += player.devCards.filter((card) => card === 'victoryPoint').length;
    score += player.newDevCards.filter((card) => card === 'victoryPoint').length;
    score += player.hiddenBonusPoints;
  }
  return score;
}

/** Harbor trade rates available to a player, keyed by resource. */
export function harborRates(state: GameState, playerId: string): Record<Resource, number> {
  const topo = topologyOf(state);
  const rates: Record<Resource, number> = {
    lumber: 4,
    brick: 4,
    wool: 4,
    grain: 4,
    ore: 4,
  };
  for (const harbor of state.board.layout.harbors) {
    const edge = topo.edges[harbor.edge];
    if (!edge) continue;
    const owned = edge.vertices.some((vertex) => {
      const building = state.board.buildings[vertex];
      return !!building && building.player === playerId;
    });
    if (!owned) continue;
    if (harbor.type === 'generic') {
      for (const resource of RESOURCES) rates[resource] = Math.min(rates[resource], 3);
    } else {
      rates[harbor.type] = Math.min(rates[harbor.type], 2);
    }
  }
  return rates;
}

export function totalResources(player: PlayerState): number {
  return RESOURCES.reduce((sum, resource) => sum + player.resources[resource], 0);
}

export interface ProductionShare {
  playerId: string;
  amount: number;
  vertex: number;
}

export interface ProductionResult {
  terrain: Terrain;
  resource: Resource | null;
  hex: number;
  /** Entitlements before the bank limit was applied. */
  entitlements: ProductionShare[];
  /** Amounts actually granted. */
  granted: ProductionShare[];
  /** True when the bank could not satisfy everyone and no one was paid. */
  starved: boolean;
}

/**
 * Production for one hex/terrain at the given total.
 * Bank shortage rule (B25 p.6): if the bank cannot pay every entitled player,
 * nobody receives that resource; if exactly one player is entitled, they take
 * whatever remains.
 */
export function productionForHex(
  state: GameState,
  hex: number,
  diceTotal: number,
): ProductionResult | null {
  const layout = state.board.layout;
  const terrain = layout.terrain[hex];
  if (!terrain) return null;
  const resource = TERRAIN_RESOURCE[terrain] ?? null;
  if (!resource) return null;
  if (layout.numbers[hex] !== diceTotal) return null;
  if (state.board.robber === hex) {
    return { terrain, resource, hex, entitlements: [], granted: [], starved: false };
  }

  const topo = topologyOf(state);
  const entitlements: ProductionShare[] = [];
  for (const vertex of verticesOfHexIndex(topo, hex)) {
    const building = state.board.buildings[vertex];
    if (!building) continue;
    entitlements.push({ playerId: building.player, amount: building.city ? 2 : 1, vertex });
  }

  const demand = entitlements.reduce((sum, share) => sum + share.amount, 0);
  const available = state.bank[resource];
  if (demand <= available) {
    return { terrain, resource, hex, entitlements, granted: entitlements, starved: false };
  }
  const distinct = new Set(entitlements.map((share) => share.playerId));
  if (distinct.size === 1 && entitlements.length > 0) {
    const only = entitlements[0]!;
    const amount = Math.min(only.amount, available);
    return {
      terrain,
      resource,
      hex,
      entitlements,
      granted: amount > 0 ? [{ ...only, amount }] : [],
      starved: false,
    };
  }
  return { terrain, resource, hex, entitlements, granted: [], starved: true };
}

function verticesOfHexIndex(topo: BoardTopology, hex: number): number[] {
  return verticesOfHex(topo, hex);
}

/** Total production for a dice roll, applying bank limits per resource. */
export function productionForRoll(state: GameState, diceTotal: number): ProductionResult[] {
  const results: ProductionResult[] = [];
  for (let hex = 0; hex < state.board.layout.terrain.length; hex++) {
    const result = productionForHex(state, hex, diceTotal);
    if (result) results.push(result);
  }
  return results;
}
