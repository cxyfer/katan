/**
 * Politics progress cards (CK25 pp. 15–16): Diplomacy, Encouragement,
 * Espionage, Intrigue, Sabotage, Taxation, Treason and Wedding, plus the
 * answers they ask for. Constitution is a VP card and is revealed when drawn
 * (`progress.ts`).
 */

import { countRoads, isLandHex, playerById, topologyOf } from '../../analysis.ts';
import { verticesOfHex } from '../../topology.ts';
import type { CardKind, CommandOutcome, GameState, ModulePending, ProgressCardType } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import { insertPendingNext } from '../../pending.ts';
import {
  DIPLOMACY_FRAME,
  ESPIONAGE_FRAME,
  SABOTAGE_FRAME,
  TREASON_PLACE_FRAME,
  TREASON_REMOVE_FRAME,
  WEDDING_FRAME,
  activeFrame,
  answered,
  isOutcome,
  moduleFrame,
  otherPlayers,
  publicScore,
  type CardRule,
} from './card-common.ts';
import type { KnightLevel } from './constants.ts';
import { forcedCards, handTotal, holdsAll, randomCard, supplyMove, transferCard } from './hand.ts';
import { DISPLACED_FRAME, knightReach, knightsInSupply, knightsOf, recruitSites } from './knights.ts';
import { ckState, ckView, knightAt, type Knight } from './state.ts';
import { playerStats } from '../../stats.ts';

// --- Diplomacy -----------------------------------------------------------------

function ownRoadsAt(state: GameState, playerId: string, vertex: number, except: number): number[] {
  const topo = topologyOf(state);
  return topo.vertices[vertex]!.edges.filter((edge) => edge !== except && state.board.roads[edge]?.player === playerId && !state.board.roads[edge]!.ship);
}

function isAnchor(state: GameState, playerId: string, vertex: number): boolean {
  return state.board.buildings[vertex]?.player === playerId || knightAt(state, vertex)?.player === playerId;
}

function heldByOther(state: GameState, playerId: string, vertex: number): boolean {
  const building = state.board.buildings[vertex];
  if (building) return building.player !== playerId;
  const knight = knightAt(state, vertex);
  return !!knight && knight.player !== playerId;
}

/** Own buildings and knights reached from `start` along own roads, never crossing `except`. */
function anchorsFrom(state: GameState, playerId: string, start: number, except: number): Set<number> {
  const topo = topologyOf(state);
  const found = new Set<number>();
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const vertex = queue.shift()!;
    if (isAnchor(state, playerId, vertex)) {
      found.add(vertex);
      continue;
    }
    // Another player's piece interrupts the route.
    if (heldByOther(state, playerId, vertex)) continue;
    for (const edge of ownRoadsAt(state, playerId, vertex, except)) {
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return found;
}

/**
 * An "open" road (CK25 p. 15): one of its ends touches neither another road
 * nor a building of its owner, and it is not part of a continuous route
 * joining two of the owner's buildings and/or knights. Another player's piece
 * at an end does not open it (CK-FAQ 89).
 */
export function isOpenRoad(state: GameState, edge: number): boolean {
  const road = state.board.roads[edge];
  if (!road || road.ship) return false;
  const owner = road.player;
  const [u, v] = topologyOf(state).edges[edge]!.vertices;
  const closed = (vertex: number) => state.board.buildings[vertex]?.player === owner || ownRoadsAt(state, owner, vertex, edge).length > 0;
  if (closed(u) && closed(v)) return false;
  const left = anchorsFrom(state, owner, u, edge);
  const right = anchorsFrom(state, owner, v, edge);
  const joins = [...left].some((a) => [...right].some((b) => a !== b));
  return !joins;
}

export function openRoads(state: GameState): number[] {
  const out: number[] = [];
  state.board.roads.forEach((road, edge) => {
    if (road && isOpenRoad(state, edge)) out.push(edge);
  });
  return out;
}

const diplomacy: CardRule = {
  timing: 'action',
  targets: (state) => ({ edges: openRoads(state) }),
  blocked: (state) => (openRoads(state).length > 0 ? null : 'no-target'),
  // Remove an open road; an own road may be rebuilt for free at once (CK25 p. 15, CK-FAQ 88, 92–93).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const edge = command.edge;
    if (typeof edge !== 'number' || !isOpenRoad(state, edge)) return kit.fail('E_ILLEGAL_TARGET', { edge });
    spend();
    const owner = state.board.roads[edge]!.player;
    state.board.roads[edge] = null;
    kit.emit(state, 'ck.roadRemoved', { playerId: actorId, owner, edge });
    const edges = owner === actorId ? kit.legalRoads(state, actorId) : [];
    if (edges.length > 0) {
      // Longest Road is settled after the replacement (CK-FAQ 88).
      kit.enqueuePending(state, moduleFrame(DIPLOMACY_FRAME, [actorId], { edge, edges }));
      return kit.accept(state);
    }
    kit.afterBoardChange(state);
    kit.checkVictory(state);
    return kit.accept(state);
  },
};

