/**
 * 海盜巢穴的戰船、進攻堡壘與收復（S7c，SF25 p. 17 "Warships"、"Conquering a pirate fortress"、"Winning the game"）。
 *
 * - 戰船：打出騎士牌（4 人局含換成騎士的分數牌）時，把船線上「最接近起點村落」的一般船改成戰船（橫放）。
 *   騎士牌只能用來改戰船，沒有可改的船就拒絕（`E_NO_WARSHIP_TARGET`，牌留在手上）。戰船的邊記在
 *   `pirateIslands.warships`；S7b 的海盜攻擊用它的長度當玩家戰力。不動強盜、不計最大軍隊（皆已停用）。
 * - 進攻：玩家按結束回合時（`onEndTurn`，行動階段的最後一刻），若自己的船線已完成（`next === 'done'`）而且堡壘還有
 *   pirate lair，自動進攻一次：擲 1 顆骰（遊戲 rng）當海盜戰力，船線上的戰船數比骰值多則移除 1 枚 lair；
 *   少則移除船線上最接近堡壘的 2 艘船，相等則移除 1 艘（船回供應堆，戰船也一起不見）。進攻之後照常結束回合。
 * - 收復：lair 全部移除後堡壘是一般的村落（產出、升級、計分、蓋路都由 `fortressLocked` 自然放行）；所有堡壘都
 *   收復後海盜移出遊戲（`board.pirate = null`，不再巡弋、攻擊，海盜格的放船限制也解除）。
 * - 勝利：自己的回合任一時刻，已收復自己的堡壘且 10 分以上（`pirateCause`，取代單純的目標分）。
 */

import type { BanditMove, ModuleContext, ModuleViewContext } from '../types.ts';
import type { GameEndCause, GameState } from '../../types.ts';
import { lineContext, pirateIslandsView, type Fortress } from './pirateIslands.ts';

/** 船線上最接近起點、還不是戰船的船；沒有就是 null。 */
export function convertibleShip(state: GameState, playerId: string): number | null {
  const slot = pirateIslandsView(state);
  const line = slot?.lines[playerId];
  if (!slot || !line) return null;
  const warships = slot.warships[playerId] ?? [];
  for (const edge of line.edges) {
    const road = state.board.roads[edge];
    if (road?.ship && road.player === playerId && !warships.includes(edge)) return edge;
  }
  return null;
}

/** 玩家船線上的戰船數（進攻堡壘的戰力；與海盜攻擊用的 `warshipCount` 不同：後者連離開船線的戰船也算）。 */
export function lineWarships(state: GameState, playerId: string): number {
  const slot = pirateIslandsView(state);
  const line = slot?.lines[playerId];
  if (!slot || !line) return 0;
  const warships = slot.warships[playerId] ?? [];
  return line.edges.filter((edge) => warships.includes(edge)).length;
}

/**
 * 騎士牌在海盜巢穴：改裝戰船（取代 `moveBandit`）。沒有可改的船就拒絕，牌不會被消耗（引擎在此之後才移走牌）。
 */
export function knightToWarship(state: GameState, actorId: string, target: number | null, cause: 'seven' | 'knight', ctx: ModuleContext): BanditMove | undefined {
  if (cause !== 'knight') return undefined;
  const { kit } = ctx;
  // 沒有強盜可放：騎士牌不帶目標格（`hex: null`）。
  if (target !== null) return { ok: false, error: kit.fail('E_INVALID_COMMAND') };
  const edge = convertibleShip(state, actorId);
  if (edge === null) return { ok: false, error: kit.fail('E_NO_WARSHIP_TARGET') };
  const slot = pirateIslandsView(state)!;
  (slot.warships[actorId] ??= []).push(edge);
  kit.emit(state, 'warship.converted', { playerId: actorId, edge, count: slot.warships[actorId]!.length });
  return { ok: true, hex: null, candidates: [], robberMove: false };
}

