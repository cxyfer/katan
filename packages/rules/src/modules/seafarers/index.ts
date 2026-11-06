/**
 * Seafarers rules module (SF25 / SF56-25, Heading for New Shores).
 *
 * Ships, ship movement, the pirate, gold fields and the island bonus live in
 * this directory; the base engine supplies the turn structure, sea-aware
 * placement and the Longest Trade Route (roads and ships join only at an own
 * building). See README.md in the parent directory for the hooks.
 */

import { topologyOf } from '../../analysis.ts';
import type { GameState } from '../../types.ts';
import type { ModuleViewContext, PublicModulePendingView, RulesModule } from '../types.ts';
import { afterProduction, chooseGold, goldRequired, GOLD_FRAME, projectGold, skipEmptySupply } from './gold.ts';
import { allowBuilding, claimIslands } from './islands.ts';
import { moveBandit, pirateTargets } from './pirate.ts';
import {
  buildShip,
  buildableShipEdges,
  countShips,
  legalShipEdges,
  movableShips,
  moveShip,
  setupShip,
} from './ships.ts';
import { SEAFARERS, initialSeafarersState, seafarersState, seafarersView } from './state.ts';
import { setModuleState } from '../state.ts';

/**
 * The `seafarers.gold` pending frame as a viewer sees it (`projectGold`): the
 * entitlements are public, so every seat gets the same `picks`, one entry per
 * remaining responder.
 */
export interface SeafarersGoldPendingView extends PublicModulePendingView {
  kind: typeof GOLD_FRAME;
  module: typeof SEAFARERS;
  data: { picks: Record<string, number> };
}

/** Public Seafarers state, published as `GameView.modules.seafarers`. */
export function projectSeafarers(state: GameState) {
  const slot = seafarersView(state);
  return {
    islandBonus: Object.fromEntries(Object.entries(slot.islands).map(([id, islands]) => [id, islands.slice()])),
    islandClaims: (slot.claims ?? []).map((claim) => ({ ...claim })),
    shipsBuiltThisTurn: slot.built.slice(),
    shipMoved: slot.moved,
  };
}

export type SeafarersView = ReturnType<typeof projectSeafarers>;

/** Advisory legal targets, published as `ActionHints.modules.seafarers`. */
export function seafarersHints(state: GameState, playerId: string, ctx: ModuleViewContext) {
  const isTurn = state.players[state.turn.seat]?.id === playerId;
  const inAction = isTurn && state.turn.phase === 'action' && !state.pending;
  const freeRoads = state.pending?.kind === 'freeRoads' && state.pending.actor === playerId;
  const setup = state.turn.setup;
  const setupShipStep = !!setup && setup.stage === 'road' && state.players[setup.order[setup.index] ?? -1]?.id === playerId;
  const robberMove = state.pending?.kind === 'moveRobber' && state.pending.actor === playerId;
  const view = seafarersView(state);
  return {
    legalShips: inAction || freeRoads ? buildableShipEdges(state, playerId, ctx.profile.pieces.ships) : [],
    setupShips: setupShipStep ? legalShipEdges(state, playerId, { setupVertex: setup!.lastVertex }) : [],
    movableShips: inAction && !view.moved ? movableShips(state, playerId) : [],
    shipMoved: view.moved,
    pirateTargets: robberMove || isTurn ? pirateTargets(state) : [],
    robberTargets: robberMove || isTurn
      ? topologyOf(state).hexes.map((_, hex) => hex).filter((hex) =>
        state.board.layout.terrain[hex] !== 'sea' && hex !== state.board.robber)
      : [],
    goldRequired: goldRequired(state, playerId),
  };
}

export type SeafarersHints = ReturnType<typeof seafarersHints>;

export const seafarersModule: RulesModule = {
  id: SEAFARERS,

  initGame(state) {
    setModuleState(state, SEAFARERS, initialSeafarersState(state));
  },

  afterProduction,
  moveBandit,
  allowBuilding,

  freeRouteTargets(state, playerId, ctx, options) {
    const pieces = Math.max(0, ctx.profile.pieces.ships - countShips(state, playerId));
    const targets = buildableShipEdges(state, playerId, ctx.profile.pieces.ships);
    return options?.grantAllAvailable && targets.length > 0 ? pieces : Math.min(targets.length, pieces);
  },

  legalShips(state, playerId, ctx) {
    return buildableShipEdges(state, playerId, ctx.profile.pieces.ships);
  },

  // A ship another module placed (C&K Diplomacy) counts as built in this
  // window: it may not move in it (SF25 p. 2; CK25 p. 12 "only then build").
  shipPlaced(state, _playerId, edge) {
    seafarersState(state).built.push(edge);
  },

  afterBoardChange(state, ctx) {
    claimIslands(state, ctx);
  },

  commands: {
    'build.ship': buildShip,
    'ship.move': moveShip,
    'setup.placeShip': setupShip,
    'gold.choose': chooseGold,
  },
  pendingCommands: ['build.ship', 'gold.choose'],

  activatePending(state, frame, ctx) {
    if (frame.kind === GOLD_FRAME) skipEmptySupply(state, frame, ctx);
  },

  project: projectSeafarers,

  projectPending(state, frame, viewerId, ctx) {
    if (frame.kind === GOLD_FRAME) return projectGold(state, frame, viewerId, ctx);
    return { kind: frame.kind, module: frame.module, responders: frame.responders.slice(), data: {} };
  },

  actionHints: seafarersHints,
};