/** `progress.diplomacyRoad { edge | null }` — place the free road, or decline. */
export function diplomacyRoad(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = activeFrame(state, DIPLOMACY_FRAME, actorId, ctx);
  if (isOutcome(frame)) return frame;
  const edge = command.edge;
  if (edge !== null) {
    if (typeof edge !== 'number' || !kit.legalRoads(state, actorId).includes(edge)) return kit.fail('E_ILLEGAL_TARGET', { edge });
    if (countRoads(state, actorId) >= ctx.profile.pieces.roads) return kit.fail('E_NO_PIECES', { piece: 'road' });
    state.board.roads[edge] = { player: actorId, ship: false };
    playerStats(state, actorId).freeRoadsBuilt += 1;
    kit.emit(state, 'ck.diplomacyRoadBuilt', { playerId: actorId, edge });
  } else {
    kit.emit(state, 'ck.diplomacyRoadSkipped', { playerId: actorId });
  }
  kit.afterBoardChange(state);
  frame.responders = [];
  kit.completePending(state, ctx.rng);
  kit.checkVictory(state);
  return kit.accept(state);
}

// --- Encouragement ----------------------------------------------------------------

const encouragement: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ vertices: knightsOf(state, playerId).filter((knight) => !knight.active).map((knight) => knight.vertex) }),
  // Activate every own knight for free; like the Activate action, they cannot act this turn (P3-7).
  play(state, actorId, _command, ctx, spend) {
    spend();
    const vertices: number[] = [];
    for (const knight of ckState(state).knights) {
      if (knight.player !== actorId || knight.active) continue;
      knight.active = true;
      knight.activatedIn = state.windowId;
      vertices.push(knight.vertex);
    }
    ctx.kit.emit(state, 'ck.knightsEncouraged', { playerId: actorId, vertices });
    return ctx.kit.accept(state);
  },
};

// --- Espionage -------------------------------------------------------------------

const espionage: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ players: otherPlayers(state, playerId) }),
  // Look at another player's progress cards and maybe take one (CK25 pp. 10, 15).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const target = command.target;
    if (typeof target !== 'string' || !otherPlayers(state, actorId).includes(target)) return kit.fail('E_ILLEGAL_TARGET', { target });
    spend();
    const count = playerById(state, target)!.progressCards.length;
    kit.emit(state, 'ck.espionageLooked', { playerId: actorId, victim: target, count });
    if (count > 0) kit.enqueuePending(state, moduleFrame(ESPIONAGE_FRAME, [actorId], { victim: target }));
    return kit.accept(state);
  },
};

/** `progress.takeProgress { card | null }` — take one of the cards seen, or none. */
export function takeProgress(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = activeFrame(state, ESPIONAGE_FRAME, actorId, ctx);
  if (isOutcome(frame)) return frame;
  const victimId = frame.data.victim as string;
  const victim = playerById(state, victimId)!;
  const card = command.card;
  if (card !== null) {
    const index = typeof card === 'string' ? victim.progressCards.indexOf(card as ProgressCardType) : -1;
    if (index < 0) return kit.fail('E_CARD_NOT_HELD', { card });
    victim.progressCards.splice(index, 1);
    playerById(state, actorId)!.progressCards.push(card as ProgressCardType);
  }
  kit.emit(state, 'ck.espionageTaken', { playerId: actorId, victim: victimId, took: card !== null }, card !== null ? { to: [actorId, victimId], params: { card } } : undefined);
  frame.responders = [];
  kit.completePending(state, ctx.rng);
  return kit.accept(state);
}

// --- Intrigue ---------------------------------------------------------------------

/** Opponent knights on intersections touching one of the player's routes (CK25 p. 15). */
export function intrigueTargets(state: GameState, playerId: string): number[] {
  const topo = topologyOf(state);
  return ckView(state).knights
    .filter((knight) => knight.player !== playerId && topo.vertices[knight.vertex]!.edges.some((edge) => state.board.roads[edge]?.player === playerId))
    .map((knight) => knight.vertex)
    .sort((a, b) => a - b);
}

