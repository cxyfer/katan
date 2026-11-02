/**
 * Seafarers + Cities & Knights combination layer (COMB, CK25 p. 12).
 *
 * The combined profiles run three modules, in this order:
 * `['seafarersCitiesKnights', 'seafarers', 'citiesKnights']`. This module
 * holds every rule that exists only because both expansions are in play, so
 * neither expansion module tests for the other:
 *
 * - COMB-10 / CK25 p. 12: the pirate stays out of play until the first
 *   barbarian attack, like the robber (`moveBandit`, first in hook order so
 *   its vetoes run before the Seafarers pirate). Both bandits start off the
 *   board; the first attack places the robber where the scenario puts it.
 * - CK25 pp. 9–10 and COMB-6: a knight chasing the robber moves the robber
 *   only; a knight next to the pirate's sea hex may chase the pirate instead
 *   (`knight.chasePirate`), which then moves and robs as the pirate does.
 * - COMB-4/5, CK25 p. 12: a knight closes the shipping route it stands at
 *   and other players' knights pin the ships bordering them, so no ship move
 *   cuts a knight off from its route (`shipMoveBlocked`).
 * - COMB-9, CK25 p. 12: the merchant never stands on a gold field
 *   (`allowMerchant`).
 * - Gold counts as production for the science level-3 bonus (interpretation
 *   SFCK-5): this module's `afterProduction` runs before both expansions',
 *   so the gold frame (Seafarers) is queued before the bonus (C&K).
 *
 * Everything else composes through the shared hooks: gold yields resources
 * only because C&K pays commodities for forest, pasture and mountains alone
 * (COMB-8); C&K knights block ships through `vertexBlocker`; Road Building
 * and Diplomacy handle ships through `freeRouteTargets` / `legalShips`;
 * knights travel along ships in `knightReach`; scores add up.
 */

import { isLandHex, topologyOf } from '../../analysis.ts';
import type { CommandOutcome, GameState } from '../../types.ts';
import { actingKnight, canAct, requireAction } from '../citiesKnights/knights.ts';
import { ckState, ckView, knightAt, type Knight } from '../citiesKnights/state.ts';
import { goldEntitlements } from '../seafarers/gold.ts';
import { isOpenShipEnd } from '../seafarers/ships.ts';
import type { BanditMove, ModuleCommand, ModuleContext, RulesModule } from '../types.ts';

export const SEAFARERS_CITIES_KNIGHTS = 'seafarersCitiesKnights';

function pirateInPlay(state: GameState): boolean {
  return ckView(state).attacks > 0;
}

function isSeaTarget(state: GameState, target: number | null): boolean | null {
  if (target === null) return true;
  if (typeof target !== 'number' || !Number.isInteger(target) || !topologyOf(state).hexes[target]) return null;
  return !isLandHex(state, target);
}

/** The active robber move is a knight chasing the pirate (`pirate: true`). */
function chasingPirate(state: GameState): boolean {
  const pending = state.pending;
  return pending?.kind === 'moveRobber' && pending.pirate;
}

/**
 * Vetoes a bandit target before the Seafarers pirate or the base robber
 * handles it; returns `undefined` to let them proceed.
 */
function moveBandit(
  state: GameState,
  _actorId: string,
  target: number | null,
  cause: 'seven' | 'knight',
  ctx: ModuleContext,
): BanditMove | undefined {
  const sea = isSeaTarget(state, target);
  if (sea === null) return undefined;
  const { kit } = ctx;
  if (sea) {
    if (!pirateInPlay(state)) return { ok: false, error: kit.fail('E_PIRATE_INACTIVE') };
    // A knight chasing the robber moves the robber (CK25 p. 10).
    if (cause === 'knight' && !chasingPirate(state)) return { ok: false, error: kit.fail('E_ILLEGAL_TARGET', { hex: target, reason: 'robber' }) };
    return undefined;
  }
  // A knight chasing the pirate moves the pirate (COMB-6).
  if (chasingPirate(state)) return { ok: false, error: kit.fail('E_ILLEGAL_TARGET', { hex: target, reason: 'pirate' }) };
  return undefined;
}

