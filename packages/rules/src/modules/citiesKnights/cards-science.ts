/**
 * Science progress cards (CK25 pp. 13–14): Alchemy, Crane, Engineering,
 * Invention, Irrigation, Medicine, Mining, Road Building and Smithing.
 * Printing is a VP card and is revealed when drawn (`progress.ts`).
 */

import { countBuildings, playerById, topologyOf } from '../../analysis.ts';
import { verticesOfHex } from '../../topology.ts';
import type { CommandOutcome, GameState, Resource, Terrain } from '../../types.ts';
import type { ModuleContext, ModuleViewContext } from '../types.ts';
import { addWall, allowCity, applyImprovement, improvementOptions, planImprovement, wallSites } from './cities.ts';
import { TRACK_COMMODITY } from './constants.ts';
import { isOutcome, type CardRule } from './card-common.ts';
import { canPromote } from './knights.ts';
import { ckState, ckView } from './state.ts';

/** Medicine: a city for 1 grain and 2 ore (CK25 p. 13). */
export const MEDICINE_COST: Partial<Record<Resource, number>> = { grain: 1, ore: 2 };

/** Number discs Invention may not move (CK25 p. 13). */
export const FIXED_DISCS: readonly number[] = [2, 6, 8, 12];

function isDie(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

const alchemy: CardRule = {
  timing: 'preroll',
  blocked(state) {
    return ckView(state).alchemy?.windowId === state.windowId ? 'alchemy-set' : null;
  },
  // Both production dice are chosen; the event die is still rolled (CK25 p. 13, CK-FAQ 67–72).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const dice = command.dice;
    if (!Array.isArray(dice) || dice.length !== 2 || !isDie(dice[0]) || !isDie(dice[1])) {
      return kit.fail('E_INVALID_SELECTION', { reason: 'dice' });
    }
    const slot = ckState(state);
    if (slot.alchemy?.windowId === state.windowId) return kit.fail('E_ALCHEMY_SET');
    spend();
    slot.alchemy = { player: actorId, windowId: state.windowId, dice: [dice[0], dice[1]] };
    kit.emit(state, 'ck.alchemySet', { playerId: actorId, dice: [dice[0], dice[1]], total: dice[0] + dice[1] });
    return kit.accept(state);
  },
};

/** Tracks whose next level the player could buy with one commodity less. */
function craneTracks(state: GameState, playerId: string) {
  const player = playerById(state, playerId)!;
  return improvementOptions(state, playerId)
    .filter((option) => option.blocked === null || (option.blocked === 'cost' && player.commodities[TRACK_COMMODITY[option.track]] >= option.cost - 1))
    .map((option) => ({ track: option.track, level: option.level, cost: Math.max(0, option.cost - 1), metropolis: option.metropolis, sites: option.sites }));
}

const crane: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ tracks: craneTracks(state, playerId) }),
  blocked: (state, playerId) => (craneTracks(state, playerId).length > 0 ? null : 'no-target'),
  // One improvement for 1 commodity less; level 1 for free (CK25 p. 13, CK-FAQ 79–81).
  play(state, actorId, command, ctx, spend) {
    const plan = planImprovement(state, actorId, command.track, command.vertex, 1, ctx);
    if (isOutcome(plan)) return plan;
    spend();
    applyImprovement(state, actorId, plan, ctx, true);
    return ctx.kit.accept(state);
  },
};

const engineering: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ vertices: wallSites(state, playerId) }),
  blocked: (state, playerId) => (wallSites(state, playerId).length > 0 ? null : 'no-target'),
  // One city wall for free (CK25 p. 13).
  play(state, actorId, command, ctx, spend) {
    const vertex = command.vertex;
    if (typeof vertex !== 'number' || !wallSites(state, actorId).includes(vertex)) return ctx.kit.fail('E_ILLEGAL_TARGET', { vertex });
    spend();
    addWall(state, actorId, vertex, ctx, true);
    return ctx.kit.accept(state);
  },
};

/** Hexes whose number disc Invention may move. */
export function inventionHexes(state: GameState): number[] {
  const numbers = state.board.layout.numbers;
  const out: number[] = [];
  numbers.forEach((number, hex) => {
    if (number !== null && number !== undefined && !FIXED_DISCS.includes(number)) out.push(hex);
  });
  return out;
}

const invention: CardRule = {
  timing: 'action',
  targets: (state) => ({ hexes: inventionHexes(state) }),
  blocked: (state) => (inventionHexes(state).length >= 2 ? null : 'no-target'),
  // Swap two discs other than 2, 6, 8 and 12; the robber stays (CK25 p. 13, CK-FAQ 105–107).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const hexes = command.hexes;
    const legal = inventionHexes(state);
    if (!Array.isArray(hexes) || hexes.length !== 2 || hexes[0] === hexes[1] || !hexes.every((hex) => legal.includes(hex as number))) {
      return kit.fail('E_ILLEGAL_TARGET', { hexes });
    }
    const [a, b] = hexes as [number, number];
    const numbers = state.board.layout.numbers;
    const before: [number, number] = [numbers[a]!, numbers[b]!];
    spend();
    numbers[a] = before[1];
    numbers[b] = before[0];
    kit.emit(state, 'ck.numbersSwapped', { playerId: actorId, hexes: [a, b], numbers: before });
    return kit.accept(state);
  },
};

/** Hexes of a terrain next to at least one of the player's buildings. */
export function ownTerrainHexes(state: GameState, playerId: string, terrain: Terrain): number[] {
  const topo = topologyOf(state);
  const out: number[] = [];
  state.board.layout.terrain.forEach((candidate, hex) => {
    if (candidate !== terrain) return;
    if (verticesOfHex(topo, hex).some((vertex) => state.board.buildings[vertex]?.player === playerId)) out.push(hex);
  });
  return out;
}

