/** base 的強盜：壓領先者的高產能格、避開自己的建築，並優先有牌可偷的格子。 */

import { collectScored } from '../modules/compose.ts';
import type { BanditTarget, RobberCause, Scored, TurnContext } from '../modules/types.ts';

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
 * 強盜的選擇：base 候選加上各模組的候選（接在後面），一起評分挑選。回傳 null 代表
 * 沒有候選；`{ target: null }` 代表選中外框（例如海盜離場）。
 */
export function banditChoice(turn: TurnContext, cause: RobberCause): { readonly target: BanditTarget } | null {
  const candidates: Scored<BanditTarget>[] = [
    ...robberCandidates(turn),
    ...collectScored(turn.modules, (module) => module.banditCandidates?.(turn, cause)),
  ];
  // 0.4.3：在這裡以 robberTargets fold 過濾；過濾後為空時取 fold 的第一項
  const chosen = turn.choose(candidates);
  return chosen === null ? null : { target: chosen.item };
}
