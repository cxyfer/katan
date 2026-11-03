/**
 * Cities & Knights production (CK25 p. 7) and the science level-3 ability
 * (CK25 p. 8).
 *
 * A city on forest, pasture or mountains takes one resource and one matching
 * commodity (paper, cloth, coin); on hills and fields it takes two resources;
 * a settlement takes one resource. Resources and commodities have separate
 * finite supplies, and the B25 shortage rule is applied to each card kind on
 * its own: if the supply cannot serve every entitled player, nobody receives
 * that kind; a single entitled player takes what is left.
 *
 * The production is recomputed here instead of halving the base results,
 * because the base shortage check counted a city's full two cards of the
 * resource.
 */

import { applyBankLimit, playerById, topologyOf, type ProductionResult, type ProductionShare } from '../../analysis.ts';
import { verticesOfHex } from '../../topology.ts';
import { RESOURCES, TERRAIN_COMMODITY, TERRAIN_RESOURCE, type CommandOutcome, type Commodity, type GameState, type ModulePending, type Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext, RollResult } from '../types.ts';
import { ABILITY_LEVEL, CITIES_KNIGHTS } from './constants.ts';
import { ckState, turnOrder } from './state.ts';

export const SCIENCE_FRAME = 'citiesKnights.scienceBonus' as const;

interface CommodityResult {
  commodity: Commodity;
  hex: number;
  entitlements: ProductionShare[];
  granted: ProductionShare[];
}

/** `modifyProduction`: replaces the base results and pays the commodities. */
export function modifyProduction(state: GameState, _results: ProductionResult[], roll: RollResult, ctx: ModuleContext): ProductionResult[] {
  const topo = topologyOf(state);
  const layout = state.board.layout;
  const resources: ProductionResult[] = [];
  const commodities: CommodityResult[] = [];
  for (let hex = 0; hex < layout.terrain.length; hex++) {
    const terrain = layout.terrain[hex]!;
    const resource = TERRAIN_RESOURCE[terrain];
    if (!resource || layout.numbers[hex] !== roll.total) continue;
    const commodity = TERRAIN_COMMODITY[terrain];
    const resourceShares: ProductionShare[] = [];
    const commodityShares: ProductionShare[] = [];
    for (const vertex of verticesOfHex(topo, hex)) {
      const building = state.board.buildings[vertex];
      if (!building) continue;
      const cityCommodity = building.city && commodity;
      resourceShares.push({ playerId: building.player, amount: building.city && !cityCommodity ? 2 : 1, vertex });
      if (cityCommodity) commodityShares.push({ playerId: building.player, amount: 1, vertex });
    }
    if (state.board.robber === hex) {
      // The robber's hex yields neither resources nor commodities (CK25 p. 7).
      resources.push({ terrain, resource, hex, entitlements: [], granted: [], starved: false, blocked: resourceShares });
      continue;
    }
    resources.push({ terrain, resource, hex, entitlements: resourceShares, granted: [], starved: false, blocked: [] });
    if (commodity && commodityShares.length > 0) commodities.push({ commodity, hex, entitlements: commodityShares, granted: [] });
  }

  const limited = new Map<number, ProductionResult>();
  for (const resource of RESOURCES) {
    const group = resources.filter((result) => result.resource === resource);
    if (group.length > 0) for (const result of applyBankLimit(group, state.bank[resource])) limited.set(result.hex, result);
  }
  const out = resources.map((result) => limited.get(result.hex)!);

  const received = new Set<string>();
  for (const result of out) for (const share of result.granted) if (share.amount > 0) received.add(share.playerId);
  const commodityGrants = payCommodities(state, commodities);
  for (const playerId of Object.keys(commodityGrants)) received.add(playerId);
  if (Object.keys(commodityGrants).length > 0) {
    ctx.kit.emit(state, 'ck.commoditiesProduced', { total: roll.total, grants: commodityGrants });
  }
  ckState(state).produced = [...received];
  return out;
}

/** Pays the commodity entitlements under the shortage rule; returns the grants. */
function payCommodities(state: GameState, results: CommodityResult[]): Record<string, Partial<Record<Commodity, number>>> {
  const grants: Record<string, Partial<Record<Commodity, number>>> = {};
  const byCommodity = new Map<Commodity, CommodityResult[]>();
  for (const result of results) byCommodity.set(result.commodity, [...(byCommodity.get(result.commodity) ?? []), result]);
  for (const [commodity, group] of byCommodity) {
    const asResults = group.map((result) => ({
      terrain: state.board.layout.terrain[result.hex]!,
      resource: null,
      hex: result.hex,
      entitlements: result.entitlements,
      granted: [],
      starved: false,
      blocked: [],
    } satisfies ProductionResult));
    for (const result of applyBankLimit(asResults, state.commodityBank[commodity])) {
      for (const share of result.granted) {
        const player = playerById(state, share.playerId);
        if (!player || share.amount <= 0) continue;
        player.commodities[commodity] += share.amount;
        state.commodityBank[commodity] -= share.amount;
        grants[share.playerId] = grants[share.playerId] ?? {};
        grants[share.playerId]![commodity] = (grants[share.playerId]![commodity] ?? 0) + share.amount;
      }
    }
  }
  return grants;
}

function bankTotal(state: GameState): number {
  return RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);
}

/**
 * After a production roll (not a 7), every player at science level 3+ who
 * received no card may take one resource of their choice (CK25 p. 8). They
 * answer in turn order from the roller; the choice is optional.
 */
export function scienceAfterProduction(state: GameState, roll: RollResult, ctx: ModuleContext): void {
  const slot = ckState(state);
  const produced = new Set(slot.produced ?? []);
  delete slot.produced;
  if (roll.total === 7) return;
  const responders = turnOrder(state).filter((id) => {
    const player = playerById(state, id)!;
    return player.improvements.science >= ABILITY_LEVEL && !produced.has(id);
  });
  if (responders.length === 0 || bankTotal(state) === 0) return;
  const frame: ModulePending = { kind: SCIENCE_FRAME, module: CITIES_KNIGHTS, responders, data: {} };
  ctx.kit.emit(state, 'ck.scienceBonusOffered', { players: responders.slice() });
  ctx.kit.enqueuePending(state, frame);
}

/** `science.take { resource | null }` — the next eligible player takes or declines. */
export function takeScienceBonus(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = state.pending;
  if (!frame || frame.kind !== SCIENCE_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  const pending = frame as ModulePending;
  if (!pending.responders.includes(actorId)) return kit.fail('E_NOT_ACTOR');
  if (pending.responders[0] !== actorId) return kit.fail('E_NOT_YOUR_TURN', { waitingFor: pending.responders[0] });
  // Only an explicit `null` declines; a missing resource is a malformed command.
  const resource = command.resource as Resource | null | undefined;
  if (resource === undefined) return kit.fail('E_INVALID_SELECTION', { resource });
  if (resource !== null) {
    if (!RESOURCES.includes(resource)) return kit.fail('E_INVALID_SELECTION', { resource });
    if (state.bank[resource] <= 0) return kit.fail('E_BANK_EMPTY', { resource });
    const player = playerById(state, actorId)!;
    player.resources[resource] += 1;
    state.bank[resource] -= 1;
  }
  pending.responders.shift();
  kit.emit(state, 'ck.scienceBonusTaken', resource ? { playerId: actorId, resource } : { playerId: actorId, resource: null });
  // Later players facing an empty supply have nothing to choose.
  if (bankTotal(state) === 0) pending.responders.length = 0;
  if (pending.responders.length === 0) kit.completePending(state, ctx.rng);
  return kit.accept(state);
}
