/**
 * 組合層的 `rescore`（SF+CK 計畫 §4.4「騎士位置」兩列）：騎士站的路口會擋住自己的建築與船，所以替 `knight.move`、
 * `knight.displace`、`knight.recruit` 的目標路口罰分。只調分數，不新增、不移除候選（R-SC9）；不相干的指令回 0。
 *
 * - **小島空點**（standard 與 easy 都罰）：目標是自己現行島嶼計畫（`economy.plans` 中的 `seafarers.islandSettlement`）
 *   的建地時，罰分等於該計畫的價值（勝利分當量）：騎士站上去，那座聚落就蓋不成（`siteBlocked`）。沒有船的出發點時，
 *   沿海計畫（`seafarers.coastSettlement`，#171）的建地同樣罰分。
 * - **船的 open end**（只限 standard）：目標是 `hints.modules.seafarers.movableShips` 中自己葉端船的 open end 時，
 *   罰 `OPEN_END_PENALTY`：騎士站在那一端，這艘船就只剩被騎士壓住的端點，rules 會回 `E_SHIP_PINNED_BY_KNIGHT`。
 *   easy 不移船（SF 計畫 D-SF2），所以不罰，`recruitSite` 的順序也不變。
 *
 * 回傳值一律是有限的非正數（合約不接受 −∞）。罰分只能讓候選排在別的候選之後：`turn.pick` 不看分數的正負，
 * 候選只剩它自己時仍會被選中；`knight.recruit` 的點由 C&K 的 `recruitSite` 依這個差值排序（D2），才真正避開。
 *
 * 決定性（P4）：只讀 view 與 economy，不消耗亂數。
 */

import type { GameView } from '@catan/rules';
import { COAST_SETTLEMENT, ISLAND_SETTLEMENT } from '../seafarers/plan.ts';
import type { BotCommand, BotModule, TurnContext } from '../types.ts';
import { moduleHints } from '../view.ts';

/** 站在自己葉端船的 open end 上，要付的代價（勝利分當量）：船被壓住，移船計畫就少了一個選擇。未經對局調校（推測）。 */
export const OPEN_END_PENALTY = 0.3;

/** 命令的目標路口；不是三種騎士位置指令（或欄位不是整數）時回 null。 */
function targetVertex(command: BotCommand): number | null {
  const field = command.type === 'knight.recruit' ? command.vertex : command.type === 'knight.move' || command.type === 'knight.displace' ? command.to : undefined;
  return typeof field === 'number' && Number.isInteger(field) ? field : null;
}

/** 罰分的計畫種類：島嶼聚落，與沒有船的出發點時的沿海聚落（騎士站上去，出海的起點就蓋不成，#171）。 */
const SEA_PLANS: readonly string[] = [ISLAND_SETTLEMENT, COAST_SETTLEMENT];

/** 自己現行島嶼或沿海計畫中，建地是 `vertex` 者的最大價值；沒有則 0。 */
function islandPlanValue(turn: TurnContext, vertex: number): number {
  let value = 0;
  for (const plan of turn.economy.plans) {
    if (SEA_PLANS.includes(plan.kind) && plan.vertex === vertex && Number.isFinite(plan.value)) value = Math.max(value, plan.value);
  }
  return value;
}

/**
 * `vertex` 是不是自己某艘「現在能移」的葉端船的 open end。open end 與 rules 的 `isOpenShipEnd` 相同：沒有自己的建築、
 * 也沒有另一艘自己的船接在這一端。
 */
function isMovableShipOpenEnd(turn: TurnContext, vertex: number): boolean {
  const { view, model, ctx } = turn;
  const ships = moduleHints(view.hints, 'seafarers')?.movableShips;
  if (!Array.isArray(ships)) return false;
  if (view.board.buildings[vertex]?.player === ctx.selfId) return false;
  return ships.some((ship) => {
    const ends = model.topo.edges[ship.edge]?.vertices;
    return !!ends && ends.includes(vertex) && !ownShipAt(view, model.topo.vertices[vertex]!.edges, ship.edge, ctx.selfId);
  });
}

/** `vertex` 周圍除了 `except` 之外，還有沒有自己的船。 */
function ownShipAt(view: GameView, edges: readonly number[], except: number, selfId: string): boolean {
  return edges.some((edge) => {
    const road = view.board.roads[edge];
    return edge !== except && !!road && road.ship && road.player === selfId;
  });
}

export const sfckRescore: NonNullable<BotModule['rescore']> = (turn, command) => {
  const vertex = targetVertex(command);
  if (vertex === null || vertex < 0 || vertex >= turn.model.topo.vertices.length) return 0;
  let penalty = islandPlanValue(turn, vertex);
  if (turn.level !== 'easy' && isMovableShipOpenEnd(turn, vertex)) penalty += OPEN_END_PENALTY;
  return penalty === 0 ? 0 : -penalty;
};