export function adjacentToPirate(state: GameState, knight: Knight): boolean {
  const pirate = state.board.pirate;
  return pirate !== null && topologyOf(state).vertices[knight.vertex]!.hexes.includes(pirate);
}

/** Own knights that may chase the pirate now. */
export function pirateChasers(state: GameState, playerId: string): number[] {
  if (!pirateInPlay(state)) return [];
  return ckView(state).knights
    .filter((knight) => knight.player === playerId && canAct(state, knight) && adjacentToPirate(state, knight))
    .map((knight) => knight.vertex)
    .sort((a, b) => a - b);
}

/** `knight.chasePirate { vertex }` — the knight lies down and the actor moves the pirate (COMB-6). */
function chasePirate(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  if (!pirateInPlay(state)) return kit.fail('E_PIRATE_INACTIVE');
  const knight = actingKnight(state, actorId, command.vertex, ctx);
  if ('ok' in knight) return knight;
  if (!adjacentToPirate(state, knight)) return kit.fail('E_ILLEGAL_TARGET', { vertex: knight.vertex, reason: 'not-adjacent' });
  knight.active = false;
  kit.emit(state, 'sfck.knightChasedPirate', { playerId: actorId, vertex: knight.vertex, hex: state.board.pirate });
  kit.enqueuePending(state, { kind: 'moveRobber', actor: actorId, cause: 'knight', pirate: true });
  return kit.accept(state);
}

/**
 * Extra limits on moving a ship (SFCK-3):
 * - a ship bordering another player's knight stays (COMB-5);
 * - a knight closes the end it stands on (COMB-4, SF-FAQ 18), so the ship
 *   needs an open end without a knight.
 * Together with the Seafarers open-end rule this keeps every knight connected
 * (COMB-4, CK25 p. 12): an open end has no other own piece, so the only piece
 * a move could cut off is a knight standing on that end.
 */
function shipMoveBlocked(state: GameState, playerId: string, edge: number): boolean {
  const ends = topologyOf(state).edges[edge]!.vertices;
  if (ends.some((vertex) => { const knight = knightAt(state, vertex); return !!knight && knight.player !== playerId; })) return true;
  return !ends.some((vertex) => isOpenShipEnd(state, playerId, edge, vertex) && !knightAt(state, vertex));
}

export const seafarersCitiesKnightsModule: RulesModule = {
  id: SEAFARERS_CITIES_KNIGHTS,

  // Both bandits wait off the board until the first barbarian attack
  // (CK25 pp. 6, 12; COMB-10). New Shores already starts the pirate on the
  // frame; the robber leaves its printed hex until then.
  initGame(state) {
    state.board.robber = -1;
  },

  moveBandit,

  // Entitlement to gold is production: no science bonus on top (SFCK-5).
  afterProduction(state, roll) {
    if (roll.total === 7) return;
    const gold = Object.keys(goldEntitlements(state, roll.total));
    if (gold.length === 0) return;
    const slot = ckState(state);
    slot.produced = [...new Set([...(slot.produced ?? []), ...gold])];
  },

  shipMoveBlocked,

  allowMerchant(state, _playerId, hex) {
    return state.board.layout.terrain[hex] !== 'gold';
  },

  commands: {
    'knight.chasePirate': chasePirate,
  },

  project(state) {
    return { pirateActive: pirateInPlay(state) };
  },

  actionHints(state, playerId) {
    const isTurn = state.players[state.turn.seat]?.id === playerId;
    const inAction = isTurn && state.turn.phase === 'action' && !state.pending;
    const pending = state.pending;
    let bandit: 'robber' | 'pirate' | 'either' | null = null;
    if (pending?.kind === 'moveRobber' && pending.actor === playerId) {
      bandit = pending.pirate ? 'pirate' : pending.cause === 'knight' || !pirateInPlay(state) ? 'robber' : 'either';
    }
    return {
      pirateActive: pirateInPlay(state),
      pirateChase: inAction ? pirateChasers(state, playerId) : [],
      bandit,
    };
  },
};
