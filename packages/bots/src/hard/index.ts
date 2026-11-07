/**
 * hard 策略（docs/aegis/specs/2026-11-07-hard-bot.md）。只支援沒有 rules module 的 profile
 * （`hardSupports`）；房間不會在其他 profile 提供 hard，萬一遇到也直接交給 standard。流程與
 * standard 相同（每次只決定一個指令、不保留跨呼叫狀態），各決策點換成 hard 的版本。
 */

import { requireProfile, type GameView, type PublicModulePendingView, type PublicPendingView } from '@catan/rules';
import { plentyPick } from '../base/cards.ts';
import { freeRoadDecision } from '../base/roads.ts';
import { fallbackDecision } from '../fallback.ts';
import { heuristicPolicy } from '../heuristic.ts';
import { isModuleFrame } from '../modules/compose.ts';
import type { BotModule } from '../modules/types.ts';
import { hardSupports } from '../support.ts';
import type { BotCommand, BotContext, BotPolicy } from '../types.ts';
import { hardActionDecision, hardRespond } from './action.ts';
import { hardDiscard } from './cards.ts';
import { hardKnightDecision, hardStealVictim, robberTarget } from './robber.ts';
import { hardSetupDecision } from './setup.ts';
import { HardTurn } from './turn.ts';

type BasePending = Exclude<NonNullable<PublicPendingView>, PublicModulePendingView>;

function pendingDecision(turn: HardTurn, pending: BasePending): BotCommand | null {
  const { ctx } = turn;
  switch (pending.kind) {
    case 'discard':
      if (!pending.waitingFor.includes(ctx.selfId)) return null;
      return hardDiscard(turn, pending.required[ctx.selfId] ?? 0);
    case 'moveRobber': {
      if (pending.actor !== ctx.selfId) return null;
      const hex = robberTarget(turn);
      return hex === null ? null : { type: 'pending.moveRobber', hex };
    }
    case 'steal': {
      if (pending.actor !== ctx.selfId) return null;
      const victim = hardStealVictim(turn, pending.candidates);
      return victim === null ? null : { type: 'pending.steal', victim };
    }
    case 'yearOfPlenty': {
      if (pending.actor !== ctx.selfId) return null;
      const resource = plentyPick(turn);
      return resource === null ? null : { type: 'pending.takeResource', resource };
    }
    case 'freeRoads':
      if (pending.actor !== ctx.selfId) return null;
      return freeRoadDecision(turn);
  }
}

function decide(view: GameView, ctx: BotContext, standard: BotPolicy): BotCommand | null {
  if (view.result) return null;
  if (!hardSupports(requireProfile(view.profileId))) return standard.decide(view, ctx);
  const me = view.players.find((player) => player.id === ctx.selfId);
  if (!me || !view.hints) return null;
  const turn = new HardTurn(view, ctx, me);
  const duty = (): BotCommand | null => fallbackDecision(view, ctx.selfId, []);
  const pending = view.pending;
  if (pending) {
    // base profile 沒有模組 frame；保險起見交給保底。
    if (isModuleFrame(pending)) return duty();
    return pendingDecision(turn, pending) ?? duty();
  }
  if (view.turn.phase === 'setup') {
    if (view.turn.playerId !== ctx.selfId) return null;
    return hardSetupDecision(turn) ?? duty();
  }
  if (view.turn.playerId !== ctx.selfId) return hardRespond(turn);
  // 擲骰前只考慮騎士；擲骰交給保底義務。
  if (view.turn.phase === 'preroll') return hardKnightDecision(turn) ?? duty();
  if (view.turn.phase === 'action') return hardActionDecision(turn, duty);
  return null;
}

/** hard 策略；`modules` 只給 hard 不支援的 profile 交給 standard 時使用（同 `createBotPolicy`）。 */
export function hardPolicy(modules?: readonly BotModule[]): BotPolicy {
  const standard = heuristicPolicy('standard', modules);
  return { decide: (view, ctx) => decide(view, ctx, standard) };
}
