/**
 * Trade progress cards (CK25 pp. 14–15): Commercial Harbor, Guild Dues,
 * Merchant, Merchant Fleet, Resource Monopoly and Trade Monopoly, plus the
 * answers they ask for.
 */

import { playerById } from '../../analysis.ts';
import { COMMODITIES, RESOURCES, type CardKind, type CommandOutcome, type Commodity, type GameState, type ModulePending, type Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import {
  GUILD_DUES_FRAME,
  HARBOR_FRAME,
  activeFrame,
  isOutcome,
  moduleFrame,
  otherPlayers,
  publicScore,
  type CardRule,
} from './card-common.ts';
import { countOf, forcedCards, handTotal, holdsAll, isCardKind, transferCard } from './hand.ts';
import { merchantHexes } from './merchant.ts';
import { ckState, ckView } from './state.ts';

// --- Commercial Harbor -------------------------------------------------------

/** Players the harbor's owner may still make an offer to in this window. */
export function harborTargets(state: GameState, playerId: string): string[] {
  const harbor = ckView(state).harbor;
  if (!harbor || harbor.player !== playerId || harbor.windowId !== state.windowId) return [];
  return otherPlayers(state, playerId).filter((id) => (harbor.offers[id] ?? 0) > 0);
}

const commercialHarbor: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ players: otherPlayers(state, playerId) }),
  // One offer per other player, at any time this turn (CK25 p. 14, interpretation P3-3).
  play(state, actorId, _command, ctx, spend) {
    spend();
    const slot = ckState(state);
    const previous = slot.harbor && slot.harbor.player === actorId && slot.harbor.windowId === state.windowId ? slot.harbor.offers : {};
    const offers: Record<string, number> = {};
    for (const id of otherPlayers(state, actorId)) offers[id] = (previous[id] ?? 0) + 1;
    slot.harbor = { player: actorId, windowId: state.windowId, offers };
    ctx.kit.emit(state, 'ck.harborOpened', { playerId: actorId });
    return ctx.kit.accept(state);
  },
};

function commoditiesHeld(state: GameState, playerId: string): Commodity[] {
  const player = playerById(state, playerId)!;
  return COMMODITIES.filter((commodity) => player.commodities[commodity] > 0);
}

/** `progress.harborOffer { to, resource }` — offer one resource to a player. */
export function harborOffer(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  if (kit.currentPlayer(state).id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  if (state.pending) return kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  const to = command.to;
  const resource = command.resource;
  if (typeof to !== 'string' || !harborTargets(state, actorId).includes(to)) return kit.fail('E_ILLEGAL_TARGET', { to });
  if (typeof resource !== 'string' || !(RESOURCES as readonly string[]).includes(resource)) return kit.fail('E_INVALID_SELECTION', { resource });
  const actor = playerById(state, actorId)!;
  if (actor.resources[resource as Resource] <= 0) return kit.fail('E_INSUFFICIENT_RESOURCES', { resource });
  const harbor = ckState(state).harbor!;
  harbor.offers[to] = (harbor.offers[to] ?? 0) - 1;
  const held = commoditiesHeld(state, to);
  if (held.length === 0) {
    // Nothing to give back: the resource is taken back (CK25 p. 14).
    kit.emit(state, 'ck.harborReturned', { playerId: actorId, to }, { to: [actorId, to], params: { resource } });
    return kit.accept(state);
  }
  if (held.length === 1) {
    exchange(state, actorId, to, resource as Resource, held[0]!, ctx);
    return kit.accept(state);
  }
  kit.emit(state, 'ck.harborOffered', { playerId: actorId, to }, { to: [actorId, to], params: { resource } });
  kit.enqueuePending(state, moduleFrame(HARBOR_FRAME, [to], { from: actorId, resource }));
  return kit.accept(state);
}

function exchange(state: GameState, from: string, to: string, resource: Resource, commodity: Commodity, ctx: ModuleContext): void {
  const giver = playerById(state, from)!;
  const receiver = playerById(state, to)!;
  transferCard(giver, receiver, resource);
  transferCard(receiver, giver, commodity);
  ctx.kit.emit(state, 'ck.harborExchanged', { playerId: from, to }, { to: [from, to], params: { resource, commodity } });
}

/** `progress.harborAnswer { commodity }` — the receiver picks the commodity (CK-FAQ 77). */
export function harborAnswer(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const frame = activeFrame(state, HARBOR_FRAME, actorId, ctx);
  if (isOutcome(frame)) return frame;
  const commodity = command.commodity;
  if (typeof commodity !== 'string' || !commoditiesHeld(state, actorId).includes(commodity as Commodity)) {
    return ctx.kit.fail('E_INVALID_SELECTION', { commodity });
  }
  exchange(state, frame.data.from as string, actorId, frame.data.resource as Resource, commodity as Commodity, ctx);
  frame.responders = [];
  ctx.kit.completePending(state, ctx.rng);
  return ctx.kit.accept(state);
}

// --- Guild Dues ---------------------------------------------------------------

/** Players with more VP than the player (CK25 p. 14). */
export function richerPlayers(state: GameState, playerId: string): string[] {
  const own = publicScore(state, playerId);
  return otherPlayers(state, playerId).filter((id) => publicScore(state, id) > own);
}

const guildDues: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ players: richerPlayers(state, playerId) }),
  blocked: (state, playerId) => (richerPlayers(state, playerId).length > 0 ? null : 'no-target'),
  // Look at a richer player's hand and take any 2 cards (CK25 p. 14).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const target = command.target;
    if (typeof target !== 'string' || !richerPlayers(state, actorId).includes(target)) return kit.fail('E_ILLEGAL_TARGET', { target });
    spend();
    const victim = playerById(state, target)!;
    const count = Math.min(2, handTotal(victim));
    const forced = forcedCards(victim, count);
    if (forced) {
      takeFrom(state, actorId, target, forced, ctx);
      return kit.accept(state);
    }
    kit.enqueuePending(state, moduleFrame(GUILD_DUES_FRAME, [actorId], { victim: target, count }));
    return kit.accept(state);
  },
};

