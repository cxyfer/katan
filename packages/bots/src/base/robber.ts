/** base 的強盜：壓領先者的高產能格、避開自己的建築，並優先有牌可偷的格子。 */

import type { GameView } from '@catan/rules';
import { collectScored } from '../modules/compose.ts';
import type { BanditTarget, BotModule, RobberCause, Scored, TurnContext } from '../modules/types.ts';

/** view 的 cause 只是 string；非騎士一律視為 7。 */
export function robberCauseOf(cause: string): RobberCause {
  return cause === 'knight' ? 'knight' : 'seven';
}

/** base 的強盜候選；迭代順序與跳過條件都不得更動。 */
export function robberCandidates(turn: TurnContext): Scored<number>[] {
  const { view, model, ctx, me } = turn;
  const candidates: Scored<number>[] = [];
  view.board.terrain.forEach((terrain, hex) => {
    if (hex === view.board.robber || terrain === 'sea') return;
    const pips = model.hexPips[hex]!;
    let score = 0;
    let stealable = 0;
    for (const vertex of model.hexVertices[hex]!) {
      const building = view.board.buildings[vertex];
      if (!building) continue;
      const factor = building.city ? 2 : 1;
      if (building.player === ctx.selfId) {
        score -= pips * factor * 3;
        continue;
      }
      const owner = view.players.find((player) => player.id === building.player)!;
      const lead =
        1 + 0.35 * Math.max(0, owner.publicScore - me.publicScore) +
        (owner.publicScore >= view.victoryTarget - 3 ? 0.8 : 0);
      score += pips * factor * lead;
      if (owner.handSize > 0) stealable = Math.max(stealable, owner.handSize);
    }
    if (stealable > 0) score += 1.5 + 0.25 * Math.min(stealable, 8);
    candidates.push({ item: hex, score });
  });
  return candidates;
}

/**
 * 盜賊目標 fold 的初值（「盜賊預設」，與 rules 的 `legalRobberHexes` 加上 SF 的 `pirateTargets` 相同）：
 * 依 hex index 遞增，先放陸地且不是強盜現位的 hex，再放海且不是海盜現位的 hex，海盜在場時最後加上 `null`
 * （外框）。首攻前 `robber = -1`，所以陸地全部在內。base 沒有海格、海盜為 null，結果就是 base 的強盜目標。
 */
export function defaultBanditTargets(view: GameView): BanditTarget[] {
  const { terrain, robber, pirate } = view.board;
  const land: BanditTarget[] = [];
  const sea: BanditTarget[] = [];
  terrain.forEach((kind, hex) => {
    if (kind === 'sea') {
      if (hex !== pirate) sea.push(hex);
    } else if (hex !== robber) {
      land.push(hex);
    }
  });
  return pirate === null || pirate === undefined ? [...land, ...sea] : [...land, ...sea, null];
}

/** fold 的回傳值只接受整數與 null；不是陣列時回 null，由呼叫端沿用上一組。 */
function sanitizeTargets(value: unknown): BanditTarget[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((target): target is BanditTarget => target === null || Number.isInteger(target));
}

/**
 * 這次 `pending.moveRobber`（或打出騎士卡）的完整合法目標：初值之後依 `profile.ruleModules` 順序，每個模組
 * 的 `robberTargets` 收到目前的集合並回傳下一組（可縮小、替換或擴大）。fold 之後不再排除 `view.board.robber`
 * （T&B 的 FR 可能回傳現位格）。保底路徑也會呼叫它：不得 throw、不得消耗亂數；模組丟例外或回傳非陣列時，
 * 視為該模組沒有意見，沿用上一組。
 */
export function banditTargets(view: GameView, selfId: string, modules: readonly BotModule[]): readonly BanditTarget[] {
  let targets: readonly BanditTarget[] = defaultBanditTargets(view);
  for (const module of modules) {
    if (!module.robberTargets) continue;
    let next: BanditTarget[] | null;
    try {
      next = sanitizeTargets(module.robberTargets(view, selfId, targets));
    } catch {
      next = null;
    }
    if (next !== null) targets = next;
  }
  return targets;
}

/**
 * 強盜的選擇：base 候選加上各模組的候選（接在後面），以 `banditTargets` 的集合過濾後一起評分挑選。
 * 過濾後沒有候選時直接取集合的第一項（不消耗亂數）。回傳 null 代表集合也是空的；`{ target: null }`
 * 代表選中外框（例如海盜離場）。
 */
export function banditChoice(turn: TurnContext, cause: RobberCause): { readonly target: BanditTarget } | null {
  const targets = banditTargets(turn.view, turn.ctx.selfId, turn.modules);
  const allowed = new Set<BanditTarget>(targets);
  const candidates: Scored<BanditTarget>[] = [
    ...robberCandidates(turn),
    ...collectScored(turn.modules, (module) => module.banditCandidates?.(turn, cause)),
  ].filter((candidate) => allowed.has(candidate.item));
  if (candidates.length === 0) {
    const first = targets[0];
    return first === undefined ? null : { target: first };
  }
  const chosen = turn.choose(candidates);
  return chosen === null ? null : { target: chosen.item };
}
