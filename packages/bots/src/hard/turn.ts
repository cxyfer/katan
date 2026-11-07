/** hard 的單次決策資料：standard 的 `Turn` 加上計牌結果與分數估計。 */

import { RESOURCES, type GameView, type PublicPlayerView, type Resource } from '@catan/rules';
import type { Economy } from '../economy.ts';
import type { LevelParams } from '../level.ts';
import { trackTable, type HandBelief, type TableBelief } from '../tracker.ts';
import { Turn } from '../turn.ts';
import type { BotContext } from '../types.ts';
import { hardEconomyOf } from './economy.ts';

/** hard 的難度參數；hard 自己的決策不讀 `acceptMargin`，沿用的 standard 函式才會讀。 */
export const HARD_PARAMS: LevelParams = {
  topK: 1,
  proposeOffers: true,
  eagerKnights: true,
  acceptMargin: 0.6,
  monopolyMin: 2,
};

export class HardTurn extends Turn {
  private cachedBelief: TableBelief | null = null;
  private cachedHardEconomy: Economy | null = null;
  /** 對手模型（`hard/trade.ts` 的 `rivalModel`）的快取，只活在這次決策。 */
  readonly rivals = new Map<string, unknown>();

  // `hard` 在 PR 3 之前還不是 BotLevel；base 經濟不讀 level，傳 standard 不影響結果。
  constructor(view: GameView, ctx: BotContext, me: PublicPlayerView) {
    super(view, ctx, 'standard', HARD_PARAMS, me, []);
  }

  /** hard 的計畫估值（`hard/economy.ts`）；沿用的 standard 函式也讀這一份。 */
  override get economy(): Economy {
    this.cachedHardEconomy ??= hardEconomyOf(this);
    return this.cachedHardEconomy;
  }

  /** 計牌結果，第一次讀取時重播完整歷史。 */
  get belief(): TableBelief {
    this.cachedBelief ??= trackTable(this.view, this.ctx.selfId);
    return this.cachedBelief;
  }

  get opponents(): readonly PublicPlayerView[] {
    return this.view.players.filter((player) => player.id !== this.ctx.selfId);
  }

  player(id: string): PublicPlayerView | undefined {
    return this.view.players.find((player) => player.id === id);
  }

  /** 估計總分：自己用含隱藏分的 `ownScore`；對手用公開分數加上分數卡的期望張數。 */
  scoreOf(id: string): number {
    const player = this.player(id);
    if (!player) return 0;
    if (id === this.ctx.selfId) return player.ownScore ?? player.publicScore;
    return player.publicScore + (this.belief.dev.players[id]?.victoryPoints ?? 0);
  }

  /** 估計分數最高的對手。 */
  leader(): PublicPlayerView | null {
    let best: PublicPlayerView | null = null;
    for (const player of this.opponents) {
      if (!best || this.scoreOf(player.id) > this.scoreOf(best.id)) best = player;
    }
    return best;
  }

  /**
   * 對手的威脅度：1 是一般對手；領先自己、接近勝利，或是場上領先者時提高。
   * 用來加權強盜與交易的判斷。
   */
  threat(id: string): number {
    const target = this.view.victoryTarget;
    const score = this.scoreOf(id);
    const mine = this.scoreOf(this.ctx.selfId);
    let threat = 1 + 0.4 * Math.max(0, score - mine);
    if (score >= target - 3) threat += 0.8;
    if (score >= target - 2) threat += 1.2;
    if (this.leader()?.id === id) threat += 0.3;
    return threat;
  }

  hand(id: string): HandBelief | undefined {
    return this.belief.hands[id];
  }

  /** 對手手上一張隨機牌是各資源的機率。 */
  cardOdds(id: string): Record<Resource, number> {
    const belief = this.hand(id);
    const out = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    if (!belief || belief.size === 0) return out;
    for (const resource of RESOURCES) out[resource] = belief.expected[resource] / belief.size;
    return out;
  }
}