const intrigue: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ vertices: intrigueTargets(state, playerId) }),
  blocked: (state, playerId) => (intrigueTargets(state, playerId).length > 0 ? null : 'no-target'),
  // Displace a knight without a knight of one's own; any strength (CK25 p. 15).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const vertex = command.vertex;
    if (typeof vertex !== 'number' || !intrigueTargets(state, actorId).includes(vertex)) return kit.fail('E_ILLEGAL_TARGET', { vertex });
    spend();
    const slot = ckState(state);
    const victim = knightAt(state, vertex)!;
    slot.knights = slot.knights.filter((knight) => knight !== victim);
    kit.emit(state, 'ck.knightIntrigued', { playerId: actorId, victim: victim.player, vertex, level: victim.level });
    const options = knightReach(state, victim.player, vertex).moves;
    if (options.length === 0) {
      kit.emit(state, 'ck.knightRemoved', { playerId: victim.player, vertex, level: victim.level });
    } else {
      kit.enqueuePending(state, moduleFrame(DISPLACED_FRAME, [victim.player], { knight: { ...victim }, from: vertex }));
    }
    kit.afterBoardChange(state);
    kit.checkVictory(state);
    return kit.accept(state);
  },
};

// --- Sabotage and Wedding ----------------------------------------------------------

/** Sabotage victims and their discards: half of the hand, rounded down (CK25 p. 16). */
export function sabotageVictims(state: GameState, playerId: string): Record<string, number> {
  const own = publicScore(state, playerId);
  const out: Record<string, number> = {};
  for (const id of otherPlayers(state, playerId)) {
    const half = Math.floor(handTotal(playerById(state, id)!) / 2);
    if (publicScore(state, id) >= own && half > 0) out[id] = half;
  }
  return out;
}

/** Wedding givers and their gifts: 2 cards, or all they have (CK25 p. 16). */
export function weddingGivers(state: GameState, playerId: string): Record<string, number> {
  const own = publicScore(state, playerId);
  const out: Record<string, number> = {};
  for (const id of otherPlayers(state, playerId)) {
    const count = Math.min(2, handTotal(playerById(state, id)!));
    if (publicScore(state, id) > own && count > 0) out[id] = count;
  }
  return out;
}

function sabotageDiscardCards(state: GameState, playerId: string, cards: CardKind[], ctx: ModuleContext): void {
  const player = playerById(state, playerId)!;
  for (const card of cards) supplyMove(state, player, card, -1);
  ctx.kit.emit(state, 'ck.sabotageDiscarded', { playerId, count: cards.length }, { to: [playerId], params: { cards: cards.slice() } });
}

function weddingGive(state: GameState, giverId: string, to: string, cards: CardKind[], ctx: ModuleContext): void {
  const giver = playerById(state, giverId)!;
  const receiver = playerById(state, to)!;
  for (const card of cards) transferCard(giver, receiver, card);
  ctx.kit.emit(state, 'ck.weddingGift', { playerId: giverId, to, count: cards.length }, { to: [giverId, to], params: { cards: cards.slice() } });
}

/**
 * Applies forced answers at once and asks the others (interpretation P3-2).
 * `apply` hands over or discards the given cards.
 */
function collectCards(
  state: GameState,
  required: Record<string, number>,
  kind: string,
  data: Record<string, unknown>,
  apply: (playerId: string, cards: CardKind[]) => void,
  ctx: ModuleContext,
): void {
  const responders: string[] = [];
  for (const [id, count] of Object.entries(required)) {
    const forced = forcedCards(playerById(state, id)!, count);
    if (forced) apply(id, forced);
    else responders.push(id);
  }
  if (responders.length > 0) ctx.kit.enqueuePending(state, moduleFrame(kind, responders, { ...data, required }));
}

const sabotage: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ players: Object.keys(sabotageVictims(state, playerId)) }),
  // Players with as many or more VP discard half their cards, choosing them (CK25 p. 16, CK-FAQ 110).
  play(state, actorId, _command, ctx, spend) {
    spend();
    const required = sabotageVictims(state, actorId);
    ctx.kit.emit(state, 'ck.sabotageRequired', { playerId: actorId, required });
    collectCards(state, required, SABOTAGE_FRAME, { actor: actorId }, (id, cards) => sabotageDiscardCards(state, id, cards, ctx), ctx);
    return ctx.kit.accept(state);
  },
};

const wedding: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ players: Object.keys(weddingGivers(state, playerId)) }),
  // Each richer player gives 2 cards of their choice (CK25 p. 16).
  play(state, actorId, _command, ctx, spend) {
    spend();
    const required = weddingGivers(state, actorId);
    ctx.kit.emit(state, 'ck.weddingRequired', { playerId: actorId, required });
    collectCards(state, required, WEDDING_FRAME, { actor: actorId }, (id, cards) => weddingGive(state, id, actorId, cards, ctx), ctx);
    ctx.kit.checkVictory(state);
    return ctx.kit.accept(state);
  },
};

