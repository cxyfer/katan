/**
 * Exploring an unexplored hex (EP25 p. 12, EP25-M p. 7).
 *
 * The region's tiles are a multiset; the revealed tile is drawn from it with
 * `ctx.rng` at the moment of discovery, as are its number disc, the fish shoal
 * number and the spice farm's ability. A shuffled face-down region gives every
 * remaining tile the same chance, so the draw is the same game — but no
 * unrevealed tile exists anywhere in the state before it is explored.
 */

import type { EpRegion, EpTile } from '../../explorers-pirates-boards.ts';
import { epScenario } from '../../explorers-pirates-boards.ts';
import type { GameState, Resource, Terrain } from '../../types.ts';
import type { ModuleContext } from '../types.ts';
import { gainGold } from './core.ts';
import { epState } from './state.ts';

const TILE_ORDER: readonly EpTile[] = ['sea', 'hills', 'forest', 'pasture', 'fields', 'mountains', 'gold', 'shoal', 'spice'];

const TILE_RESOURCE: Partial<Record<EpTile, Resource>> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
};

/** Gold for discovering a hex that produces no resource card (EP25 p. 12). */
export const DISCOVERY_GOLD = 2;

function drawIndex<T>(items: T[], ctx: ModuleContext): T {
  const index = ctx.rng.int(items.length);
  return items.splice(index, 1)[0]!;
}

function drawTile(tiles: Partial<Record<EpTile, number>>, ctx: ModuleContext): EpTile {
  const total = TILE_ORDER.reduce((sum, tile) => sum + (tiles[tile] ?? 0), 0);
  if (total <= 0) throw new Error('explorersPirates: region has no tiles left');
  let pick = ctx.rng.int(total);
  for (const tile of TILE_ORDER) {
    const n = tiles[tile] ?? 0;
    if (pick < n) {
      tiles[tile] = n - 1;
      return tile;
    }
    pick -= n;
  }
  throw new Error('unreachable');
}

/** Reveals one unexplored hex for the exploring player and pays the reward. */
export function revealHex(state: GameState, hex: number, playerId: string, ctx: ModuleContext): void {
  const slot = epState(state);
  const at = slot.fog.findIndex((entry) => entry.hex === hex);
  if (at < 0) return;
  const region: EpRegion = slot.fog[at]!.region;
  slot.fog.splice(at, 1);
  const pool = slot.pools[region];
  const tile = drawTile(pool.tiles, ctx);
  const layout = state.board.layout;
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  let reward: { resource: Resource } | { gold: number } | null = null;
  const details: Record<string, unknown> = {};

  const resource = TILE_RESOURCE[tile];
  if (resource) {
    layout.terrain[hex] = tile as Terrain;
    const number = drawIndex(pool.discs, ctx);
    layout.numbers[hex] = number;
    details.number = number;
    if (state.bank[resource] > 0) {
      state.bank[resource] -= 1;
      player.resources[resource] += 1;
      reward = { resource };
    }
  } else {
    if (tile === 'gold') {
      layout.terrain[hex] = 'gold';
      slot.sites.push({ hex, kind: 'lair', crews: [], captured: false });
    } else if (tile === 'spice') {
      // A spice farm is land that produces nothing (`desert` terrain).
      layout.terrain[hex] = 'desert';
      const ability = drawIndex(pool.abilities, ctx);
      const bonus = ability === 'pirateBonus' ? epScenario(slot.scenario).regions[region].pirateBonus : null;
      slot.sites.push({ hex, kind: 'spice', ability, bonus, crews: [], sacks: state.players.map((entry) => entry.id) });
      details.ability = ability;
      if (bonus !== null) details.bonus = bonus;
    } else if (tile === 'shoal') {
      const number = drawIndex(pool.shoals, ctx);
      slot.sites.push({ hex, kind: 'shoal', number, fish: false });
      details.shoal = number;
    }
    const paid = gainGold(slot, playerId, DISCOVERY_GOLD);
    if (paid > 0) reward = { gold: paid };
  }
  ctx.kit.emit(state, 'ep.explored', { playerId, hex, region, tile, ...details, reward });
}
