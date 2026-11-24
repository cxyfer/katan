/**
 * Heading for New Shores island rules (SF25 p. 4):
 * - starting settlements go on the main island;
 * - each player earns 2 VP for their own first settlement on each small
 *   island, whether or not someone else settled there before. The bonus is
 *   kept (the tokens lie under that settlement) and is public.
 */

import { isLandHex, playerById, topologyOf } from '../../analysis.ts';
import { MAIN_ISLAND } from '../../seafarers-boards.ts';
import type { IslandBonusRule } from '../../profiles.ts';
import type { GameState } from '../../types.ts';
import type { ModuleContext, ModuleViewContext } from '../types.ts';
import { isSmallIslandHex } from './cloth.ts';
import { seafarersState, type SeafarersState } from './state.ts';

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

/** 規則在 profile 的 `islandBonus`（spec §5.1）；沒有則沒有獎勵（S3、S5、S6、S7）。 */
export function islandBonusRule(ctx: ModuleViewContext): IslandBonusRule | undefined {
  return ctx.profile.islandBonus;
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

/**
 * Starting settlements only on the main island.
 * 穿越荒漠（SF25 p. 10）更嚴：交叉點碰到的任何格都不得屬於 unexplored region（島 2–5），
 * 所以與被沙漠隔出的陸地帶相鄰的主島交叉點也排除；沙漠算主島。
 */
export function allowBuilding(state: GameState, _playerId: string, vertex: number, options: { setup: boolean }, ctx: ModuleViewContext): boolean {
  const scenario = ctx.profile.scenario;
  // 世外部落（SF25 p. 12）：村落只能蓋在碰到至少一個有數字圓片的格的交叉點（設置與之後都一樣）；
  // 起始村落只放大島。
  if (scenario === 'forgotten-tribe') {
    const info = topologyOf(state).vertices[vertex];
    if (!info?.hexes.some((hex) => state.board.layout.numbers[hex] !== null)) return false;
    return !options.setup || islandsAt(state, vertex).includes(MAIN_ISLAND);
  }
  // 布匹產地（SF25 p. 14）：不得在四座小島蓋村落（全程）；起始村落放在兩座大島之一或分在兩座。
  if (scenario === 'cloth-for-catan') {
    const info = topologyOf(state).vertices[vertex];
    return !info?.hexes.some((hex) => isLandHex(state, hex) && isSmallIslandHex(state, hex));
  }
  if (!options.setup) return true;
  if (scenario === 'fog-islands') return onKnownLand(state, vertex);
  if (scenario === 'new-shores') return islandsAt(state, vertex).includes(MAIN_ISLAND);
  if (scenario === 'through-the-desert') {
    const islands = islandsAt(state, vertex);
    return islands.length > 0 && islands.every((island) => island === MAIN_ISLAND);
  }
  return true;
}

/**
 * 未知海域的起始村落只放在已知島（SF25 p. 8）：交叉點碰到的陸地格都要有島編號。
 * 設置中翻開的新陸地沒有島編號（`layout.islands` 維持 0），所以不算已知島。
 */
function onKnownLand(state: GameState, vertex: number): boolean {
  const hexes = topologyOf(state).vertices[vertex]?.hexes ?? [];
  const land = hexes.filter((hex) => isLandHex(state, hex));
  return land.length > 0 && land.every((hex) => (state.board.layout.islands[hex] ?? 0) > 0);
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