function answerCards(kind: typeof SABOTAGE_FRAME | typeof WEDDING_FRAME) {
  return (state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome => {
    const frame = activeFrame(state, kind, actorId, ctx);
    if (isOutcome(frame)) return frame;
    const required = (frame.data.required as Record<string, number>)[actorId]!;
    const cards = command.cards;
    if (!Array.isArray(cards) || cards.length !== required) return ctx.kit.fail('E_INVALID_DISCARD_COUNT', { required });
    if (!holdsAll(playerById(state, actorId)!, cards)) return ctx.kit.fail('E_INVALID_SELECTION', { cards });
    if (kind === SABOTAGE_FRAME) sabotageDiscardCards(state, actorId, cards, ctx);
    else weddingGive(state, actorId, frame.data.actor as string, cards, ctx);
    answered(state, frame, actorId, ctx);
    return ctx.kit.accept(state);
  };
}

/** `progress.sabotageDiscard { cards }` */
export const sabotageDiscard = answerCards(SABOTAGE_FRAME);
/** `progress.weddingGive { cards }` */
export const weddingAnswer = answerCards(WEDDING_FRAME);

// --- Taxation ----------------------------------------------------------------------

/** Robber destinations: any other land hex (CK-FAQ 75). */
export function taxationHexes(state: GameState): number[] {
  const out: number[] = [];
  state.board.layout.terrain.forEach((_terrain, hex) => {
    if (hex !== state.board.robber && isLandHex(state, hex)) out.push(hex);
  });
  return out;
}

const taxation: CardRule = {
  timing: 'action',
  targets: (state) => ({ hexes: taxationHexes(state) }),
  blocked: (state) => (ckView(state).attacks === 0 ? 'robber-inactive' : null),
  // Move the robber only (never the pirate) and steal 1 card from each player there (CK25 p. 16, CK-FAQ 63, 73–75).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    if (ckView(state).attacks === 0) return kit.fail('E_ROBBER_INACTIVE');
    const hex = command.hex;
    if (typeof hex !== 'number' || !isLandHex(state, hex)) return kit.fail('E_ILLEGAL_TARGET', { hex });
    if (hex === state.board.robber) return kit.fail('E_ROBBER_SAME_HEX', { hex });
    spend();
    state.board.robber = hex;
    playerStats(state, actorId).robberMoves += 1;
    kit.emit(state, 'ck.taxationMoved', { playerId: actorId, hex });
    const topo = topologyOf(state);
    const owners = new Set(verticesOfHex(topo, hex).map((vertex) => state.board.buildings[vertex]?.player).filter((id): id is string => !!id));
    for (const id of otherPlayers(state, actorId)) {
      if (!owners.has(id)) continue;
      const victim = playerById(state, id)!;
      const card = randomCard(victim, ctx.rng);
      if (!card) continue;
      transferCard(victim, playerById(state, actorId)!, card);
      kit.emit(state, 'ck.taxationStole', { playerId: actorId, victim: id }, { to: [actorId, id], params: { card } });
    }
    kit.afterBoardChange(state);
    kit.checkVictory(state);
    return kit.accept(state);
  },
};

// --- Treason -----------------------------------------------------------------------

export function treasonTargets(state: GameState, playerId: string): string[] {
  return otherPlayers(state, playerId).filter((id) => knightsOf(state, id).length > 0);
}

/** Strengths the player may place for a removed knight of `level` (same or lower, in supply). */
export function treasonLevels(state: GameState, playerId: string, level: KnightLevel): KnightLevel[] {
  if (recruitSites(state, playerId).length === 0) return [];
  return ([1, 2, 3] as KnightLevel[]).filter((candidate) => candidate <= level && knightsInSupply(state, playerId, candidate) > 0);
}

const treason: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ players: treasonTargets(state, playerId) }),
  blocked: (state, playerId) => (treasonTargets(state, playerId).length > 0 ? null : 'no-target'),
  // The chosen player removes a knight of their choice; the player may place one (CK25 p. 16, CK-FAQ 82–87).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const target = command.target;
    if (typeof target !== 'string' || !treasonTargets(state, actorId).includes(target)) return kit.fail('E_ILLEGAL_TARGET', { target });
    spend();
    kit.emit(state, 'ck.treasonChosen', { playerId: actorId, victim: target });
    const knights = knightsOf(state, target);
    if (knights.length === 1) {
      removeForTreason(state, actorId, knights[0]!, ctx, false);
      return kit.accept(state);
    }
    kit.enqueuePending(state, moduleFrame(TREASON_REMOVE_FRAME, [target], { actor: actorId }));
    return kit.accept(state);
  },
};

