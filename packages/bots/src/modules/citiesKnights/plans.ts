/**
 * C&K 的計畫：改良、騎士與城牆（C&K 計畫 §4.1、§4.3 建造）。`scoreExtras` 提供計畫，`planStep` 執行下一步；
 * 兩者成對，kind 一律是 `citiesKnights.<名稱>`，不屬於自己的 kind 回 undefined。
 *
 * - `citiesKnights.improve.<track>`：下一級改良，成本是 n 張該軌道的 commodity（價值見 `improve.ts`）。
 * - `citiesKnights.knight`：騎士。價值隨蠻族逼近與自己的風險上升；`nextCost` 是下一步（啟動或招募），
 *   讓銀行交易朝它補牌。實際動作與 `defense.ts` 的 `defenseStep` 相同。
 * - `citiesKnights.wall`：城牆。只在手牌常常超過上限時才蓋（價值只來自 +2 張上限）。
 *
 * 計畫不設 `immediate`：骨架只替立即得分的計畫主動開價，而 C&K 不主動提出含 commodity 的國內報價（§4.5-7）。
 * 計畫的分數是「勝利分當量 ÷ (1 + eta)」，與 base 的計畫同尺度。
 *
 * 決定性（P4）：不消耗亂數、不讀事件；同分保留產生順序（改良依軌道順序，再騎士、城牆）。
 */

import {
  CK_ACTIVATE_COST,
  CK_KNIGHT_COST,
  CK_MAX_WALLS,
  CK_WALL_COST,
  type CkTrack,
} from '@catan/rules';
import { addCosts, canAfford, etaRounds, handSize, productionValue, type Cost, type Plan } from '../../economy.ts';
import type { BotModule, PlanInput, TurnContext } from '../types.ts';
import { defenseAway, defenseStep, recruitSite } from './defense.ts';
import { consideredOptions, hasCity } from './improve.ts';
import { knightsOf, threatOf } from './knights.ts';
import { ckCommands, ckHints, ckView } from './view.ts';

export const IMPROVE_PLAN = 'citiesKnights.improve' as const;
export const KNIGHT_PLAN = 'citiesKnights.knight' as const;
export const WALL_PLAN = 'citiesKnights.wall' as const;

const IMPROVE_PREFIX = `${IMPROVE_PLAN}.`;

/** 騎士計畫的基本價值（有城市要守，但還沒有騎士）與蠻族逼近時每一級緊迫度加上的價值。 */
const KNIGHT_BASE_VALUE = 0.6;
const KNIGHT_URGENCY_VALUE = 1.2;
/** 緊迫度：蠻族還差幾艘船（≥ 5 艘時不急）。 */
const URGENCY_BY_AWAY: Readonly<Record<number, number>> = { 4: 0.2, 3: 0.5, 2: 1, 1: 1.5 };
/** 城牆計畫的價值（只為了多 2 張手牌上限）。 */
const WALL_VALUE = 0.3;

function planOf(input: PlanInput, kind: Plan['kind'], cost: Cost, nextCost: Cost, value: number): Plan {
  const { base, model } = input;
  const eta = etaRounds(base.hand, cost, base.yield, base.rates, model.view.players.length, base.kinds);
  return { kind, vertex: null, roads: [], ships: [], cost, nextCost, value, eta, score: value / (1 + eta) };
}

/** 想要的騎士數：每 2 座可掠奪的城市多一隻（至少 1 隻），最多 3 隻；easy 只要 1 隻。 */
export function desiredKnights(pillageable: number, easy: boolean): number {
  if (pillageable <= 0) return 0;
  return easy ? 1 : Math.min(3, 1 + Math.floor(pillageable / 2));
}