function takeFrom(state: GameState, actorId: string, victimId: string, cards: CardKind[], ctx: ModuleContext): void {
  const actor = playerById(state, actorId)!;
  const victim = playerById(state, victimId)!;
  for (const card of cards) transferCard(victim, actor, card);
  ctx.kit.emit(state, 'ck.guildDuesTaken', { playerId: actorId, victim: victimId, count: cards.length }, { to: [actorId, victimId], params: { cards: cards.slice() } });
  ctx.kit.checkVictory(state);
}

/** `progress.takeCards { cards }` — the Guild Dues player picks from the hand they see. */
export function takeCards(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const frame = activeFrame(state, GUILD_DUES_FRAME, actorId, ctx);
  if (isOutcome(frame)) return frame;
  const victimId = frame.data.victim as string;
  const cards = command.cards;
  const count = frame.data.count as number;
  if (!Array.isArray(cards) || cards.length !== count) return ctx.kit.fail('E_INVALID_DISCARD_COUNT', { required: count });
  if (!holdsAll(playerById(state, victimId)!, cards)) return ctx.kit.fail('E_INVALID_SELECTION', { cards });
  takeFrom(state, actorId, victimId, cards, ctx);
  frame.responders = [];
  ctx.kit.completePending(state, ctx.rng);
  return ctx.kit.accept(state);
}

// --- Merchant, Merchant Fleet, monopolies ---------------------------------------

const merchant: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ hexes: merchantHexes(state, playerId) }),
  blocked: (state, playerId) => (merchantHexes(state, playerId).length > 0 ? null : 'no-target'),
  // Take control and place the merchant next to an own building (CK25 pp. 7, 14).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const hex = command.hex;
    if (typeof hex !== 'number' || !merchantHexes(state, actorId).includes(hex)) return kit.fail('E_ILLEGAL_TARGET', { hex });
    spend();
    const slot = ckState(state);
    const previous = slot.merchant ?? null;
    slot.merchant = { player: actorId, hex };
    kit.emit(state, 'ck.merchantPlaced', {
      playerId: actorId,
      hex,
      ...(previous ? { from: previous.player, fromHex: previous.hex } : {}),
    });
    kit.checkVictory(state);
    return kit.accept(state);
  },
};

const merchantFleet: CardRule = {
  timing: 'action',
  targets: () => ({ kinds: [...RESOURCES, ...COMMODITIES] }),
  // 2:1 with the supply for one named card kind for the rest of the turn (CK25 p. 15, CK-FAQ 109).
  play(state, actorId, command, ctx, spend) {
    const kind = command.kind;
    if (!isCardKind(kind)) return ctx.kit.fail('E_INVALID_SELECTION', { kind });
    spend();
    const slot = ckState(state);
    slot.fleets = [...(slot.fleets ?? []).filter((fleet) => fleet.windowId === state.windowId), { player: actorId, windowId: state.windowId, kind }];
    ctx.kit.emit(state, 'ck.fleetNamed', { playerId: actorId, kind });
    return ctx.kit.accept(state);
  },
};

function monopoly(card: 'resourceMonopoly' | 'tradeMonopoly', kinds: readonly CardKind[], each: number): CardRule {
  return {
    timing: 'action',
    targets: () => ({ kinds: kinds.slice() }),
    // Resource Monopoly: 2 each (1 if that is all); Trade Monopoly: 1 each (CK25 pp. 10, 15).
    play(state, actorId, command, ctx, spend) {
      const kind = command.kind as CardKind;
      if (!kinds.includes(kind)) return ctx.kit.fail('E_INVALID_SELECTION', { kind });
      spend();
      const actor = playerById(state, actorId)!;
      const taken: Record<string, number> = {};
      for (const id of otherPlayers(state, actorId)) {
        const other = playerById(state, id)!;
        const amount = Math.min(each, countOf(other, kind));
        if (amount <= 0) continue;
        transferCard(other, actor, kind, amount);
        taken[id] = amount;
      }
      ctx.kit.emit(state, 'ck.monopolyTaken', { playerId: actorId, card, kind, taken });
      ctx.kit.checkVictory(state);
      return ctx.kit.accept(state);
    },
  };
}

export const TRADE_RULES = {
  commercialHarbor,
  guildDues,
  merchant,
  merchantFleet,
  resourceMonopoly: monopoly('resourceMonopoly', RESOURCES, 2),
  tradeMonopoly: monopoly('tradeMonopoly', COMMODITIES, 1),
} satisfies Record<string, CardRule>;

/** Viewer data for the trade frames: the hand or resource only the right player sees. */
export function projectTradeFrame(state: GameState, frame: ModulePending, viewerId: string): Record<string, unknown> | null {
  if (frame.kind === HARBOR_FRAME) {
    const from = frame.data.from as string;
    const sees = viewerId === from || frame.responders.includes(viewerId);
    return { from, ...(sees ? { resource: frame.data.resource } : {}) };
  }
  if (frame.kind === GUILD_DUES_FRAME) {
    const victim = frame.data.victim as string;
    const sees = frame.responders.includes(viewerId);
    const hand = sees ? Object.fromEntries([...RESOURCES, ...COMMODITIES].map((card) => [card, countOf(playerById(state, victim)!, card)]).filter(([, n]) => (n as number) > 0)) : undefined;
    return { victim, count: frame.data.count, ...(hand ? { hand } : {}) };
  }
  return null;
}
