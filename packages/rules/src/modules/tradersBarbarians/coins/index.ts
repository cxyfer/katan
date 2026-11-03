/**
 * Coins (TB25 pp. 12, 16, 21): gold is public, finite (40 coins worth 100
 * gold), tradeable between players, never a resource card. Shared by Rivers
 * of Catan, Barbarian Attack and Traders & Barbarians.
 */

import { harborRates, playerById } from '../../../analysis.ts';
import { playerStats } from '../../../stats.ts';
import { RESOURCES, type GameState, type Resource } from '../../../types.ts';
import type { ModuleCommand, ModuleContext } from '../../types.ts';
import type { TbPart } from '../part.ts';
import { partState, requirePartState, setPartState } from '../state.ts';

export const COINS = 'tb-coins';
/** 15 five-gold and 25 one-gold coins (p. 11). */
export const GOLD_SUPPLY = 100;
/** Gold paid for one resource of choice, and how often per turn (p. 12). */
export const GOLD_PER_RESOURCE = 2;
export const PURCHASES_PER_TURN = 2;

export interface CoinsState {
  gold: Record<string, number>;
  supply: number;
  /** Resources bought from the supply this window, per player. */
  purchases: Record<string, { windowId: number; count: number }>;
}

export function coins(state: GameState): CoinsState {
  return requirePartState<CoinsState>(state, COINS);
}

export function goldOf(state: GameState, playerId: string): number {
  return partState<CoinsState>(state, COINS)?.gold[playerId] ?? 0;
}

/**
 * Pays gold from the supply. The supply is finite; when it runs short the
 * player receives what is left (TB25 is silent on an empty supply; FIDELITY).
 * Returns the amount actually paid.
 */
export function grantGold(state: GameState, playerId: string, amount: number, cause: string, ctx: ModuleContext): number {
  const slot = coins(state);
  const paid = Math.max(0, Math.min(amount, slot.supply));
  if (paid <= 0) return 0;
  slot.supply -= paid;
  slot.gold[playerId] = (slot.gold[playerId] ?? 0) + paid;
  ctx.kit.emit(state, 'tb.goldGained', { playerId, amount: paid, cause });
  return paid;
}

/** Moves gold from a player to another player, or back to the supply (`to` null). */
export function payGold(state: GameState, from: string, to: string | null, amount: number): void {
  const slot = coins(state);
  slot.gold[from] = (slot.gold[from] ?? 0) - amount;
  if (to) slot.gold[to] = (slot.gold[to] ?? 0) + amount;
  else slot.supply += amount;
}

function ownActionWindow(state: GameState, actorId: string, ctx: ModuleContext) {
  if (ctx.kit.currentPlayer(state).id !== actorId) return ctx.kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return ctx.kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  return null;
}

function buyResource(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const guard = ownActionWindow(state, actorId, ctx);
  if (guard) return guard;
  const resource = command.resource as Resource;
  if (!RESOURCES.includes(resource)) return ctx.kit.fail('E_INVALID_SELECTION', { resource: command.resource });
  const slot = coins(state);
  const used = slot.purchases[actorId]?.windowId === state.windowId ? slot.purchases[actorId]!.count : 0;
  if (used >= PURCHASES_PER_TURN) return ctx.kit.fail('E_TB_PURCHASE_LIMIT', { limit: PURCHASES_PER_TURN });
  if (goldOf(state, actorId) < GOLD_PER_RESOURCE) return ctx.kit.fail('E_TB_GOLD_SHORT', { cost: GOLD_PER_RESOURCE });
  if (state.bank[resource] <= 0) return ctx.kit.fail('E_BANK_EMPTY', { resource });
  payGold(state, actorId, null, GOLD_PER_RESOURCE);
  slot.purchases[actorId] = { windowId: state.windowId, count: used + 1 };
  state.bank[resource] -= 1;
  playerById(state, actorId)!.resources[resource] += 1;
  ctx.kit.emit(state, 'tb.goldBought', { playerId: actorId, resource, gold: GOLD_PER_RESOURCE });
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

function sellResources(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const guard = ownActionWindow(state, actorId, ctx);
  if (guard) return guard;
  const resource = command.resource as Resource;
  if (!RESOURCES.includes(resource)) return ctx.kit.fail('E_INVALID_SELECTION', { resource: command.resource });
  const rate = harborRates(state, actorId)[resource];
  const player = playerById(state, actorId)!;
  if (player.resources[resource] < rate) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { resource, required: rate });
  if (coins(state).supply <= 0) return ctx.kit.fail('E_TB_GOLD_SUPPLY_EMPTY');
  player.resources[resource] -= rate;
  state.bank[resource] += rate;
  const stats = playerStats(state, actorId);
  stats.bankTrades += 1;
  stats.bankGiven[resource] += rate;
  ctx.kit.emit(state, 'tb.goldSold', { playerId: actorId, resource, rate });
  grantGold(state, actorId, 1, 'sale', ctx);
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

export const coinsPart: TbPart = {
  id: COINS,
  initGame(state) {
    setPartState<CoinsState>(state, COINS, {
      gold: Object.fromEntries(state.players.map((player) => [player.id, 0])),
      supply: GOLD_SUPPLY,
      purchases: {},
    });
  },
  commands: {
    'tb.buyResource': buyResource,
    'tb.sellResources': sellResources,
  },
  tradeGoods: {
    ids: () => ['gold'],
    balance: (state, playerId, good) => (good === 'gold' ? goldOf(state, playerId) : 0),
    transfer: (state, from, to, good, amount) => {
      if (good === 'gold') payGold(state, from, to, amount);
    },
  },
  project(state, viewerId) {
    const slot = partState<CoinsState>(state, COINS);
    if (!slot) return null;
    const used = slot.purchases[viewerId]?.windowId === state.windowId ? slot.purchases[viewerId]!.count : 0;
    return {
      gold: { ...slot.gold },
      supply: slot.supply,
      purchasesLeft: Math.max(0, PURCHASES_PER_TURN - used),
      goldPerResource: GOLD_PER_RESOURCE,
    };
  },
  actionHints(state, playerId) {
    const own = state.players[state.turn.seat]?.id === playerId && state.turn.phase === 'action' && !state.pending;
    return { canTrade: own, sellRates: harborRates(state, playerId) };
  },
};