/** 戰船被 `ship.move` 退回到新的邊：還是同一艘戰船（SF25 沒有規定，記為 interpretation）。 */
export function moveWarship(state: GameState, playerId: string, from: number, to: number): void {
  const warships = pirateIslandsView(state)?.warships[playerId];
  const index = warships?.indexOf(from) ?? -1;
  if (warships && index >= 0) warships[index] = to;
}

/** 玩家的堡壘。 */
export function fortressOf(state: GameState, playerId: string): Fortress | undefined {
  return pirateIslandsView(state)?.fortresses.find((fortress) => fortress.player === playerId);
}

/** 已收復自己的堡壘（lair 全部移除）。 */
export function hasRecaptured(state: GameState, playerId: string): boolean {
  const fortress = fortressOf(state, playerId);
  return !!fortress && fortress.lairs === 0;
}

/** 玩家此刻按結束回合會進攻堡壘嗎：船線完成而且堡壘還有 lair。 */
export function willAttack(state: GameState, playerId: string): boolean {
  const fortress = fortressOf(state, playerId);
  if (!fortress || fortress.lairs <= 0) return false;
  return lineContext(state, playerId)?.next === 'done';
}

/** 從船線末端（最靠近堡壘）移除 `count` 艘船，回供應堆；戰船一併不見。回傳移除的邊。 */
function removeLineEnd(state: GameState, playerId: string, count: number): number[] {
  const slot = pirateIslandsView(state)!;
  const line = slot.lines[playerId]!;
  const removed: number[] = [];
  for (let i = 0; i < count && line.edges.length > 0; i++) {
    const edge = line.edges.pop()!;
    state.board.roads[edge] = null;
    removed.push(edge);
  }
  if (line.edges.length === 0) line.start = null;
  const warships = slot.warships[playerId];
  if (warships) slot.warships[playerId] = warships.filter((edge) => !removed.includes(edge));
  return removed;
}

/**
 * 行動階段結束時的自動進攻。船線沒有到達堡壘（或已收復）什麼都不做。
 * 回傳是否真的進攻過。
 */
export function attackFortress(state: GameState, playerId: string, ctx: ModuleContext): boolean {
  if (!willAttack(state, playerId)) return false;
  const { kit } = ctx;
  const slot = pirateIslandsView(state)!;
  const fortress = fortressOf(state, playerId)!;
  const die = ctx.rng.int(6) + 1;
  const strength = lineWarships(state, playerId);
  let removed: number[] = [];
  let result: 'won' | 'lost' | 'tie';
  if (strength > die) {
    result = 'won';
    fortress.lairs -= 1;
  } else if (strength < die) {
    result = 'lost';
    removed = removeLineEnd(state, playerId, 2);
  } else {
    result = 'tie';
    removed = removeLineEnd(state, playerId, 1);
  }
  kit.emit(state, 'fortress.attacked', { playerId, die, warships: strength, result, lairs: fortress.lairs, removed });
  if (result === 'won' && fortress.lairs === 0) {
    kit.emit(state, 'fortress.recaptured', { playerId, vertex: fortress.vertex });
    // 所有堡壘都收復後，海盜移出遊戲。
    if (slot.fortresses.every((entry) => entry.lairs === 0) && state.board.pirate !== null) {
      kit.emit(state, 'pirate.removed', { from: state.board.pirate });
      state.board.pirate = null;
    }
  }
  // 船被移走、堡壘收復都會改變盤面（路徑、分數、獎項）。
  kit.afterBoardChange(state);
  return true;
}

/**
 * 勝利判定：已收復自己的堡壘且達到目標分才算（只有分數或只有收復都不算）。
 * 回傳 null 表示這位玩家目前不算贏（取代一般的「達到目標分」判定）。
 */
export function pirateCause(state: GameState, playerId: string, score: number, ctx: ModuleViewContext): GameEndCause | null {
  return hasRecaptured(state, playerId) && score >= ctx.profile.victoryTarget ? 'fortressRecaptured' : null;
}
