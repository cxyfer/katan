/**
 * 騎士封鎖戰術（C&K 計畫 §4.1、§5 CK-C）：把一隻啟動中的騎士移到擋住對手擴張路線的路口。騎士站著的路口任何人都
 * 不能蓋建築，對手的道路也穿不過去（`vertexBlocker`）；自己的騎士不擋自己的路。
 *
 * 價值〔推測：中等〕：對每位對手，擴張價值 = 兩條路以內、合乎距離規則的空點中最好的一個（1 + 點數 × `PIP_VALUE`，
 * 依還要幾條路折扣）。假設騎士站到那個路口之後重算一次，前後的差就是封鎖造成的傷害（對手改走第二好的點），
 * 依對手的威脅權重加權、再打對折。自己的合法聚落點被騎士擋住是代價（折 0.4）；計畫的目標點不擋。
 * 騎士移動後會變回未啟動（要再付 1 grain 啟動），所以淨價值要超過 `TACTIC_MIN` 才動。
 *
 * 騎士只有在蠻族逼近的視窗內才會啟動（`defense.ts`），所以平時沒有騎士可以動：值得封鎖時先付 1 grain 啟動一隻
 * 閒置的騎士（它在這個視窗還不能行動），下一個回合再移動；啟動的費用要從封鎖的價值扣掉，視窗又很近時不做。
 *
 * 不影響蠻族防禦（§4.3「攻擊前不讓防守需要的騎士移動」）：攻擊逼近的視窗內（`guardedKnights`）不動啟動中的騎士；
 * 啟動要在視窗前 2 艘船以外（`near ≥ 2`），來得及在下個回合動、也不佔用視窗內的 grain。只有 standard 做；easy 不做。
 *
 * 實測（C&K 矩陣 10 個種子）：這個戰術幾乎不會發動。騎士的可達路口都在自己的路網上，對手最好的擴張選擇很少剛好
 * 經過那裡；封鎖的淨價值最高約 0.08，遠低於 `TACTIC_MIN`。門檻是估計值，留著讓盤面真的出現機會時才動。
 *
 * 決定性（P4）：不消耗亂數；同分取騎士與目標路口編號較小者（hints 的順序）。
 */

import { CK_ACTIVATE_COST } from '@catan/rules';
import { isFreeSpot, searchRoads, type BoardModel } from '../../board.ts';
import { canAfford, PIP_VALUE } from '../../economy.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { opponentsOf, rivalWeight } from './cards-interactive.ts';
import { defenseAway, guardedKnights } from './defense.ts';
import { threatOf } from './knights.ts';
import { ckCommands, ckHints } from './view.ts';

/** 封鎖的淨價值（勝利分當量）至少要有這麼多才讓騎士躺下：要扣掉再啟動的 1 grain 與放棄原本的站位。 */
export const TACTIC_MIN = 0.7;
/** 還要幾條路才到：對價值的折扣；超過 2 條路視為到不了。 */
const DISTANCE_FACTOR: Readonly<Record<number, number>> = { 0: 1, 1: 0.6, 2: 0.3 };

/** 聚落點的價值：1 + 點數 × `PIP_VALUE`（與 base 的立即建造同尺度）。 */
function spotValue(model: BoardModel, vertex: number): number {
  const pips = model.topo.vertices[vertex]!.hexes.reduce((sum, hex) => sum + model.hexPips[hex]!, 0);
  return 1 + PIP_VALUE * pips;
}

/** 假設自己的騎士從 `from` 移到 `to`：`to` 被擋、不能蓋建築，`from` 解除。 */
export function withKnightMoved(model: BoardModel, selfId: string, from: number, to: number): BoardModel {
  return {
    ...model,
    blocker: (at, candidate) => (candidate === to ? selfId : candidate === from ? null : model.blocker?.(at, candidate) ?? null),
    siteBlocked: (at, candidate) => candidate === to || (candidate !== from && (model.siteBlocked?.(at, candidate) ?? false)),
  };
}

/** 對手 `playerId` 在這個盤面下最好的擴張選擇的價值（兩條路以內最好的空點，依距離折扣）。 */
export function expansionValue(model: BoardModel, playerId: string): number {
  const search = searchRoads(model, playerId, 2);
  let best = 0;
  model.topo.vertices.forEach((_, vertex) => {
    const factor = DISTANCE_FACTOR[search.distance[vertex] ?? Infinity];
    if (factor === undefined || !isFreeSpot(model, vertex)) return;
    best = Math.max(best, factor * spotValue(model, vertex));
  });
  return best;
}

/**
 * 騎士從 `from` 移到 `vertex` 的淨價值：對手最好的擴張選擇被擋掉的損失（威脅權重加權、打對折），減去自己的代價
 * （那個路口是自己的合法聚落點時折 0.4；計畫的目標點一律不擋）。
 */
