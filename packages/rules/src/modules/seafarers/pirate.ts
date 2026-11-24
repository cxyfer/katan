/**
 * The pirate (SF25 pp. 2–3, SF-FAQ 4–7). On a 7 or with a Knight the actor
 * moves the robber or the pirate. The pirate goes to the frame (`null`) or to
 * a different sea hex; on a sea hex the actor may rob one player who has a
 * ship on an edge of that hex. Coastal buildings are never robbed by it.
 */

import { isLandHex, playerById, topologyOf, totalCards } from '../../analysis.ts';
import type { GameState } from '../../types.ts';
import { hasTribeRoute } from './cloth.ts';
import { seafarersView } from './state.ts';
import type { BanditMove, ModuleContext } from '../types.ts';
import { isFogHex } from './fog.ts';

/** Sea hexes the pirate may move to, plus `null` for the frame; unrevealed fog spaces are no tiles. */
export function pirateTargets(state: GameState): (number | null)[] {
  const out: (number | null)[] = [];
  // 卡坦奇觀不使用海盜（SF25 p. 18：海盜放回盒中）。
  if (seafarersView(state).wonders) return out;
  const hexes = topologyOf(state).hexes.length;
  for (let hex = 0; hex < hexes; hex++) {
    if (!isLandHex(state, hex) && hex !== state.board.pirate && !isFogHex(state, hex)) out.push(hex);
  }
  if (state.board.pirate !== null) out.push(null);
  return out;
}

/** Players (other than the actor) with a ship on the hex and a card to lose. */
export function pirateVictims(state: GameState, hex: number, actorId: string): string[] {
  const cloth = seafarersView(state).cloth;
  const topo = topologyOf(state);
  const out = new Set<string>();
  topo.edges.forEach((edge, index) => {
    if (!edge.hexes.includes(hex)) return;
    const road = state.board.roads[index];
    if (!road?.ship || road.player === actorId) return;
    const owner = playerById(state, road.player);
    // 布匹產地：有布匹的玩家也可以被偷（1 枚布匹取代 1 張資源牌）。
    if (owner && (totalCards(owner) > 0 || (cloth?.cloth[road.player] ?? 0) > 0)) out.add(road.player);
  });
  return [...out].sort((a, b) => playerById(state, a)!.seat - playerById(state, b)!.seat);
}

export function moveBandit(
  state: GameState,
  actorId: string,
  target: number | null,
  cause: 'seven' | 'knight',
  ctx: ModuleContext,
): BanditMove | undefined {
  const { kit } = ctx;
  // 卡坦奇觀：7 與騎士只能動強盜；海格與框都不是合法目標。
  if (seafarersView(state).wonders && (target === null || !isLandHex(state, target))) {
    return { ok: false, error: kit.fail('E_ILLEGAL_TARGET', { hex: target }) };
  }
  if (target !== null) {
    if (typeof target !== 'number' || !Number.isInteger(target) || !topologyOf(state).hexes[target]) return undefined;
    // Land hexes belong to the robber.
    if (isLandHex(state, target)) return undefined;
    // 空格還不是板塊：海盜不能上去。
    if (isFogHex(state, target)) return { ok: false, error: kit.fail('E_ILLEGAL_TARGET', { hex: target }) };
  }

  // 布匹產地：移動海盜需要玩家至少有一條通到部落的通路（SF25 p. 14）。
  if (seafarersView(state).cloth && !hasTribeRoute(state, actorId)) return { ok: false, error: kit.fail('E_PIRATE_NEEDS_TRIBE') };
  if (target === state.board.pirate) return { ok: false, error: kit.fail('E_PIRATE_SAME_HEX', { hex: target }) };
  state.board.pirate = target;
  kit.emit(state, 'pirate.moved', { playerId: actorId, hex: target, cause });
  return { ok: true, hex: target, candidates: target === null ? [] : pirateVictims(state, target, actorId) };
}