export function citiesKnightsPlans(input: PlanInput): Plan[] {
  const { model, level, base } = input;
  const view = model.view;
  const plans: Plan[] = [];

  if (hasCity(model)) {
    for (const option of consideredOptions(model, level)) {
      const cost: Cost = { [option.commodity]: option.cost };
      plans.push(planOf(input, `${IMPROVE_PLAN}.${option.track}`, cost, cost, option.value));
    }
  }

  const threat = threatOf(view, model.selfId);
  const easy = level === 'easy';
  const owned = knightsOf(view, model.selfId);
  const want = desiredKnights(threat.pillageable, easy);
  const urgency = URGENCY_BY_AWAY[threat.away] ?? 0;
  const near = threat.away <= defenseAway(level) + 1;
  const idle = owned.filter((knight) => !knight.active).length;
  if (want > 0 && near && idle > 0 && threat.atRisk) {
    // 手上有躺著的騎士、攻擊逼近：先存下啟動的 grain（每隻 1 張，只備最低等級就夠脫離風險的那些）。
    const cost: Cost = { ...CK_ACTIVATE_COST };
    plans.push(planOf(input, KNIGHT_PLAN, cost, cost, KNIGHT_URGENCY_VALUE * urgency));
  } else if (want > 0 && owned.length < want) {
    // 騎士不夠：平時就招募（攻擊後所有騎士都躺下，但棋子還在），逼近時價值升高。easy 距離還遠時不存牌。
    let value = KNIGHT_BASE_VALUE + KNIGHT_URGENCY_VALUE * urgency * (threat.atRisk ? 1 : 0.4);
    if (easy && !near) value = 0;
    if (value > 0) {
      const cost = addCosts(CK_KNIGHT_COST, CK_ACTIVATE_COST);
      plans.push(planOf(input, KNIGHT_PLAN, cost, CK_KNIGHT_COST, value));
    }
  }

  // 城牆：手牌常常超過上限時才有價值（下一個 7 擲出時少棄牌）。
  const walls = ckView(view)?.walls.filter((wall) => wall.player === model.selfId).length ?? 0;
  const cities = view.board.buildings.filter((building, vertex) => building?.city && building.player === model.selfId && !ckView(view)?.walls.some((wall) => wall.vertex === vertex)).length;
  const limit = base.handLimit;
  if (!easy && walls < CK_MAX_WALLS && cities > 0 && handSize(base.hand) >= limit - 1) {
    plans.push(planOf(input, WALL_PLAN, CK_WALL_COST, CK_WALL_COST, WALL_VALUE));
  }
  return plans;
}

/** 城牆蓋在產能最高的城市。 */
function wallSite(turn: TurnContext): number | null {
  const sites = ckHints(turn.view.hints)?.wallSites ?? [];
  let best: number | null = null;
  let bestValue = -Infinity;
  for (const vertex of sites) {
    const value = productionValue(turn.model, vertex, turn.economy.weights);
    if (value > bestValue) {
      bestValue = value;
      best = vertex;
    }
  }
  return best;
}

/** 大都市放在產能最高的城市（最值得保護）。 */
export function metropolisSite(turn: TurnContext, sites: readonly number[]): number | null {
  let best: number | null = null;
  let bestValue = -Infinity;
  for (const vertex of sites) {
    const value = productionValue(turn.model, vertex, turn.economy.weights);
    if (value > bestValue) {
      bestValue = value;
      best = vertex;
    }
  }
  return best;
}

/** 改良的指令：取自 hints（`blocked === null` 才合法）。 */
export function improveCommand(turn: TurnContext, track: CkTrack) {
  const option = ckHints(turn.view.hints)?.improvements?.find((candidate) => candidate.track === track);
  if (!option || option.blocked !== null) return null;
  if (!option.metropolis) return ckCommands.improveCity(track);
  const site = metropolisSite(turn, option.sites);
  return site === null ? null : ckCommands.improveCity(track, site);
}

export const citiesKnightsPlanStep: NonNullable<BotModule['planStep']> = (turn, plan) => {
  if (!plan.kind.startsWith('citiesKnights.')) return undefined;
  if (plan.kind.startsWith(IMPROVE_PREFIX)) return improveCommand(turn, plan.kind.slice(IMPROVE_PREFIX.length) as CkTrack);
  if (plan.kind === KNIGHT_PLAN) {
    const defense = defenseStep(turn);
    if (defense) return defense;
    const threat = threatOf(turn.view, turn.ctx.selfId);
    const want = desiredKnights(threat.pillageable, turn.level === 'easy');
    if (knightsOf(turn.view, turn.ctx.selfId).length >= want) return null;
    // `nextCost` 可能是啟動的費用；真要招募時，招募自己的費用也要付得起。
    if (!canAfford(turn.economy.hand, CK_KNIGHT_COST)) return null;
    const site = recruitSite(turn);
    return site === null ? null : ckCommands.recruitKnight(site);
  }
  if (plan.kind === WALL_PLAN) {
    const vertex = wallSite(turn);
    return vertex === null ? null : ckCommands.buildWall(vertex);
  }
  return undefined;
};
