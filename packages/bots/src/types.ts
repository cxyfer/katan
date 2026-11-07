/**
 * 電腦對手的策略合約（SPEC §4.9）。
 *
 * 策略只拿得到自己座位的投影 `GameView` 與 `BotContext`；型別上沒有
 * `GameState`，所以無法讀取其他座位的隱藏資訊（§8.3）。
 */

import type { Command, GameView, ModuleCommand } from '@catan/rules';

/** Bot 可送出的指令；協定的 command 本來就是開放型別（protocol/src/index.ts:299-303）。 */
export type BotCommand = Command | ModuleCommand;

/** 由弱到強；`hard` 只在沒有 rules module 的 profile 提供（`botLevelsFor`）。 */
export type BotLevel = 'easy' | 'standard' | 'hard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'standard', 'hard'];
export const DEFAULT_BOT_LEVEL: BotLevel = 'standard';

export function isBotLevel(value: unknown): value is BotLevel {
  return typeof value === 'string' && (BOT_LEVELS as readonly string[]).includes(value);
}

/**
 * 排程器觀察到的、Bot 自己開出且仍 open 的報價階段。時間由排程器掌握，
 * 策略只看階段，因此決策仍是決定性的。
 */
export type OfferPhase = 'collecting' | 'ready' | 'expired';

export interface BotContext {
  /** 這個策略代表的座位；`view` 就是這個座位的投影。 */
  readonly selfId: string;
  readonly level: BotLevel;
  /** 32-bit 無號整數種子，由 `botSeed(gameId, botId, revision, attempt)` 推導。 */
  readonly seed: number;
  /** 自己 open 報價的階段；缺漏的 offerId 一律視為 `expired`。 */
  readonly offerPhases: Readonly<Record<string, OfferPhase>>;
}

export interface BotPolicy {
  /**
   * 回傳 `selfId` 此刻該送出的指令；此刻無事可做時回傳 null。必須是純函式：
   * 不讀時間與環境、不保留跨呼叫狀態，隨機性只來自 `ctx.seed`。
   */
  decide(view: GameView, ctx: BotContext): BotCommand | null;
}
