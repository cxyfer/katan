/**
 * 個人理性的蠻族防禦（C&K 計畫 §4.3 D-CK1、§4.4）：只求自己不落入最低貢獻群，順序為 activate → promote → recruit
 * （再 activate）。蠻族逼近到 `away ≤ 門檻`（standard 2 艘船、easy 1 艘），而且自己有可掠奪的城市、攻擊會讓自己
 * 失城時才反應；為集體防守額外投資沒有意義，那也會讓對手免於損失。
 *
 * - `defensePlan`：依手牌模擬一串最便宜的動作，看自己的貢獻能不能脫離風險；能脫離就照這串做，不能脫離時只做便宜的
 *   啟動（1 grain）。
 * - 啟動的騎士在攻擊前不能躺下：移動、擠人、追強盜之後都會變回未啟動，所以攻擊逼近、自己有風險時，
 *   `guardedKnights` 內的騎士不做這些事。
 * - 合法性取自 hints（`knights[]`、`recruitSites`、`knightSupply`）；費用由這裡檢查（hints 不檢查成本）。
 *
 * 決定性（P4）：不消耗亂數；同分取路口編號較小者。
 */

import { CK_ACTIVATE_COST, CK_KNIGHT_COST, CK_PROMOTE_COST } from '@catan/rules';
import { canAfford, pay, type Hand } from '../../economy.ts';
import type { BotLevel } from '../../types.ts';
import { rescoreDelta } from '../compose.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { knightsOf, threatOf } from './knights.ts';
import { ckCommands, ckHints } from './view.ts';

/**
 * 反應的距離門檻：standard 還差 4 艘船以內（`position ≥ 3`），easy 只在還差 1 艘（`position ≥ 6`）。
 * 計畫 §4.3 寫的是 2：實測在兩次輪到自己之間，其他座位大約擲出一輪的骰子，蠻族可以一口氣前進 2–3 格，
 * 寫 2 時 standard 的失城率 0.32–0.43（4 人與 6 人超過 M5 的 0.35）；3 約 0.33、4 約 0.28（種子 11–40，3–6 人合計），
 * 5 沒有再下降（0.278）。提早啟動的代價只有 1 張 grain，騎士會一直站到攻擊為止。
 */
export function defenseAway(level: BotLevel): number {
  return level === 'easy' ? 1 : 4;
}

/** 攻擊逼近：還差的船數不超過門檻，而且自己有可掠奪的城市。 */
export function defenseWindow(turn: TurnContext): boolean {
  const threat = threatOf(turn.view, turn.ctx.selfId);
  return threat.pillageable > 0 && threat.away <= defenseAway(turn.level);
}

/** 防守逼近而且自己有風險時，必須保持啟動的騎士（路口）。 */
export function guardedKnights(turn: TurnContext): ReadonlySet<number> {
  if (!defenseWindow(turn)) return new Set();
  return new Set(knightsOf(turn.view, turn.ctx.selfId).filter((knight) => knight.active).map((knight) => knight.vertex));
}

/**
 * 招募的地點：只取 `recruitSites`。騎士會擋住那個路口上的建築（含自己的），所以避開自己現在或計畫中的
 * 聚落與城市點；其餘取路口編號最小者。有模組提供 `rescore`（0.4.3 起只有 SF+CK 的組合層）時，這些空點先依它對
 * `knight.recruit { vertex }` 的差值由高到低排序（同分保留原順序，D2）：例如避開自己船的 open end。沒有任何模組提供
 * `rescore` 時走原本的路徑，結果完全相同。
 */
export function recruitSite(turn: TurnContext): number | null {
  const hints = ckHints(turn.view.hints);
  if (!hints || hints.recruitSites.length === 0 || (hints.knightSupply?.[1] ?? 0) <= 0) return null;
  const wanted = new Set<number>(turn.view.hints?.legalSettlements ?? []);
  for (const plan of turn.economy.plans) if (plan.vertex !== null) wanted.add(plan.vertex);
  const free = hints.recruitSites.filter((vertex) => !wanted.has(vertex));
  if (free.length > 1 && turn.modules.some((module) => module.rescore)) {
    const ranked = free.map((vertex, index) => ({ vertex, index, delta: rescoreDelta(turn.modules, turn, ckCommands.recruitKnight(vertex)) }));
    ranked.sort((a, b) => b.delta - a.delta || a.index - b.index);
    return ranked[0]!.vertex;
  }
  return (free.length > 0 ? free : hints.recruitSites)[0] ?? null;
}