export function blockValue(turn: TurnContext, from: number, vertex: number, before: ReadonlyMap<string, number>): number {
  const { model, view, economy, ctx } = turn;
  if (economy.plans.slice(0, 3).some((plan) => plan.vertex === vertex)) return -Infinity;
  const after = withKnightMoved(model, ctx.selfId, from, vertex);
  let harm = 0;
  for (const rival of opponentsOf(turn)) {
    const loss = (before.get(rival.id) ?? 0) - expansionValue(after, rival.id);
    if (loss > 0) harm += 0.5 * loss * rivalWeight(turn, rival);
  }
  const own = (view.hints?.legalSettlements ?? []).includes(vertex) ? 0.4 * spotValue(model, vertex) : 0;
  return harm - own;
}

/** 啟動的代價（1 grain）折成的勝利分當量。 */
const ACTIVATE_PRICE = 0.3;

/**
 * 從 `start` 沿自己的道路能走到的空路口（與 rules 的 `knightReach` 相同：只經過空路口與自己的騎士，不穿過別人的棋子；
 * 不含船）。閒置的騎士沒有 `hints.knights[].moves`，啟動前要自己算。
 */
export function reachableFrom(turn: TurnContext, start: number): number[] {
  const { model, view, ctx } = turn;
  const occupant = (vertex: number): string | null => view.board.buildings[vertex]?.player ?? model.blocker?.(model, vertex) ?? null;
  const moves = new Set<number>();
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head]!;
    for (const edge of model.topo.vertices[vertex]!.edges) {
      const road = view.board.roads[edge];
      if (!road || road.player !== ctx.selfId || road.ship) continue;
      const [a, b] = model.topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      if (seen.has(next)) continue;
      seen.add(next);
      const owner = occupant(next);
      if (owner === null) {
        moves.add(next);
        queue.push(next);
      } else if (owner === ctx.selfId) queue.push(next);
    }
  }
  return [...moves].sort((a, b) => a - b);
}

/** `minValue`：封鎖的淨價值下限，預設 `TACTIC_MIN`（單元測試用較低的值走過候選的產生）。 */
export function tacticsActions(turn: TurnContext, minValue: number = TACTIC_MIN): Scored<BotCommand>[] {
  if (turn.level === 'easy') return [];
  const hints = ckHints(turn.view.hints);
  if (!hints || hints.knights.length === 0) return [];
  const threat = threatOf(turn.view, turn.ctx.selfId);
  // 視窗內不動（`guardedKnights` 保留全部啟動中的騎士）；啟動要在視窗前 2 艘船以外。
  const near = threat.pillageable > 0 ? threat.away - defenseAway(turn.level) : Infinity;
  if (near <= 0) return [];
  const guarded = guardedKnights(turn);
  const movable = hints.knights.filter((knight) => knight.canAct && knight.moves.length > 0 && !guarded.has(knight.vertex));
  const idle = hints.knights.filter((knight) => !knight.active && knight.canActivate);
  const canActivate = near >= 2 && idle.length > 0 && canAfford(turn.economy.hand, CK_ACTIVATE_COST);
  if (movable.length === 0 && !canActivate) return [];
  const before = new Map<string, number>(opponentsOf(turn).map((rival) => [rival.id, expansionValue(turn.model, rival.id)]));
  const best = (from: number, moves: readonly number[]): { to: number; value: number } | null => {
    let found: { to: number; value: number } | null = null;
    for (const to of moves) {
      const value = blockValue(turn, from, to, before);
      if (!found || value > found.value + 1e-9) found = { to, value };
    }
    return found;
  };
  const out: Scored<BotCommand>[] = [];
  for (const knight of movable) {
    const found = best(knight.vertex, knight.moves);
    if (found && found.value > minValue) out.push({ item: ckCommands.moveKnight(knight.vertex, found.to), score: Math.min(1.4, found.value) });
  }
  // 已經有啟動中的騎士可以動時不再多啟動一隻。
  if (canActivate && movable.length === 0 && !hints.knights.some((knight) => knight.active)) {
    let pick: { vertex: number; value: number } | null = null;
    for (const knight of idle) {
      const found = best(knight.vertex, reachableFrom(turn, knight.vertex));
      if (found && (!pick || found.value > pick.value + 1e-9)) pick = { vertex: knight.vertex, value: found.value };
    }
    if (pick && pick.value > minValue + ACTIVATE_PRICE) {
      out.push({ item: ckCommands.activateKnight(pick.vertex), score: Math.min(1.4, pick.value - ACTIVATE_PRICE) });
    }
  }
  return out;
}
