/**
 * Resource and commodity hand helpers for the progress-card effects. Every
 * move keeps "supply + hands" constant per card kind.
 */

import type { Rng } from '../../rng.ts';
import { CARD_KINDS, COMMODITIES, type CardKind, type Commodity, type GameState, type PlayerState } from '../../types.ts';

export function isCommodityKind(card: CardKind): card is Commodity {
  return (COMMODITIES as readonly string[]).includes(card);
}

export function isCardKind(value: unknown): value is CardKind {
  return typeof value === 'string' && (CARD_KINDS as readonly string[]).includes(value);
}

export function countOf(player: PlayerState, card: CardKind): number {
  return isCommodityKind(card) ? player.commodities[card] : player.resources[card];
}

export function handTotal(player: PlayerState): number {
  return CARD_KINDS.reduce((sum, card) => sum + countOf(player, card), 0);
}

export function handCounts(player: PlayerState): Partial<Record<CardKind, number>> {
  const out: Partial<Record<CardKind, number>> = {};
  for (const card of CARD_KINDS) if (countOf(player, card) > 0) out[card] = countOf(player, card);
  return out;
}

function adjust(player: PlayerState, card: CardKind, amount: number): void {
  if (isCommodityKind(card)) player.commodities[card] += amount;
  else player.resources[card] += amount;
}

export function transferCard(from: PlayerState, to: PlayerState, card: CardKind, amount = 1): void {
  adjust(from, card, -amount);
  adjust(to, card, amount);
}

/** Moves cards between a hand and its supply (negative = back to the supply). */
export function supplyMove(state: GameState, player: PlayerState, card: CardKind, amount: number): void {
  adjust(player, card, amount);
  if (isCommodityKind(card)) state.commodityBank[card] -= amount;
  else state.bank[card] -= amount;
}

export function supplyOf(state: GameState, card: CardKind): number {
  return isCommodityKind(card) ? state.commodityBank[card] : state.bank[card];
}

/** True when the hand holds every listed card (with repeats). */
export function holdsAll(player: PlayerState, cards: unknown): cards is CardKind[] {
  if (!Array.isArray(cards) || !cards.every(isCardKind)) return false;
  const need: Partial<Record<CardKind, number>> = {};
  for (const card of cards) need[card] = (need[card] ?? 0) + 1;
  return (Object.entries(need) as [CardKind, number][]).every(([card, amount]) => countOf(player, card) >= amount);
}

/**
 * The only possible choice of `count` cards from a hand, or null when the
 * holder has a real choice: the whole hand when it has no more than `count`
 * cards, or `count` cards of the single kind it holds (interpretation P3-2).
 */
export function forcedCards(player: PlayerState, count: number): CardKind[] | null {
  const kinds = CARD_KINDS.filter((card) => countOf(player, card) > 0);
  const total = handTotal(player);
  if (count <= 0) return [];
  if (total <= count) return kinds.flatMap((card) => Array<CardKind>(countOf(player, card)).fill(card));
  if (kinds.length === 1) return Array<CardKind>(count).fill(kinds[0]!);
  return null;
}

/** A uniformly random card of the hand (resources first, as the robber draws). */
export function randomCard(player: PlayerState, rng: Rng): CardKind | null {
  const pool: CardKind[] = [];
  for (const card of CARD_KINDS) for (let i = 0; i < countOf(player, card); i++) pool.push(card);
  if (pool.length === 0) return null;
  return pool[rng.int(pool.length)]!;
}
