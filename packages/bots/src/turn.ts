/** 單次決策共用的資料（`TurnContext` 的實作）。 */

import { seededRng, type GameView, type PublicPlayerView, type Rng } from '@catan/rules';
import { boardModel, type BoardModel } from './board.ts';
import { economyOf, type Economy } from './economy.ts';
import type { LevelParams } from './level.ts';
import type { BotModule, Scored, TurnContext } from './modules/types.ts';
import type { BotContext, BotLevel } from './types.ts';

/** 決策時共用的資料；`economy` 延遲計算，非行動者多半用不到。 */
export class Turn implements TurnContext {
  private cachedEconomy: Economy | null = null;
  readonly view: GameView;
  readonly ctx: BotContext;
  readonly level: BotLevel;
  readonly params: LevelParams;
  readonly me: PublicPlayerView;
  readonly model: BoardModel;
  readonly rng: Rng;
  readonly modules: readonly BotModule[];

  // 模組清單由呼叫端傳入：本檔不 import registry，避免 turn → registry → 模組 → turn 的循環。
  constructor(
    view: GameView,
    ctx: BotContext,
    level: BotLevel,
    params: LevelParams,
    me: PublicPlayerView,
    modules: readonly BotModule[],
  ) {
    this.view = view;
    this.ctx = ctx;
    this.level = level;
    this.params = params;
    this.me = me;
    this.modules = modules;
    this.model = boardModel(view, ctx.selfId);
    this.rng = seededRng(ctx.seed);
  }

  get economy(): Economy {
    this.cachedEconomy ??= economyOf(this.model);
    return this.cachedEconomy;
  }

  /** paired Player 2 不可發起或結算國內交易。 */
  get pairedSecond(): boolean {
    return this.model.profile.paired && this.view.turn.pairedActor === 2;
  }

  choose<T>(candidates: readonly Scored<T>[]): Scored<T> | null {
    if (candidates.length === 0) return null;
    // 穩定排序：同分時保留原本（索引）順序，standard 因此完全決定。
    const sorted = candidates.slice().sort((a, b) => b.score - a.score);
    const k = Math.min(this.params.topK, sorted.length);
    return sorted[k <= 1 ? 0 : this.rng.int(k)]!;
  }

  pick<T>(candidates: readonly Scored<T>[]): T | null {
    return this.choose(candidates)?.item ?? null;
  }
}
