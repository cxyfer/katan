/**
 * Heading for New Shores island rules (SF25 p. 4):
 * - starting settlements go on the main island;
 * - each player earns 2 VP for their own first settlement on each small
 *   island, whether or not someone else settled there before. The bonus is
 *   kept (the tokens lie under that settlement) and is public.
 */

import { isLandHex, playerById, topologyOf } from '../../analysis.ts';
import { MAIN_ISLAND } from '../../seafarers-boards.ts';
import type { GameState } from '../../types.ts';
import type { ModuleContext, ModuleViewContext } from '../types.ts';
import { seafarersState, type SeafarersState } from './state.ts';

export const ISLAND_BONUS = 2;

/** Island ids of the land hexes around an intersection. */
export function islandsAt(state: GameState, vertex: number): number[] {
  const info = topologyOf(state).vertices[vertex];
  if (!info) return [];
  const out = new Set<number>();
  for (const hex of info.hexes) {
    if (!isLandHex(state, hex)) continue;
    const island = state.board.layout.islands[hex] ?? 0;
    if (island > 0) out.add(island);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 島嶼獎勵規則表（spec 2026-11-22-seafarers-scenarios.md §5.1），依 profile 的
 * scenario 查表；`sf-2025.2` 的 new-shores 維持原行為（主島不算、2 分）。
 * - `points`：每位玩家每座島第一個村落的分數。
 * - `skip`：不計分的島。`main` 為 `MAIN_ISLAND`（S4 的外地、S8 的小島本質上都是「非主島」，
 *   由各劇本 layout 的島編號決定）；`home` 為該玩家設置階段村落碰到的島（S2、S9）。
 * 沒有登記的劇本（S3、S5、S6、S7）沒有獎勵。後續切片只需補 layout 的島編號。
 */
export interface IslandBonusRule {
  points: number;
  skip: 'main' | 'home';
}

export const ISLAND_BONUS_RULES: Readonly<Record<string, IslandBonusRule>> = {
  'new-shores': { points: ISLAND_BONUS, skip: 'main' },
  'four-islands': { points: 2, skip: 'home' },
  'through-the-desert': { points: 2, skip: 'main' },
  'wonders-of-catan': { points: 1, skip: 'main' },
  'new-world': { points: 1, skip: 'home' },
};

export function islandBonusRule(ctx: ModuleViewContext): IslandBonusRule | undefined {
  const scenario = ctx.profile.scenario;
  return scenario ? ISLAND_BONUS_RULES[scenario] : undefined;
}

/**
 * 一個交叉點上實際計分的島：先剔除不計分的島，其餘每座各算一次。
 * 因此 S4 沙漠（主島編號）與外地之間的交叉點只剩外地，歸外地。
 */
export function bonusIslands(rule: IslandBonusRule, islands: readonly number[], home: readonly number[] = []): number[] {
  return islands.filter((island) => (rule.skip === 'main' ? island !== MAIN_ISLAND : !home.includes(island)));
}

/** 設置結束時記下各玩家的 home islands（只有 `skip: 'home'` 的劇本；只記一次）。 */
function recordHome(state: GameState, slot: SeafarersState): void {
  if (slot.home) return;
  const home: Record<string, number[]> = Object.fromEntries(state.players.map((player) => [player.id, []]));
  state.board.buildings.forEach((building, vertex) => {
    if (!building) return;
    const list = home[building.player]!;
    for (const island of islandsAt(state, vertex)) if (!list.includes(island)) list.push(island);
  });
  for (const list of Object.values(home)) list.sort((a, b) => a - b);
  slot.home = home;
}

/** Starting settlements only on the main island. */
export function allowBuilding(state: GameState, _playerId: string, vertex: number, options: { setup: boolean }, ctx: ModuleViewContext): boolean {
  if (!options.setup || ctx.profile.scenario !== 'new-shores') return true;
  return islandsAt(state, vertex).includes(MAIN_ISLAND);
}

/** Awards the bonus for every new (player, island) pair. */
export function claimIslands(state: GameState, ctx: ModuleContext): void {
  const rule = islandBonusRule(ctx);
  if (!rule) return;
  const slot = seafarersState(state);
  // 設置的最後一次 board change 時 `turn.setup` 已清空，此時村落全是設置村落。
  if (rule.skip === 'home' && !state.turn.setup) recordHome(state, slot);
  if (state.turn.phase === 'setup') return;
  state.board.buildings.forEach((building, vertex) => {
    if (!building) return;
    for (const island of bonusIslands(rule, islandsAt(state, vertex), slot.home?.[building.player])) {
      const claimed = (slot.islands[building.player] ??= []);
      if (claimed.includes(island)) continue;
      claimed.push(island);
      (slot.claims ??= []).push({ player: building.player, island, vertex });
      playerById(state, building.player)!.bonusPoints += rule.points;
      ctx.kit.emit(state, 'island.bonus', { playerId: building.player, island, vertex, points: rule.points });
    }
  });
}
