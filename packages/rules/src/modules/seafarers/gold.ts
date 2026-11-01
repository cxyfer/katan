/**
 * Gold fields (SF25 p. 2, SF-FAQ 2): a producing gold hex gives each
 * settlement one resource of its owner's choice and each city two, in any
 * combination.
 *
 * Gold is resolved after the ordinary production of the roll, through one
 * `seafarers.gold` pending frame. The entitled players choose one after the
 * other in turn order, starting with the roller, and each choice is paid from
 * the supply at once. The supply is finite: a player can only take what is
 * left, and a player who finds the supply empty receives nothing. SF25 gives
 * no ordering for a gold shortage; this sequence is recorded as a deliberate
 * interpretation in docs/FIDELITY.md.
 */

import { playerById, topologyOf } from '../../analysis.ts';
import { addResource, playerStats } from '../../stats.ts';
import { verticesOfHex } from '../../topology.ts';
import { RESOURCES, type CommandOutcome, type GameState, type ModulePending, type Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext, PublicModulePendingView, RollResult } from '../types.ts';

export const GOLD_FRAME = 'seafarers.gold' as const;

interface GoldData {
  /** Resources still owed per player. */
  picks: Record<string, number>;
}

/** Gold entitlements for a roll, by player (robber-blocked hexes excluded). */
export function goldEntitlements(state: GameState, total: number): Record<string, number> {
  const picks: Record<string, number> = {};
  const topo = topologyOf(state);
  state.board.layout.terrain.forEach((terrain, hex) => {
    if (terrain !== 'gold' || state.board.layout.numbers[hex] !== total) return;
    if (state.board.robber === hex) return;
    for (const vertex of verticesOfHex(topo, hex)) {
      const building = state.board.buildings[vertex];
      if (!building) continue;
      picks[building.player] = (picks[building.player] ?? 0) + (building.city ? 2 : 1);
    }
  });
  return picks;
}

function bankTotal(state: GameState): number {
  return RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);
}

/** Turn order starting with the current actor. */
function turnOrder(state: GameState): string[] {
  const count = state.players.length;
  return Array.from({ length: count }, (_, offset) => state.players[(state.turn.seat + offset) % count]!.id);
}

export function afterProduction(state: GameState, roll: RollResult, ctx: ModuleContext): void {
  if (roll.total === 7) return;
  const picks = goldEntitlements(state, roll.total);
  const responders = turnOrder(state).filter((id) => (picks[id] ?? 0) > 0);
  if (responders.length === 0) return;
  const frame: ModulePending = { kind: GOLD_FRAME, module: 'seafarers', responders, data: { picks } };
  ctx.kit.emit(state, 'gold.required', { picks });
  ctx.kit.enqueuePending(state, frame);
  if (state.pending === frame) skipEmptySupply(state, frame, ctx);
}

/** Players who face an empty supply receive nothing and are skipped. */
function skipEmptySupply(state: GameState, frame: ModulePending, ctx: ModuleContext): void {
  while (frame.responders.length > 0 && bankTotal(state) === 0) {
    const playerId = frame.responders.shift()!;
    ctx.kit.emit(state, 'gold.chosen', { playerId, resources: [], shortBy: (frame.data as unknown as GoldData).picks[playerId] });
  }
  if (frame.responders.length === 0 && state.pending === frame) ctx.kit.completePending(state, ctx.rng);
}

/** Resources this player must take now (the supply may cap it). */
export function goldRequired(state: GameState, playerId: string): number {
  const frame = state.pending;
  if (!frame || frame.kind !== GOLD_FRAME) return 0;
  const gold = frame as ModulePending;
  if (gold.responders[0] !== playerId) return 0;
  const owed = (gold.data as unknown as GoldData).picks[playerId] ?? 0;
  return Math.min(owed, bankTotal(state));
}

/** `gold.choose { resources }` — the next entitled player takes their gold. */
export function chooseGold(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = state.pending;
  if (!frame || frame.kind !== GOLD_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  const gold = frame as ModulePending;
  if (!gold.responders.includes(actorId)) return kit.fail('E_NOT_ACTOR');
  if (gold.responders[0] !== actorId) return kit.fail('E_NOT_YOUR_TURN', { waitingFor: gold.responders[0] });
  const chosen = command.resources;
  const required = goldRequired(state, actorId);
  if (!Array.isArray(chosen) || chosen.length !== required) return kit.fail('E_INVALID_SELECTION', { required });
  const counts: Partial<Record<Resource, number>> = {};
  for (const resource of chosen) {
    if (!RESOURCES.includes(resource as Resource)) return kit.fail('E_INVALID_SELECTION', { resource });
    counts[resource as Resource] = (counts[resource as Resource] ?? 0) + 1;
  }
  for (const [resource, amount] of Object.entries(counts) as [Resource, number][]) {
    if (state.bank[resource] < amount) return kit.fail('E_BANK_EMPTY', { resource });
  }
  const player = playerById(state, actorId)!;
  const stats = playerStats(state, actorId);
  for (const [resource, amount] of Object.entries(counts) as [Resource, number][]) {
    player.resources[resource] += amount;
    state.bank[resource] -= amount;
    addResource(stats.produced, resource, amount);
  }
  const owed = (gold.data as unknown as GoldData).picks[actorId] ?? 0;
  gold.responders.shift();
  kit.emit(
    state,
    'gold.chosen',
    owed > required ? { playerId: actorId, resources: chosen.slice(), shortBy: owed - required } : { playerId: actorId, resources: chosen.slice() },
  );
  skipEmptySupply(state, gold, ctx);
  return kit.accept(state);
}

/** Gold entitlements are public, like the production they come from. */
export function projectGold(_state: GameState, frame: ModulePending, _viewerId: string, _ctx: ModuleViewContext): PublicModulePendingView {
  const picks = (frame.data as unknown as GoldData).picks;
  return {
    kind: frame.kind,
    module: frame.module,
    responders: frame.responders.slice(),
    data: { picks: Object.fromEntries(frame.responders.map((id) => [id, picks[id] ?? 0])) },
  };
}
