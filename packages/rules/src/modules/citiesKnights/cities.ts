/**
 * City walls, city improvements and metropolises (CK25 pp. 3, 8; CK-FAQ city
 * improvements and metropolises).
 *
 * - Wall (2 brick): under an own city without one; at most 3 built; +2 to the
 *   7 discard limit each; lost with the city when it is pillaged.
 * - Improvement: level n of a track costs n of the track's commodity; needs
 *   at least one city on the board; one level at a time, any number per
 *   turn, up to level 5. Level 3 grants the track's ability.
 * - Metropolis: the first player to reach level 4 takes the track's
 *   metropolis; the first to reach level 5 takes it for good, also from a
 *   level-4 holder. It stands on one of the owner's cities, one metropolis
 *   per city; 2 VP; never pillaged. Without a city free for it the level
 *   that would award it cannot be bought. That restriction is read as
 *   applying only when the purchase awards the metropolis (explicit
 *   interpretation, docs/FIDELITY.md).
 * - A pillaged city lying on its side must be upgraded before any other
 *   settlement (CK25 p. 11; `allowCity`).
 */

import { playerById } from '../../analysis.ts';
import type { CommandOutcome, GameState } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import {
  MAX_LEVEL,
  MAX_WALLS,
  METROPOLIS_LEVEL,
  PERMANENT_METROPOLIS_LEVEL,
  TRACKS,
  TRACK_COMMODITY,
  WALL_COST,
  type Track,
} from './constants.ts';
import { ckState, ckView, metropolisAt } from './state.ts';

