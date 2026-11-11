/**
 * 騎士封鎖戰術（C&K 計畫 §4.1、§5 CK-C）：把一隻啟動中的騎士移到對手接下來要蓋的聚落點上。騎士站著的路口任何人
 * 都不能蓋建築，對手的道路也穿不過去（`vertexBlocker`）；自己的騎士不擋自己的路。
 *
 * 價值〔推測：中等〕：對手的路網兩條路以內、而且合乎距離規則的空點，價值 = 那個點的聚落價值（1 + 點數 × `PIP_VALUE`）
 * 的一半，依距離（0／1／2 條路）遞減，依對手的威脅權重加權。騎士移動後會變回未啟動（要再付 1 grain 啟動），所以
 * 價值要超過 `TACTIC_MIN` 才動；自己想蓋的點（合法聚落點、計畫的點、兩條路以內的空點）不擋。
 *
 * 不影響蠻族防禦（§4.3「攻擊前不讓防守需要的騎士移動」）：攻擊逼近的視窗內（`guardedKnights`）不動啟動中的騎士，
 * 視窗之前再多留 1 艘船的緩衝。只有 standard 做；easy 不做。
 *
 * 決定性（P4）：不消耗亂數；同分取騎士與目標路口編號較小者。
 */

import { isFreeSpot, searchRoads, type RoadSearch } from '../../board.ts';
import { PIP_VALUE } from '../../economy.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { opponentsOf, rivalWeight } from './cards-interactive.ts';
import { defenseAway, guardedKnights } from './defense.ts';
import { threatOf } from './knights.ts';
import { ckCommands, ckHints } from './view.ts';

/** 封鎖至少要有這麼多價值（勝利分當量）才讓騎士躺下：要扣掉再啟動的 1 grain 與原本的站位。 */
export const TACTIC_MIN = 0.7;
/** 路網距離（還要幾條路才到）對價值的折扣。 */
const DISTANCE_FACTOR: Readonly<Record<number, number>> = { 0: 1, 1: 0.6, 2: 0.3 };

/** 封鎖 `vertex` 對各對手的傷害（勝利分當量）；不是合法的空點、自己也想要的點回 0。 */
export function blockHarm(turn: TurnContext, vertex: number, searches: ReadonlyMap<string, RoadSearch>): number {
  const { model, view, economy } = turn;
  if (!isFreeSpot(model, vertex)) return 0;
  // 自己想蓋的點不擋：合法聚落點、計畫的點、自己兩條路以內的空點。
  if ((view.hints?.legalSettlements ?? []).includes(vertex)) return 0;
  if (economy.plans.some((plan) => plan.vertex === vertex)) return 0;
  if ((economy.search.distance[vertex] ?? Infinity) <= 2) return 0;
  const pips = model.topo.vertices[vertex]!.hexes.reduce((sum, hex) => sum + model.hexPips[hex]!, 0);
  let harm = 0;
  for (const rival of opponentsOf(turn)) {
    const distance = searches.get(rival.id)?.distance[vertex] ?? Infinity;
    const factor = DISTANCE_FACTOR[distance];
    if (factor === undefined) continue;
    harm += 0.5 * factor * (1 + PIP_VALUE * pips) * rivalWeight(turn, rival);
  }
  return harm;
}

export function tacticsActions(turn: TurnContext): Scored<BotCommand>[] {
  if (turn.level === 'easy') return [];
  const hints = ckHints(turn.view.hints);
  if (!hints || hints.knights.length === 0) return [];
  // 蠻族逼近前就要讓位：視窗內（`guardedKnights`）與視窗之前 1 艘船都不動。
  const threat = threatOf(turn.view, turn.ctx.selfId);
  if (threat.pillageable > 0 && threat.away <= defenseAway(turn.level) + 1) return [];
  const guarded = guardedKnights(turn);
  const movable = hints.knights.filter((knight) => knight.canAct && knight.moves.length > 0 && !guarded.has(knight.vertex));
  if (movable.length === 0) return [];
  const searches = new Map<string, RoadSearch>(opponentsOf(turn).map((rival) => [rival.id, searchRoads(turn.model, rival.id, 2)]));
  const out: Scored<BotCommand>[] = [];
  for (const knight of movable) {
    let best: { to: number; harm: number } | null = null;
    for (const to of knight.moves) {
      const harm = blockHarm(turn, to, searches);
      if (harm > TACTIC_MIN && (!best || harm > best.harm + 1e-9)) best = { to, harm };
    }
    if (best) out.push({ item: ckCommands.moveKnight(knight.vertex, best.to), score: Math.min(1.4, best.harm) });
  }
  return out;
}