interface Step {
  readonly command: BotCommand;
  readonly gain: number;
}

/**
 * 依目前的手牌模擬最便宜的防守動作，回傳這串動作與做完之後是否脫離風險。`mine` 是自己目前的貢獻。
 * 啟動優先（1 grain，每張 grain 換到整隻騎士的等級），其次升級已啟動的騎士（+1），最後招募一隻新騎士並啟動它（+1）。
 */
export function defensePlan(turn: TurnContext): { steps: Step[]; escapes: boolean } {
  const { view, ctx, economy } = turn;
  const hints = ckHints(view.hints);
  const threat = threatOf(view, ctx.selfId);
  if (!hints || !threat.atRisk) return { steps: [], escapes: !threat.atRisk };
  let hand: Hand = economy.hand;
  let mine = threat.mine;
  const steps: Step[] = [];
  const inactive = hints.knights.filter((knight) => !knight.active).slice().sort((a, b) => b.level - a.level || a.vertex - b.vertex);
  const promotable = hints.knights.filter((knight) => knight.canPromote).slice().sort((a, b) => a.level - b.level || a.vertex - b.vertex);
  const promoted = new Set<number>();
  let recruited = false;
  for (let guard = 0; guard < 8 && threatOf(view, ctx.selfId, mine).atRisk; guard++) {
    // a) 啟動：能脫離風險的最小等級，否則最大的。
    if (inactive.length > 0 && canAfford(hand, CK_ACTIVATE_COST)) {
      const escaping = inactive.find((knight) => !threatOf(view, ctx.selfId, mine + knight.level).atRisk);
      const knight = escaping ?? inactive[0]!;
      inactive.splice(inactive.indexOf(knight), 1);
      hand = pay(hand, CK_ACTIVATE_COST);
      mine += knight.level;
      steps.push({ command: ckCommands.activateKnight(knight.vertex), gain: knight.level });
      continue;
    }
    // b) 升級：任何 canPromote 的騎士，啟動中的直接 +1，未啟動的先升級再啟動（兩步都在這一串裡）。
    const target = promotable.find((knight) => !promoted.has(knight.vertex) && knight.active);
    if (target && canAfford(hand, CK_PROMOTE_COST)) {
      promoted.add(target.vertex);
      hand = pay(hand, CK_PROMOTE_COST);
      mine += 1;
      steps.push({ command: ckCommands.promoteKnight(target.vertex), gain: 1 });
      continue;
    }
    // c) 招募並啟動：新騎士一律未啟動，要同時付得起招募與啟動。
    const site = recruited ? null : recruitSite(turn);
    if (site !== null && canAfford(hand, { ...CK_KNIGHT_COST, ...CK_ACTIVATE_COST })) {
      recruited = true;
      hand = pay(pay(hand, CK_KNIGHT_COST), CK_ACTIVATE_COST);
      mine += 1;
      steps.push({ command: ckCommands.recruitKnight(site), gain: 1 });
      continue;
    }
    break;
  }
  return { steps, escapes: !threatOf(view, ctx.selfId, mine).atRisk };
}

/** 現在就該做的防守動作；沒有時回 null。能脫離風險就照模擬的第一步做，否則只做便宜的啟動。 */
export function defenseStep(turn: TurnContext): BotCommand | null {
  if (!defenseWindow(turn)) return null;
  const { steps, escapes } = defensePlan(turn);
  const first = steps[0];
  if (!first) return null;
  if (escapes) return first.command;
  return first.command.type === 'knight.activate' ? first.command : null;
}

/** 防守動作的分數（勝利分當量）：失去一座城市約 1.3 分，超過 base 的任何立即建造。 */
export const DEFENSE_SCORE = 3.5;

export function defenseActions(turn: TurnContext): Scored<BotCommand>[] {
  const command = defenseStep(turn);
  return command ? [{ item: command, score: DEFENSE_SCORE }] : [];
}

/**
 * 已啟動、尚未升級的騎士：Smithing 與一般升級都可以拿它們當目標。回傳 hints 的升級目標，等級低的在前
 * （高等級的升級要 politics 3 級，而且低等級的升級貢獻相同）。
 */
export function promotableKnights(turn: TurnContext): readonly { vertex: number; level: number; active: boolean }[] {
  return (ckHints(turn.view.hints)?.knights ?? []).filter((knight) => knight.canPromote);
}
