/**
 * Board analysis: connectivity, awards, scoring, harbor rates, legality and
 * production. These helpers are pure functions of a `GameState` so that both
 * the rules engine and the server's projections share one source of truth.
 */

import { rulesModulesOf } from './modules/registry.ts';
import { getProfile } from './profiles.ts';
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

/** True for every terrain hex (desert and gold included), false for sea. */
export function isLandHex(state: GameState, hex: number): boolean {
  const terrain = state.board.layout.terrain[hex];
  return terrain !== undefined && terrain !== 'sea';
}

/** Buildings need land: an intersection touching at least one terrain hex. */
export function isLandVertex(state: GameState, vertex: number): boolean {
  const info = topologyOf(state).vertices[vertex];
  return !!info && info.hexes.some((hex) => isLandHex(state, hex));
}

/** Roads need land on at least one side (inland paths and coasts). */
export function isLandEdge(state: GameState, edge: number): boolean {
  const info = topologyOf(state).edges[edge];
  return !!info && info.hexes.some((hex) => isLandHex(state, hex));
}

/**
 * Ships use edges of sea hexes. The topology's boundary edges are the inner
 * edge of the frame, which is sea as well (Seafarers FAQ, frame pieces).
 */
export function isSeaEdge(state: GameState, edge: number): boolean {
  const info = topologyOf(state).edges[edge];
  return !!info && (info.hexes.length === 1 || info.hexes.some((hex) => !isLandHex(state, hex)));
}

export function isBlockedFor(state: GameState, vertex: number, playerId: string): boolean {
  const building = state.board.buildings[vertex];
  return !!building && building.player !== playerId;
}

/**
 * Longest route length for a player. Opponent buildings interrupt a route;
 * the route may not reuse a road, and cycles do not add length. With ships
 * (Seafarers' Longest Trade Route) a road and a ship only continue each
 * other at one of the player's own buildings (SF25 p. 2).
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
  const ownBuilding = (vertex: number) => state.board.buildings[vertex]?.player === playerId;
  const walk = (vertex: number, arrivedByShip: boolean | null): number => {
    let best = 0;
    for (const edge of incident.get(vertex) ?? []) {
      if (used.has(edge)) continue;
      const ship = state.board.roads[edge]!.ship;
      if (arrivedByShip !== null && ship !== arrivedByShip && !ownBuilding(vertex)) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      used.add(edge);
      const length = 1 + (blocked.has(next) ? 0 : walk(next, ship));
      used.delete(edge);
      if (length > best) best = length;
    }
    return best;
  };

  let longest = 0;
  for (const vertex of incident.keys()) {
    if (blocked.has(vertex)) continue;
    const length = walk(vertex, null);
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
  const profile = getProfile(state.profileId);
  if (profile) {
    for (const module of rulesModulesOf(profile)) {
      if (module.score) score += module.score(state, playerId, options, { profile });
    }
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
  /** Entitlements withheld because the robber sits on the hex. */
  blocked: ProductionShare[];
}

/**
 * Production for one hex/terrain at the given total.
 * Bank shortage rule (B25 p.6): if the bank cannot pay every entitled player,
 * nobody receives that resource; if exactly one player is entitled, they take
 * whatever remains. Called alone this judges the hex in isolation; use
 * `productionForRoll` to apply the rule across all hexes of a resource.
 */
export function productionForHex(
  state: GameState,
  hex: number,
  diceTotal: number,
): ProductionResult | null {
  const result = rawProductionForHex(state, hex, diceTotal);
  if (!result) return null;
  return applyBankLimit([result], state.bank[result.resource!])[0]!;
}

/** 單一地形格的原始應得量（尚未套用銀行上限）。 */
function rawProductionForHex(
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
  const topo = topologyOf(state);
  const entitlements: ProductionShare[] = [];
  for (const vertex of verticesOfHexIndex(topo, hex)) {
    const building = state.board.buildings[vertex];
    if (!building) continue;
    entitlements.push({ playerId: building.player, amount: building.city ? 2 : 1, vertex });
  }
  if (state.board.robber === hex) {
    return { terrain, resource, hex, entitlements: [], granted: [], starved: false, blocked: entitlements };
  }
  return { terrain, resource, hex, entitlements, granted: [], starved: false, blocked: [] };
}

/**
 * 對同一資源的所有地形格一次套用銀行不足規則：合計需求超過庫存時，
 * 多名玩家則全部不發；僅一名玩家則依序發到庫存用完為止。
 */
function applyBankLimit(results: ProductionResult[], available: number): ProductionResult[] {
  const all = results.flatMap((result) => result.entitlements);
  const demand = all.reduce((sum, share) => sum + share.amount, 0);
  if (demand <= available) {
    return results.map((result) => ({ ...result, granted: result.entitlements, starved: false }));
  }
  if (new Set(all.map((share) => share.playerId)).size === 1) {
    let remaining = available;
    return results.map((result) => {
      const granted: ProductionShare[] = [];
      for (const share of result.entitlements) {
        const amount = Math.min(share.amount, remaining);
        remaining -= amount;
        if (amount > 0) granted.push({ ...share, amount });
      }
      return { ...result, granted, starved: false };
    });
  }
  return results.map((result) => ({
    ...result,
    granted: [],
    starved: result.entitlements.length > 0,
  }));
}

function verticesOfHexIndex(topo: BoardTopology, hex: number): number[] {
  return verticesOfHex(topo, hex);
}

/**
 * Total production for a dice roll. The bank limit is applied once per
 * resource across every hex producing it, not hex by hex.
 */
export function productionForRoll(state: GameState, diceTotal: number): ProductionResult[] {
  const raw: ProductionResult[] = [];
  for (let hex = 0; hex < state.board.layout.terrain.length; hex++) {
    const result = rawProductionForHex(state, hex, diceTotal);
    if (result) raw.push(result);
  }
  const limited = new Map<number, ProductionResult>();
  for (const resource of RESOURCES) {
    const group = raw.filter((result) => result.resource === resource);
    if (group.length === 0) continue;
    for (const result of applyBankLimit(group, state.bank[resource])) limited.set(result.hex, result);
  }
  // 維持依地形格索引排序的輸出順序。
  return raw.map((result) => limited.get(result.hex)!);
}