/**
 * Irrigation / Mining: 2 cards per matching hex next to an own building,
 * whatever the robber; a short supply pays what is left (CK25 pp. 13–14,
 * interpretation P3-6).
 */
function harvest(card: 'irrigation' | 'mining', terrain: Terrain, resource: Resource): CardRule {
  return {
    timing: 'action',
    targets: (state, playerId) => ({ hexes: ownTerrainHexes(state, playerId, terrain) }),
    play(state, actorId, _command, ctx, spend) {
      spend();
      const hexes = ownTerrainHexes(state, actorId, terrain);
      const amount = Math.min(2 * hexes.length, state.bank[resource]);
      playerById(state, actorId)!.resources[resource] += amount;
      state.bank[resource] -= amount;
      ctx.kit.emit(state, 'ck.harvest', { playerId: actorId, card, resource, hexes: hexes.length, amount });
      ctx.kit.checkVictory(state);
      return ctx.kit.accept(state);
    },
  };
}

/** Settlements the player may upgrade to a city right now (ignoring cost). */
export function medicineSites(state: GameState, playerId: string, ctx: ModuleViewContext): number[] {
  if (countBuildings(state, playerId, 'city') >= ctx.profile.pieces.cities) return [];
  const out: number[] = [];
  state.board.buildings.forEach((building, vertex) => {
    if (building && building.player === playerId && !building.city && allowCity(state, playerId, vertex)) out.push(vertex);
  });
  return out;
}

function medicinePlay(state: GameState, actorId: string, vertex: unknown, ctx: ModuleContext, spend: () => void): CommandOutcome {
  const { kit } = ctx;
  if (typeof vertex !== 'number' || !medicineSites(state, actorId, ctx).includes(vertex)) return kit.fail('E_ILLEGAL_TARGET', { vertex });
  const player = playerById(state, actorId)!;
  if (!kit.canAfford(player, MEDICINE_COST)) return kit.fail('E_INSUFFICIENT_RESOURCES', { cost: MEDICINE_COST });
  spend();
  kit.payBuild(state, player, MEDICINE_COST);
  state.board.buildings[vertex]!.city = true;
  kit.emit(state, 'ck.medicineCity', { playerId: actorId, vertex });
  kit.afterBoardChange(state);
  kit.checkVictory(state);
  return kit.accept(state);
}

/** Knights the player may promote now (Smithing: no cost). */
export function smithingKnights(state: GameState, playerId: string): number[] {
  return ckView(state).knights.filter((knight) => knight.player === playerId && canPromote(state, knight)).map((knight) => knight.vertex);
}

const smithing: CardRule = {
  timing: 'action',
  targets: (state, playerId) => ({ vertices: smithingKnights(state, playerId) }),
  blocked: (state, playerId) => (smithingKnights(state, playerId).length > 0 ? null : 'no-target'),
  // Promote one or two different knights for free; once per knight and turn (CK25 p. 14, CK-FAQ 111–113).
  play(state, actorId, command, ctx, spend) {
    const { kit } = ctx;
    const vertices = command.vertices;
    if (!Array.isArray(vertices) || vertices.length < 1 || vertices.length > 2 || new Set(vertices).size !== vertices.length) {
      return kit.fail('E_INVALID_SELECTION', { reason: 'knights' });
    }
    spend();
    for (const vertex of vertices) {
      const knight = ckState(state).knights.find((candidate) => candidate.vertex === vertex && candidate.player === actorId);
      // Checked one after the other: the first promotion may use the last free piece.
      if (!knight || !canPromote(state, knight)) return kit.fail('E_ILLEGAL_TARGET', { vertex });
      knight.level = (knight.level + 1) as 2 | 3;
      knight.promotedIn = state.windowId;
      kit.emit(state, 'ck.knightPromoted', { playerId: actorId, vertex, level: knight.level, free: true });
    }
    return kit.accept(state);
  },
};

export const SCIENCE_RULES = {
  alchemy,
  crane,
  engineering,
  invention,
  irrigation: harvest('irrigation', 'fields', 'grain'),
  medicine: {
    timing: 'action',
    targets: (state, playerId, view) => ({ vertices: medicineSites(state, playerId, view), cost: MEDICINE_COST }),
    blocked: (state, playerId, view) => {
      if (medicineSites(state, playerId, view).length === 0) return 'no-target';
      const player = playerById(state, playerId)!;
      return (Object.entries(MEDICINE_COST) as [Resource, number][]).every(([resource, amount]) => player.resources[resource] >= amount) ? null : 'cost';
    },
    // Upgrade a settlement for 1 grain + 2 ore; one card per city (CK25 p. 13, CK-FAQ 108).
    play: (state, actorId, command, ctx, spend) => medicinePlay(state, actorId, command.vertex, ctx, spend),
  },
  mining: harvest('mining', 'mountains', 'ore'),
  roadBuilding: {
    timing: 'action',
    targets: () => ({}),
    // Two free roads through the base free-road effect (CK25 p. 14).
    play(state, actorId, _command, ctx, spend) {
      spend();
      const remaining = Math.min(2, ctx.kit.freeRouteTargets(state, actorId));
      ctx.kit.emit(state, 'ck.freeRoads', { playerId: actorId, roads: remaining });
      if (remaining > 0) ctx.kit.enqueuePending(state, { kind: 'freeRoads', actor: actorId, remaining, granted: remaining });
      return ctx.kit.accept(state);
    },
  },
  smithing,
} satisfies Record<string, CardRule>;
