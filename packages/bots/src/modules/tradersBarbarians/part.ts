/**
 * T&B 各 part 的策略介面（T&B 計畫 §3.2；2026-11-20 依 `B/modules/types.ts` 修訂）。
 *
 * rules 把 T&B 拆成獨立的 part（劇本與變體），由 `tradersBarbarians` 一個 rules module 組合；bots 照做：每個 part
 * 一個 `TbPartBot`，`index.ts` 依 profile 啟用的 part（rules 順序）組合成 `tradersBarbarians` 這一個 BotModule。
 * 各鉤子的語意與 `BotModule` 的同名鉤子相同（undefined／null 的意義、不得 throw、不得消耗亂數），只是範圍限縮在
 * 單一 part：只回答自己的 frame、指令與計畫（kind 一律是 `tradersBarbarians.<名稱>`）。
 *
 * 保底不在這裡：`duty.ts` 是整張保底表（§4.1），S2 合併後凍結。
 */

import type { GameView, PublicModulePendingView } from '@catan/rules';
import type { Plan } from '../../economy.ts';
import type { BanditTarget, BotCommand, BotEconomyHooks, BotTradeHooks, Scored, TurnContext } from '../types.ts';

export interface TbPartBot {
  /** rules 的 part id，例如 `'tb-fishing'`。 */
  readonly id: string;
  /** frame 由第一個 `!== undefined` 的 part 勝出；只回答自己的 frame。 */
  answerFrame?(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined;
  setup?(turn: TurnContext): BotCommand | null | undefined;
  preroll?(turn: TurnContext): readonly Scored<BotCommand>[];
  actions?(turn: TurnContext): readonly Scored<BotCommand>[];
  /** 依計畫 kind 交回對應的 part；不是自己的計畫回 undefined。 */
  planStep?(turn: TurnContext, plan: Plan): BotCommand | null | undefined;
  /** 盜賊目標 fold 的一步（與 `BotModule.robberTargets` 相同）；保底路徑也會呼叫。 */
  robberTargets?(view: GameView, selfId: string, targets: readonly BanditTarget[]): readonly BanditTarget[];
  readonly economy?: BotEconomyHooks;
  readonly trade?: BotTradeHooks;
  readonly pacing?: Readonly<Record<string, number>>;
  readonly responseCommands?: readonly string[];
}