function requireAction(state: GameState, actorId: string, ctx: ModuleContext): CommandOutcome | null {
  const { kit } = ctx;
  if (kit.currentPlayer(state).id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  if (state.pending) return kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  return null;
}

export function ownCities(state: GameState, playerId: string): number[] {
  const out: number[] = [];
  state.board.buildings.forEach((building, vertex) => {
    if (building?.city && building.player === playerId) out.push(vertex);
  });
  return out;
}

export function wallsOf(state: GameState, playerId: string): number {
  return ckView(state).walls.filter((vertex) => state.board.buildings[vertex]?.player === playerId).length;
}

/** Cities where the player may build a wall now (ignoring cost). */
export function wallSites(state: GameState, playerId: string): number[] {
  if (wallsOf(state, playerId) >= MAX_WALLS) return [];
  const walls = ckView(state).walls;
  return ownCities(state, playerId).filter((vertex) => !walls.includes(vertex));
}

/** `build.wall { vertex }` */
export function buildWall(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  const vertex = command.vertex;
  if (wallsOf(state, actorId) >= MAX_WALLS) return kit.fail('E_NO_PIECES', { piece: 'wall' });
  if (typeof vertex !== 'number' || !wallSites(state, actorId).includes(vertex)) return kit.fail('E_ILLEGAL_TARGET', { vertex });
  const player = playerById(state, actorId)!;
  if (!kit.canAfford(player, WALL_COST)) return kit.fail('E_INSUFFICIENT_RESOURCES', { cost: WALL_COST });
  kit.payBuild(state, player, WALL_COST);
  const slot = ckState(state);
  slot.walls.push(vertex);
  player.cityWalls = wallsOf(state, actorId);
  kit.emit(state, 'ck.wallBuilt', { playerId: actorId, vertex });
  return kit.accept(state);
}

/** Cities a metropolis could stand on: own cities without one. */
export function metropolisSites(state: GameState, playerId: string): number[] {
  return ownCities(state, playerId).filter((vertex) => metropolisAt(state, vertex) === null);
}

/** Whether buying the next level of a track would award its metropolis. */
export function awardsMetropolis(state: GameState, playerId: string, track: Track): boolean {
  const next = playerById(state, playerId)!.improvements[track] + 1;
  if (next < METROPOLIS_LEVEL) return false;
  const holder = ckView(state).metropolises[track];
  if (!holder) return true;
  if (holder.player === playerId) return false;
  // Only reaching level 5 first takes it from a level-4 holder.
  return next === PERMANENT_METROPOLIS_LEVEL && playerById(state, holder.player)!.improvements[track] < PERMANENT_METROPOLIS_LEVEL;
}

export interface ImprovementOption {
  track: Track;
  level: number;
  cost: number;
  commodity: string;
  /** The purchase awards the metropolis; `sites` lists where it may go. */
  metropolis: boolean;
  sites: number[];
  /** Blocking reason, if any (`no-city`, `max-level`, `no-site`, `cost`). */
  blocked: string | null;
}

export function improvementOptions(state: GameState, playerId: string): ImprovementOption[] {
  const player = playerById(state, playerId)!;
  const hasCity = ownCities(state, playerId).length > 0;
  return TRACKS.map((track) => {
    const level = player.improvements[track] + 1;
    const commodity = TRACK_COMMODITY[track];
    const metropolis = level <= MAX_LEVEL && awardsMetropolis(state, playerId, track);
    const sites = metropolis ? metropolisSites(state, playerId) : [];
    let blocked: string | null = null;
    if (level > MAX_LEVEL) blocked = 'max-level';
    else if (!hasCity) blocked = 'no-city';
    else if (metropolis && sites.length === 0) blocked = 'no-site';
    else if (player.commodities[commodity] < level) blocked = 'cost';
    return { track, level, cost: level, commodity, metropolis, sites, blocked };
  });
}

/** `city.improve { track, vertex? }` — `vertex` places an awarded metropolis. */
export function improveCity(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  const track = command.track as Track;
  if (!TRACKS.includes(track)) return kit.fail('E_INVALID_SELECTION', { track });
  const option = improvementOptions(state, actorId).find((candidate) => candidate.track === track)!;
  if (option.blocked === 'max-level') return kit.fail('E_IMPROVEMENT_MAX', { track });
  if (option.blocked === 'no-city') return kit.fail('E_IMPROVEMENT_NEEDS_CITY', { track });
  if (option.blocked === 'no-site') return kit.fail('E_METROPOLIS_NO_CITY', { track });
  const player = playerById(state, actorId)!;
  const commodity = TRACK_COMMODITY[track];
  if (player.commodities[commodity] < option.cost) {
    return kit.fail('E_INSUFFICIENT_RESOURCES', { cost: { [commodity]: option.cost } });
  }
  let vertex: number | null = null;
  if (option.metropolis) {
    const requested = command.vertex;
    if (typeof requested === 'number') {
      if (!option.sites.includes(requested)) return kit.fail('E_ILLEGAL_TARGET', { vertex: requested });
      vertex = requested;
    } else if (option.sites.length === 1) {
      vertex = option.sites[0]!;
    } else {
      return kit.fail('E_INVALID_SELECTION', { reason: 'metropolis-site-required', sites: option.sites });
    }
  }
  player.commodities[commodity] -= option.cost;
  state.commodityBank[commodity] += option.cost;
  player.improvements[track] = option.level;
  kit.emit(state, 'ck.cityImproved', { playerId: actorId, track, level: option.level, commodity, cost: option.cost });
  if (vertex !== null) {
    const slot = ckState(state);
    const previous = slot.metropolises[track];
    slot.metropolises[track] = { player: actorId, vertex };
    kit.emit(state, 'ck.metropolisAwarded', {
      playerId: actorId,
      track,
      vertex,
      permanent: option.level >= PERMANENT_METROPOLIS_LEVEL,
      ...(previous ? { from: previous.player, fromVertex: previous.vertex } : {}),
    });
  }
  kit.afterBoardChange(state);
  kit.checkVictory(state);
  return kit.accept(state);
}

/** A toppled city must be upgraded before any other settlement (CK25 p. 11). */
export function allowCity(state: GameState, playerId: string, vertex: number): boolean {
  const toppled = ckView(state).toppled.filter((candidate) => state.board.buildings[candidate]?.player === playerId);
  return toppled.length === 0 || toppled.includes(vertex);
}
