/**
 * C&K 的騎士與蠻族：盤面事實、攻擊風險，以及追強盜與擠走騎士的候選（C&K 計畫 §4.3；D-CK1）。
 *
 * - 事實（`threatOf`）：蠻族強度 = 城市數、防守強度 = 已啟動騎士等級和；失守時，有可掠奪城市者中貢獻最低的
 *   那一群各失一座城市（大都市免疫）。全部只讀公開投影：不讀 `view.events`。
 * - `chaseValue`、`chaseCandidates`：追走壓在自己格子上的強盜。0.4.3 的 SF+CK 以同一個價值函式建立
 *   `knight.chasePirate` 候選；首次攻擊前強盜不在盤面上，一律讀 `robberActive`（§4.9）。
 * - 擠走較弱的騎士只在它擋住自己最好的計畫時才做；騎士移動、擠人與追強盜之後會變回未啟動，所以攻擊逼近
 *   且需要它防守時不做。
 *
 * 決定性（P4）：不消耗亂數、不讀事件；同分時保留 hints 的順序。
 */

import type { CitiesKnightsView, GameView } from '@catan/rules';
import { PIP_VALUE } from '../../economy.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { ckCommands, ckHints, ckView } from './view.ts';

export type CkKnight = CitiesKnightsView['knights'][number];

/** 盤面上所有騎士（投影缺漏時為空）。 */
export function knightList(view: Pick<GameView, 'modules'>): readonly CkKnight[] {
  const knights = ckView(view)?.knights;
  return Array.isArray(knights) ? knights : [];
}

/** 玩家的騎士。 */
export function knightsOf(view: Pick<GameView, 'modules'>, playerId: string): CkKnight[] {
  return knightList(view).filter((knight) => knight.player === playerId);
}

/** 每位玩家已啟動騎士的等級和（蠻族攻擊時的貢獻）。 */
export function contributionsOf(view: Pick<GameView, 'modules' | 'players'>): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(view.players.map((player) => [player.id, 0]));
  for (const knight of knightList(view)) if (knight.active) out[knight.player] = (out[knight.player] ?? 0) + knight.level;
  return out;
}

/** 大都市所在的路口（大都市免疫掠奪）。 */
function metropolisVertices(view: Pick<GameView, 'modules'>): Set<number> {
  const out = new Set<number>();
  const metropolises = ckView(view)?.metropolises;
  if (metropolises) for (const entry of Object.values(metropolises)) if (entry) out.add(entry.vertex);
  return out;
}

/** 玩家可被掠奪的城市：沒有大都市的城市。 */
export function pillageableCities(view: Pick<GameView, 'modules' | 'board'>, playerId: string): number[] {
  const shielded = metropolisVertices(view);
  const out: number[] = [];
  view.board.buildings.forEach((building, vertex) => {
    if (building?.city && building.player === playerId && !shielded.has(vertex)) out.push(vertex);
  });
  return out;
}

export interface Threat {
  /** 蠻族船的位置與軌道長度；`away` 是還差幾艘船會攻擊。 */
  readonly position: number;
  readonly away: number;
  /** 蠻族強度（城市數）與目前的防守強度。 */
  readonly strength: number;
  readonly defense: number;
  /** 自己目前的貢獻。 */
  readonly mine: number;
  /** 自己有幾座可被掠奪的城市。 */
  readonly pillageable: number;
  /** 有可掠奪城市的對手中，目前最低的貢獻；沒有這樣的對手時為 null。 */
  readonly lowestOther: number | null;
  /** 攻擊會讓自己失去城市。 */
  readonly atRisk: boolean;
}

/**
 * 假設自己的貢獻是 `mine`（預設目前值）時的攻擊風險：蠻族強度大於防守強度，而且自己有可掠奪的城市、
 * 貢獻在有可掠奪城市的玩家當中最低（與 rules 的 `losingPlayers` 相同；平手算同一群）。
 */
export function threatOf(view: GameView, selfId: string, mine?: number): Threat {
  const contributions = contributionsOf(view);
  const current = contributions[selfId] ?? 0;
  const assumed = mine ?? current;
  const state = ckView(view);
  const position = state?.barbarian?.position ?? 0;
  const length = state?.barbarian?.length ?? 7;
  const strength = state?.barbarianStrength ?? view.board.buildings.filter((building) => building?.city).length;
  const defense = (state?.defenderStrength ?? 0) - current + assumed;
  const pillageable = pillageableCities(view, selfId).length;
  let lowestOther: number | null = null;
  for (const player of view.players) {
    if (player.id === selfId || pillageableCities(view, player.id).length === 0) continue;
    const value = contributions[player.id] ?? 0;
    lowestOther = lowestOther === null ? value : Math.min(lowestOther, value);
  }
  const atRisk = strength > defense && pillageable > 0 && (lowestOther === null || assumed <= lowestOther);
  return { position, away: length - position, strength, defense, mine: assumed, pillageable, lowestOther, atRisk };
}

