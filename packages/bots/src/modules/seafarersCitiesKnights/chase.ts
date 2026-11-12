/**
 * 追擊海盜（SF+CK 計畫 §4.5）：`knight.chasePirate { vertex }` 讓一隻相鄰海盜 hex 的啟動騎士躺下，然後由自己移動海盜
 * （之後的 `pending.moveRobber` 與 `pending.steal` 由 §4.2 的 fold 與 SF 的海盜評分處理）。保守條件全部成立才產生
 * 候選，而且只限 standard（easy 不追擊）：
 *
 * - K1 `hints.modules.seafarersCitiesKnights.pirateChase` 非空（首攻前與沒有相鄰騎士時為空）。
 * - K2 海盜 hex 至少鄰接 1 艘自己的船，或擋住了島嶼計畫的下一條船（拿掉海盜重算計畫，下一條船邊鄰接海盜 hex）。
 * - K3 蠻族還要 `CHASE_MIN_AWAY` 艘船以上才攻擊：騎士躺下之後要花 1 grain 才能再啟動。
 * - K4 追擊的騎士不在 `guardedKnights` 中，而且躺下之後自己不會落入掠奪風險（對齊 C&K 的個人理性防禦，D-CK1）。
 * - K5 K4 之後選等級最低的騎士；平手取 vertex 最小者。
 * - K6 分數 > 0。
 *
 * **K6 的分數**（勝利分當量）：`PIP_VALUE × max(option.net) − 騎士等級 × DEFENSE_PER_LEVEL − REACTIVATE_PRICE`。
 * `option.net` 是 SF `pirateOptions` 的海盜側淨值（偷牌＋新位置的前線＋解除的封鎖，扣掉新位置擋住自己的損失與離開時
 * 放開的對手前線），單位是加權點數，乘上 `PIP_VALUE` 換成勝利分。追擊沒有立即的勝利分，所以分數採收益減成本，
 * 不加常數項（計畫建議的 `1 + PIP_VALUE × …` 已拿掉），沒有收益的追擊過不了 K6 的 > 0。
 *
 * 常數 `DEFENSE_PER_LEVEL`、`REACTIVATE_PRICE` 與 `CHASE_MIN_AWAY` 未經對局調校（推測）。
 *
 * 決定性（P4）：不消耗亂數、不讀事件；同分取 vertex 較小者。
 */

import type { BoardModel } from '../../board.ts';
import { PIP_VALUE } from '../../economy.ts';
import { guardedKnights } from '../citiesKnights/defense.ts';
import { knightsOf, threatOf } from '../citiesKnights/knights.ts';
import { ISLAND_SETTLEMENT, islandSettlementPlans } from '../seafarers/plan.ts';
import { pirateOptions } from '../seafarers/bandit.ts';
import type { BotCommand, BotModule, Scored, TurnContext } from '../types.ts';
import { sfckHints } from './view.ts';

/** K3：蠻族至少還差這麼多艘船才追擊（`threatOf(...).away`）：騎士躺下後要再付 1 grain 啟動，得留下回合來做。 */
export const CHASE_MIN_AWAY = 3;
/** K6：騎士躺下後要再啟動的 1 grain，折成勝利分當量（與 `tactics.ts` 的 `ACTIVATE_PRICE` 同值）。 */
export const REACTIVATE_PRICE = 0.3;
/** K6：每一級騎士躺下的防禦代價（勝利分當量）。K4 已確保自己不會因此落入風險，這一項只在同一份收益下偏向留下較高等級。 */
export const DEFENSE_PER_LEVEL = 0.1;

/** 海盜放到 `hex` 之外（外框）的盤面；用來看海盜擋住的計畫。 */
function withoutPirate(model: BoardModel): BoardModel {
  return { ...model, view: { ...model.view, board: { ...model.view.board, pirate: null } } };
}

/** K2：海盜 hex 鄰接自己的船，或擋住最好的島嶼計畫的下一條船。 */
function pirateTouchesRoute(turn: TurnContext, pirate: number): boolean {
  const { view, model, ctx } = turn;
  const touches = (edge: number): boolean => model.topo.edges[edge]?.hexes.includes(pirate) === true;
  if (view.board.roads.some((road, edge) => !!road && road.ship && road.player === ctx.selfId && touches(edge))) return true;
  // 海盜在場時，`searchShips` 不會走過它旁邊的邊，所以要拿掉海盜才看得到它擋住的下一步。
  const next = islandSettlementPlans({ model: withoutPirate(model), level: turn.level, base: turn.economy }).find(
    (plan) => plan.kind === ISLAND_SETTLEMENT,
  )?.ships?.[0];
  return next !== undefined && touches(next);
}

/**
 * K6 的分數（勝利分當量）：移走海盜的最佳淨值，減去 `level` 級騎士躺下的代價。沒有海盜選項時為 -Infinity。
 * 只算分數、不檢查 K1–K5；匯出供測試證明「別的條件擋下的追擊，分數本來是正的」。
 */
export function chaseScore(turn: TurnContext, level: number): number {
  const options = pirateOptions(turn);
  if (options.length === 0) return -Infinity;
  return PIP_VALUE * Math.max(...options.map((option) => option.net)) - level * DEFENSE_PER_LEVEL - REACTIVATE_PRICE;
}

export function sfckChaseActions(turn: TurnContext): Scored<BotCommand>[] {
  if (turn.level === 'easy') return [];
  const { view, ctx } = turn;
  // K1
  const chasers = sfckHints(view.hints)?.pirateChase;
  const pirate = view.board.pirate;
  if (!Array.isArray(chasers) || chasers.length === 0 || pirate === null) return [];
  // K3
  const threat = threatOf(view, ctx.selfId);
  if (threat.away < CHASE_MIN_AWAY) return [];
  // K4、K5：躺下之後自己仍然不在風險裡，而且不是防守需要的騎士；取等級最低、vertex 最小者。
  const guarded = guardedKnights(turn);
  const knight = knightsOf(view, ctx.selfId)
    .filter((candidate) => chasers.includes(candidate.vertex) && !guarded.has(candidate.vertex) && !threatOf(view, ctx.selfId, threat.mine - candidate.level).atRisk)
    .sort((a, b) => a.level - b.level || a.vertex - b.vertex)[0];
  if (!knight) return [];
  // K2
  if (!pirateTouchesRoute(turn, pirate)) return [];
  // K6
  const score = chaseScore(turn, knight.level);
  if (!(score > 0)) return [];
  return [{ item: { type: 'knight.chasePirate', vertex: knight.vertex }, score }];
}

export const sfckActions: NonNullable<BotModule['actions']> = sfckChaseActions;
