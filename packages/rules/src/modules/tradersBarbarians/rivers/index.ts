/**
 * Rivers of Catan (TB25 pp. 11–12): bridges over the rivers, gold for
 * building along them, and the Wealthiest / Poor Catanian tiles.
 */

import { playerById, topologyOf } from '../../../analysis.ts';
import { playerStats } from '../../../stats.ts';
import type { GameState, Resource } from '../../../types.ts';
import type { ModuleCommand, ModuleContext } from '../../types.ts';
import { coins, goldOf, grantGold } from '../coins/index.ts';
import type { TbPart } from '../part.ts';
import { partState, requirePartState, setPartState } from '../state.ts';
import { riverGeometry, type RiverGeometry } from './board.ts';

export const RIVERS = 'tb-rivers';
export const BRIDGE_COST: Partial<Record<Resource, number>> = { brick: 2, lumber: 1 };
export const BRIDGES_PER_PLAYER = 3;
export const BRIDGE_GOLD = 3;
export const WEALTHIEST_POINTS = 1;
export const POOR_POINTS = -2;

export type RiversState = RiverGeometry;

function rivers(state: GameState): RiversState {
  return requirePartState<RiversState>(state, RIVERS);
}

export function bridgesOf(state: GameState, playerId: string): number {
  return state.board.roads.filter((road) => road?.player === playerId && road.bridge).length;
}

/** Wealth tiles derived from current gold: the unique richest and every poorest player. */
export function wealth(state: GameState): { wealthiest: string | null; poor: string[] } {
  const amounts = state.players.map((player) => ({ id: player.id, gold: goldOf(state, player.id) }));
  const most = Math.max(...amounts.map((entry) => entry.gold));
  const least = Math.min(...amounts.map((entry) => entry.gold));
  const top = amounts.filter((entry) => entry.gold === most);
  return {
    wealthiest: top.length === 1 ? top[0]!.id : null,
    poor: amounts.filter((entry) => entry.gold === least).map((entry) => entry.id),
  };
}

/** Base network rule for one end of a bridge: own building, or own piece not through an opponent's building. */
function connects(state: GameState, playerId: string, edge: number): boolean {
  const topology = topologyOf(state);
  return topology.edges[edge]!.vertices.some((vertex) => {
    const building = state.board.buildings[vertex];
    if (building) return building.player === playerId;
    return topology.vertices[vertex]!.edges.some((other) => other !== edge && state.board.roads[other]?.player === playerId);
  });
}

function buildBridge(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  if (ctx.kit.currentPlayer(state).id !== actorId) return ctx.kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return ctx.kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  const edge = command.edge;
  const slot = rivers(state);
  if (typeof edge !== 'number' || !slot.bridgeSites.includes(edge) || state.board.roads[edge]) {
    return ctx.kit.fail('E_ILLEGAL_TARGET', { edge });
  }
  if (!connects(state, actorId, edge)) return ctx.kit.fail('E_ILLEGAL_TARGET', { edge, reason: 'not-connected' });
  if (bridgesOf(state, actorId) >= BRIDGES_PER_PLAYER) return ctx.kit.fail('E_NO_PIECES', { piece: 'bridge' });
  const player = playerById(state, actorId)!;
  if (!ctx.kit.canAfford(player, BRIDGE_COST)) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost: BRIDGE_COST });
  ctx.kit.payBuild(state, player, BRIDGE_COST);
  playerStats(state, actorId).roadsBuilt += 1;
  state.board.roads[edge] = { player: actorId, ship: false, bridge: true };
  ctx.kit.emit(state, 'tb.bridgeBuilt', { playerId: actorId, edge });
  ctx.kit.afterBoardChange(state);
  grantGold(state, actorId, BRIDGE_GOLD, 'bridge', ctx);
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

export const riversPart: TbPart = {
  id: RIVERS,
  initGame(state) {
    setPartState<RiversState>(state, RIVERS, riverGeometry(topologyOf(state)));
  },
  roadAllowed(state, _playerId, edge) {
    // No road on a bridge site, in setup either (p. 11).
    return !partState<RiversState>(state, RIVERS)?.bridgeSites.includes(edge);
  },
  afterBuild(state, build, ctx) {
    const slot = rivers(state);
    if (build.piece === 'settlement' && slot.vertices.includes(build.vertex!)) grantGold(state, build.playerId, 1, 'riverSettlement', ctx);
    if (build.piece === 'road' && slot.edges.includes(build.edge!)) grantGold(state, build.playerId, 1, 'riverRoad', ctx);
  },
  commands: { 'tb.buildBridge': buildBridge },
  score(state, playerId) {
    const tiles = wealth(state);
    return (tiles.wealthiest === playerId ? WEALTHIEST_POINTS : 0) + (tiles.poor.includes(playerId) ? POOR_POINTS : 0);
  },
  project(state) {
    const slot = partState<RiversState>(state, RIVERS);
    if (!slot) return null;
    const tiles = wealth(state);
    return {
      ...slot,
      bridges: Object.fromEntries(state.players.map((player) => [player.id, BRIDGES_PER_PLAYER - bridgesOf(state, player.id)])),
      wealthiest: tiles.wealthiest,
      poor: tiles.poor,
      bridgeCost: { ...BRIDGE_COST },
    };
  },
  actionHints(state, playerId) {
    const slot = partState<RiversState>(state, RIVERS);
    if (!slot) return null;
    const own = state.players[state.turn.seat]?.id === playerId && state.turn.phase === 'action' && !state.pending;
    const bridges = own && bridgesOf(state, playerId) < BRIDGES_PER_PLAYER
      ? slot.bridgeSites.filter((edge) => !state.board.roads[edge] && connects(state, playerId, edge))
      : [];
    return { targets: { 'tb.buildBridge': bridges } };
  },
};

/** Gold in play plus the supply always equals the 100 gold of coins. */
export function goldTotal(state: GameState): number {
  const slot = coins(state);
  return slot.supply + Object.values(slot.gold).reduce((sum, amount) => sum + amount, 0);
}