function removeForTreason(state: GameState, actorId: string, knight: Knight, ctx: ModuleContext, inFrame: boolean): void {
  const { kit } = ctx;
  const slot = ckState(state);
  slot.knights = slot.knights.filter((candidate) => candidate !== knight);
  kit.emit(state, 'ck.treasonRemoved', { playerId: knight.player, vertex: knight.vertex, level: knight.level, active: knight.active });
  kit.afterBoardChange(state);
  const levels = treasonLevels(state, actorId, knight.level);
  const place = levels.length > 0 ? moduleFrame(TREASON_PLACE_FRAME, [actorId], { level: knight.level, active: knight.active, from: knight.vertex }) : null;
  if (!place) kit.emit(state, 'ck.treasonNoPlace', { playerId: actorId });
  if (inFrame) {
    if (place) insertPendingNext(state, place);
    kit.completePending(state, ctx.rng);
  } else if (place) {
    kit.enqueuePending(state, place);
  }
  kit.checkVictory(state);
}

/** `progress.treasonRemove { vertex }` — the chosen player gives up one of their knights. */
export function treasonRemove(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const frame = activeFrame(state, TREASON_REMOVE_FRAME, actorId, ctx);
  if (isOutcome(frame)) return frame;
  const vertex = command.vertex;
  const knight = typeof vertex === 'number' ? knightAt(state, vertex) : undefined;
  if (!knight || knight.player !== actorId) return ctx.kit.fail('E_ILLEGAL_TARGET', { vertex });
  frame.responders = [];
  removeForTreason(state, frame.data.actor as string, knight, ctx, true);
  return ctx.kit.accept(state);
}

/** `progress.treasonPlace { vertex | null, level }` — place an own knight, or decline. */
export function treasonPlace(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = activeFrame(state, TREASON_PLACE_FRAME, actorId, ctx);
  if (isOutcome(frame)) return frame;
  const data = frame.data as { level: KnightLevel; active: boolean };
  if (command.vertex === null) {
    kit.emit(state, 'ck.treasonNoPlace', { playerId: actorId });
  } else {
    const vertex = command.vertex;
    const level = command.level as KnightLevel;
    if (!treasonLevels(state, actorId, data.level).includes(level)) return kit.fail('E_INVALID_SELECTION', { level });
    if (typeof vertex !== 'number' || !recruitSites(state, actorId).includes(vertex)) return kit.fail('E_ILLEGAL_TARGET', { vertex });
    // The status carries over; an active knight placed this way may act this turn (CK-FAQ 83).
    ckState(state).knights.push({ player: actorId, vertex, level, active: data.active });
    kit.emit(state, 'ck.treasonPlaced', { playerId: actorId, vertex, level, active: data.active });
    kit.afterBoardChange(state);
  }
  frame.responders = [];
  kit.completePending(state, ctx.rng);
  kit.checkVictory(state);
  return kit.accept(state);
}

export const POLITICS_RULES = {
  diplomacy,
  encouragement,
  espionage,
  intrigue,
  sabotage,
  taxation,
  treason,
  wedding,
} satisfies Record<string, CardRule>;

/** Viewer data for the politics frames (Espionage shows the hand to the spy only). */
export function projectPoliticsFrame(state: GameState, frame: ModulePending, viewerId: string): Record<string, unknown> | null {
  switch (frame.kind) {
    case ESPIONAGE_FRAME: {
      const victim = frame.data.victim as string;
      const cards = playerById(state, victim)!.progressCards;
      return { victim, count: cards.length, ...(frame.responders.includes(viewerId) ? { cards: cards.slice() } : {}) };
    }
    case SABOTAGE_FRAME:
    case WEDDING_FRAME:
      return { actor: frame.data.actor, required: { ...(frame.data.required as Record<string, number>) } };
    case TREASON_REMOVE_FRAME:
      return { actor: frame.data.actor, knights: knightsOf(state, frame.responders[0]!).map((knight) => knight.vertex) };
    case TREASON_PLACE_FRAME: {
      const data = frame.data as { level: KnightLevel; active: boolean; from: number };
      const actor = frame.responders[0]!;
      return { level: data.level, active: data.active, from: data.from, levels: treasonLevels(state, actor, data.level), sites: recruitSites(state, actor) };
    }
    case DIPLOMACY_FRAME:
      return { edge: frame.data.edge, edges: (frame.data.edges as number[]).slice() };
    default:
      return null;
  }
}
