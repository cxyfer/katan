/**
 * Pirate ships (EP25 pp. 8, 10–11; from Pirate Lairs on). Each player owns one;
 * at most one is on the board. A 7 or a successful chase "activates" the
 * player's pirate ship: it is placed (or moved) on a different sea hex and
 * steals one random resource — or a coin from a player without resources —
 * from a player with a ship on that hex.
 */

import { topologyOf, totalResources } from '../../analysis.ts';
import { RESOURCES, type CommandOutcome, type GameState, type ModulePending, type Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import { gainGold, goldOf, payGold, requirePirates, requireTurn, scenarioOf } from './core.ts';
import { ownShip } from './economy.ts';
import { bordersStartIsland, cornersOf, isWater, shipEnds } from './geometry.ts';
import { EXPLORERS_PIRATES, epState, epTurn, shipTurn, siteAt, type EpShip } from './state.ts';

export const PIRATE_FRAME = 'explorersPirates.pirate' as const;

export interface PirateFrameData {
  stage: 'place' | 'rob';
  cause: 'seven' | 'chase';
  candidates?: string[];
  /** The hex a chased pirate left; the new pirate goes to a different one. */
  from?: number;
}

function pirateFrame(actorId: string, cause: PirateFrameData['cause']): ModulePending {
  return { kind: PIRATE_FRAME, module: EXPLORERS_PIRATES, responders: [actorId], data: { stage: 'place', cause } satisfies PirateFrameData };
}

/** After the discards of a 7: Land Ho! has no pirate; later missions activate the roller's. */
export function sevenRobberStep(state: GameState, actorId: string, ctx: ModuleContext) {
  if (!scenarioOf(state).pirates) {
    ctx.kit.emit(state, 'ep.noPirate', { playerId: actorId });
    return null;
  }
  ctx.kit.emit(state, 'ep.pirateRequired', { playerId: actorId, cause: 'seven' });
  return pirateFrame(actorId, 'seven');
}

/** Sea hexes the pirate may go to (EP25 p. 8). */
export function pirateTargets(state: GameState, from: number | null = epState(state).pirate?.hex ?? null): number[] {
  const slot = epState(state);
  const out: number[] = [];
  topologyOf(state).hexes.forEach((_, hex) => {
    if (!isWater(state, slot, hex) || hex === slot.council) return;
    if (hex === from) return;
    if (bordersStartIsland(state, slot, hex)) return;
    out.push(hex);
  });
  return out;
}

/** Players other than the actor with a ship on an edge of the hex. */
export function victimsAt(state: GameState, hex: number, actorId: string): string[] {
  const slot = epState(state);
  const topo = topologyOf(state);
  const out = new Set<string>();
  for (const ship of slot.ships) {
    if (ship.player !== actorId && topo.edges[ship.edge]!.hexes.includes(hex)) out.add(ship.player);
  }
  return state.players.map((player) => player.id).filter((id) => out.has(id));
}

function activeFrame(state: GameState, actorId: string, stage: PirateFrameData['stage'], ctx: ModuleContext) {
  const pending = state.pending;
  if (!pending || pending.kind !== PIRATE_FRAME) return { error: ctx.kit.fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' }) };
  const frame = pending as ModulePending;
  if (frame.responders[0] !== actorId) return { error: ctx.kit.fail('E_NOT_ACTOR') };
  const data = frame.data as unknown as PirateFrameData;
  if (data.stage !== stage) return { error: ctx.kit.fail('E_EP_SETUP_STEP', { step: data.stage }) };
  return { frame, data };
}

export function placePirate(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const active = activeFrame(state, actorId, 'place', ctx);
  if ('error' in active) return active.error!;
  const hex = command.hex as number;
  if (!pirateTargets(state, framePirateFrom(state, active.data)).includes(hex)) return ctx.kit.fail('E_ILLEGAL_TARGET', { hex });
  const slot = epState(state);
  if (slot.pirate && slot.pirate.owner !== actorId) {
    ctx.kit.emit(state, 'ep.pirateReturned', { playerId: slot.pirate.owner, hex: slot.pirate.hex });
  }
  slot.pirate = { hex, owner: actorId };
  ctx.kit.emit(state, 'ep.pirateMoved', { playerId: actorId, hex, cause: active.data.cause });
  const shoal = siteAt(slot, hex);
  if (shoal?.kind === 'shoal' && shoal.fish) {
    // A pirate placed on a shoal scares its fish haul away (EP25 p. 14).
    shoal.fish = false;
    slot.fishSupply += 1;
    ctx.kit.emit(state, 'ep.fishScared', { playerId: actorId, hex });
  }
  const candidates = victimsAt(state, hex, actorId).filter((id) => canRob(state, id));
  if (candidates.length === 0) {
    ctx.kit.completePending(state, ctx.rng);
    return ctx.kit.accept(state);
  }
  if (candidates.length === 1) {
    robFrom(state, actorId, candidates[0]!, ctx);
    ctx.kit.completePending(state, ctx.rng);
    return ctx.kit.accept(state);
  }
  (active.frame.data as unknown as PirateFrameData).stage = 'rob';
  (active.frame.data as unknown as PirateFrameData).candidates = candidates;
  return ctx.kit.accept(state);
}

/** The hex the new pirate must avoid: the chased one, or the pirate on the board. */
export function framePirateFrom(state: GameState, data: PirateFrameData): number | null {
  return data.from ?? epState(state).pirate?.hex ?? null;
}

function canRob(state: GameState, playerId: string): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  return totalResources(player) > 0 || goldOf(epState(state), playerId) > 0;
}

export function robPlayer(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const active = activeFrame(state, actorId, 'rob', ctx);
  if ('error' in active) return active.error!;
  const victim = command.victim as string;
  if (!(active.data.candidates ?? []).includes(victim)) return ctx.kit.fail('E_NO_ELIGIBLE_VICTIM');
  robFrom(state, actorId, victim, ctx);
  ctx.kit.completePending(state, ctx.rng);
  return ctx.kit.accept(state);
}

/** One random resource card; a player without any loses a coin instead (EP25 p. 8). */
function robFrom(state: GameState, actorId: string, victimId: string, ctx: ModuleContext): void {
  const victim = state.players.find((player) => player.id === victimId)!;
  const actor = state.players.find((player) => player.id === actorId)!;
  const total = totalResources(victim);
  if (total > 0) {
    let pick = ctx.rng.int(total);
    let taken: Resource = 'lumber';
    for (const resource of RESOURCES) {
      if (pick < victim.resources[resource]) {
        taken = resource;
        break;
      }
      pick -= victim.resources[resource];
    }
    victim.resources[taken] -= 1;
    actor.resources[taken] += 1;
    ctx.kit.emit(state, 'ep.pirateStole', { playerId: actorId, victim: victimId, card: true }, { to: [actorId, victimId], params: { resource: taken } });
    return;
  }
  const slot = epState(state);
  payGold(slot, victimId, 1);
  gainGold(slot, actorId, 1);
  ctx.kit.emit(state, 'ep.pirateStole', { playerId: actorId, victim: victimId, card: false, gold: 1 });
}

/** Numbers that chase the pirate away for this player (EP25 p. 14, Pirate Bonus). */
export function chaseNumbers(state: GameState, playerId: string): number[] {
  const farms = epState(state).sites.filter((site) => site.kind === 'spice' && site.ability === 'pirateBonus' && site.crews.includes(playerId));
  if (farms.length >= 2) return [4, 5, 6];
  const numbers = new Set([6]);
  for (const farm of farms) if (farm.kind === 'spice' && farm.bonus !== null) numbers.add(farm.bonus);
  return [...numbers].sort((a, b) => a - b);
}

/** Battle-ready: not moved this turn, an end at a corner of the pirate's hex (EP25 p. 11). */
export function canChase(state: GameState, ship: EpShip): boolean {
  const slot = epState(state);
  if (!slot.pirate || slot.pirate.owner === ship.player) return false;
  const record = epTurn(state).ships[ship.id];
  if (record && (record.used > 0 || record.chased)) return false;
  const corners = cornersOf(state, slot.pirate.hex);
  return shipEnds(state, ship).some((vertex) => corners.includes(vertex));
}

export function chasePirate(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireTurn(state, actorId, ctx.kit) ?? requirePirates(state, ctx.kit);
  if (refused) return refused;
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  if (!canChase(state, ship)) return ctx.kit.fail('E_EP_NOT_BATTLE_READY');
  const slot = epState(state);
  shipTurn(epTurn(state), ship.id).chased = true;
  const die = ctx.rng.int(6) + 1;
  const success = chaseNumbers(state, actorId).includes(die);
  ctx.kit.emit(state, 'ep.chaseRolled', { playerId: actorId, ship: ship.id, die, success, owner: slot.pirate!.owner });
  if (success) {
    ctx.kit.emit(state, 'ep.pirateReturned', { playerId: slot.pirate!.owner, hex: slot.pirate!.hex });
    const from = slot.pirate!.hex;
    slot.pirate = null;
    // Activating the chaser's pirate: a different sea hex than the chased one.
    ctx.kit.enqueuePending(state, { ...pirateFrame(actorId, 'chase'), data: { stage: 'place', cause: 'chase', from } });
  }
  return ctx.kit.accept(state);
}
