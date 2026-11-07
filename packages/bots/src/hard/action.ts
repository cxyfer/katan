/** hard 的行動階段與報價回應。 */

import { RESOURCES, type Command } from '@catan/rules';
import { handRelief } from '../heuristic.ts';
import { offersAwaitingMe, ownOfferStep, ownOpenOffers } from '../trade.ts';
import type { BotCommand } from '../types.ts';
import { hardBuildDecision } from './build.ts';
import { hardDevCardDecision } from './cards.ts';
import { winningLine } from './endgame.ts';
import { hardAccepts } from './trade.ts';
import type { HardTurn } from './turn.ts';

export function hardActionDecision(turn: HardTurn, duty: () => BotCommand | null): BotCommand | null {
  const { view, ctx } = turn;

  // 1. 自己的報價：結算、撤回或等待。等待期間不做別的事，避免手牌變動。
  const own = ownOpenOffers(view, ctx.selfId)[0];
  if (own) {
    return ownOfferStep(view, turn.economy, own, ctx.offerPhases[own.id] ?? 'expired', !turn.pairedSecond);
  }

  // 2. 別人直接對我（行動者）提出的反報價：划算就結算，否則拒絕。
  for (const offer of offersAwaitingMe(view, ctx.selfId)) {
    const proposer = turn.player(offer.from);
    const proposerCanPay = (proposer?.handSize ?? 0) >= RESOURCES.reduce((sum, r) => sum + (offer.give[r] ?? 0), 0);
    if (offer.to === ctx.selfId && !turn.pairedSecond && proposerCanPay && hardAccepts(turn, offer)) {
      return { type: 'trade.settle', offerId: offer.id };
    }
    return { type: 'trade.respond', offerId: offer.id, response: 'declined' };
  }

  // 3. 發展卡。
  const card = hardDevCardDecision(turn);
  if (card) return card;

  // 4. 終盤：這回合能靠交易與建造拿到勝利分數時，照那個序列做。
  const winning = winningLine(turn);
  if (winning) return winning.first;

  // 5. 建造、國內交易與銀行交易。
  const build = hardBuildDecision(turn);
  if (build) return build;

  // 6. 手牌太多時先消化，降低擲出 7 時的損失。
  const relief = handRelief(turn);
  if (relief) return relief;

  return duty();
}

/** 非行動者：回應給自己的報價。 */
export function hardRespond(turn: HardTurn): Command | null {
  const { view, ctx } = turn;
  if (view.turn.phase !== 'action') return null;
  for (const offer of offersAwaitingMe(view, ctx.selfId)) {
    return { type: 'trade.respond', offerId: offer.id, response: hardAccepts(turn, offer) ? 'consented' : 'declined' };
  }
  return null;
}