// ---------------------------------------------------------------------------
// 追強盜與擠人
// ---------------------------------------------------------------------------

/** 強盜壓在 `hex` 時，自己被擋掉的點數（城市加倍）。 */
export function blockedPipsAt(turn: TurnContext, hex: number): number {
  const { view, model, ctx } = turn;
  if (!(hex >= 0) || hex >= model.hexPips.length) return 0;
  let blocked = 0;
  for (const vertex of model.hexVertices[hex] ?? []) {
    const building = view.board.buildings[vertex];
    if (building?.player === ctx.selfId) blocked += model.hexPips[hex]! * (building.city ? 2 : 1);
  }
  return blocked;
}

/**
 * 追走位在 `hex` 的強盜（`bandit` 為 'robber'）或海盜的價值，單位是勝利分當量：解除自己被擋的點數。
 * 海盜由 0.4.3 的 SF+CK 模組提供它自己的估值；這裡對海盜回 0。`hex` 為 null（不在盤面上）或首次攻擊前回 0。
 */
export function chaseValue(turn: TurnContext, hex: number | null, bandit: 'robber' | 'pirate' = 'robber'): number {
  if (hex === null || bandit !== 'robber') return 0;
  if (ckView(turn.view)?.robberActive !== true) return 0;
  return PIP_VALUE * blockedPipsAt(turn, hex);
}

/** 追強盜至少要解除這麼多點數才值得讓騎士躺下（base 打騎士的門檻同為 3）。 */
const CHASE_MIN_PIPS = 3;

/** 追走壓在自己格子上的強盜；攻擊逼近、這隻騎士正是防守所需時不追。 */
export function chaseCandidates(turn: TurnContext, keepActive: ReadonlySet<number> = new Set()): Scored<BotCommand>[] {
  const { view } = turn;
  const hints = ckHints(view.hints);
  if (!hints || ckView(view)?.robberActive !== true) return [];
  const hex = view.board.robber;
  if (blockedPipsAt(turn, hex) < CHASE_MIN_PIPS) return [];
  const out: Scored<BotCommand>[] = [];
  for (const knight of hints.knights) {
    if (!knight.chase || keepActive.has(knight.vertex)) continue;
    out.push({ item: ckCommands.chaseRobber(knight.vertex), score: 1 + chaseValue(turn, hex) });
  }
  return out;
}

/**
 * 擠走擋在自己計畫上的較弱騎士：`targets` 是路口（計畫的路口與道路端點），騎士在其中之一就值得擠。
 * 擠人之後這隻騎士躺下，`keepActive` 內的不動。
 */
export function displaceCandidates(
  turn: TurnContext,
  targets: ReadonlySet<number>,
  keepActive: ReadonlySet<number> = new Set(),
): Scored<BotCommand>[] {
  const hints = ckHints(turn.view.hints);
  if (!hints) return [];
  const out: Scored<BotCommand>[] = [];
  for (const knight of hints.knights) {
    if (keepActive.has(knight.vertex)) continue;
    for (const to of knight.displace) {
      if (targets.has(to)) out.push({ item: ckCommands.displaceKnight(knight.vertex, to), score: 1.2 });
    }
  }
  return out;
}

/** 計畫目標路口與道路端點：騎士擋在這些路口上就會讓計畫走不下去。 */
function planVertices(turn: TurnContext): Set<number> {
  const out = new Set<number>();
  const plan = turn.economy.plans[0];
  if (!plan) return out;
  if (plan.vertex !== null) out.add(plan.vertex);
  for (const edge of plan.roads) for (const vertex of turn.model.topo.edges[edge]?.vertices ?? []) out.add(vertex);
  return out;
}

/** 騎士的行動候選：追強盜，以及（只有 standard）擠走擋在最好計畫上的較弱騎士。 */
export function knightActions(turn: TurnContext, keepActive: ReadonlySet<number>): Scored<BotCommand>[] {
  const out = chaseCandidates(turn, keepActive);
  if (turn.level !== 'easy') out.push(...displaceCandidates(turn, planVertices(turn), keepActive));
  return out;
}
