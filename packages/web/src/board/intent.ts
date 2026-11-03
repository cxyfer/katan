/**
 * Which board target the current interaction is asking for, and which targets
 * are legal for it.
 *
 * Server hints are used whenever they exist (`hints.legalRoads`, …), including
 * initial setup. The server still rejects anything illegal and the rejection is
 * what the player finally sees.
 */

import type { TableState } from '../state/table.ts';
import { isShipCommand, seafarersHints } from './seafarers.ts';
import { banditTargets, moveBanditMessageId, seafarersCitiesKnightsHints } from './seafarersCitiesKnights.ts';
import { citiesKnightsHints, citiesKnightsTargets, isCitiesKnightsVertexCommand } from './citiesKnights.ts';
import type { TargetKind } from './targets.ts';

export interface BoardIntent {
  kind: TargetKind;
  commandType: string;
  labelId: string;
  targets: number[];
  /** True when the target list came from server-provided action hints. */
  fromHints: boolean;
}

function allVertices(state: TableState): number[] {
  const board = state.game?.view.board;
  if (!board) return [];
  return board.buildings.map((building, index) => ({ building, index }))
    .filter(({ building }) => building === null)
    .map(({ index }) => index);
}

function allEdges(state: TableState): number[] {
  const board = state.game?.view.board;
  if (!board) return [];
  return board.roads
    .map((road, index) => ({ road, index }))
    .filter(({ road }) => road === null)
    .map(({ index }) => index);
}

function robberHexes(state: TableState): number[] {
  const board = state.game?.view.board;
  if (!board) return [];
  // Seafarers: land hexes move the robber, sea hexes the pirate (the frame is
  // a separate control because it is not a hex).
  const sea = seafarersHints(state.game?.view);
  if (sea) {
    const allowed = banditTargets(state.game?.view, sea.robberTargets, sea.pirateTargets);
    const pirate = allowed.pirate.filter((hex): hex is number => hex !== null);
    return [...allowed.robber, ...pirate].sort((a, b) => a - b);
  }
  const out: number[] = [];
  for (let hex = 0; hex < board.terrain.length; hex++) {
    if (hex !== board.robber) out.push(hex);
  }
  return out;
}

/**
 * The interaction the board should currently offer. `selection.commandType`
 * (set by the action bar) wins; otherwise setup and mandatory effects arm
 * themselves so the player never has to guess that a prompt is waiting.
 */
export function boardIntent(state: TableState, selfId: string | null): BoardIntent | null {
  const view = state.game?.view;
  if (!view || view.result) return null;
  const hints = view.hints ?? null;

  const armed = state.selection.commandType;
  if (armed) {
    const kind: TargetKind =
      state.selection.kind ?? (armed === 'build.road' || armed === 'setup.placeRoad' || isShipCommand(armed) ? 'edge' : 'vertex');
    return {
      kind,
      commandType: armed,
      labelId: state.selection.labelId ?? armed,
      targets: targetsFor(state, armed, selfId),
      fromHints: armed.startsWith('build.') || isShipCommand(armed) || isCitiesKnightsVertexCommand(armed),
    };
  }

  const pending = view.pending;
  // `discard` is the one pending effect with no single actor and no board
  // target: the discard UI owns it, not the board.
  if (pending && pending.kind !== 'discard' && 'actor' in pending && pending.actor === selfId) {
    if (pending.kind === 'moveRobber') {
      return {
        kind: 'hex',
        commandType: 'pending.moveRobber',
        labelId: moveBanditMessageId(view),
        targets: robberHexes(state),
        fromHints: false,
      };
    }
    if (pending.kind === 'freeRoads') {
      const sea = seafarersHints(view);
      if (sea && (hints?.legalRoads.length ?? 0) === 0 && sea.legalShips.length > 0) {
        return { kind: 'edge', commandType: 'build.ship', labelId: 'sf.build.ship', targets: sea.legalShips, fromHints: true };
      }
      return {
        kind: 'edge',
        commandType: 'build.road',
        labelId: 'play.build.road',
        targets: hints?.legalRoads ?? allEdges(state),
        fromHints: !!hints,
      };
    }
  }

  // Cities & Knights: a pillaged city or a displaced knight is chosen on the board.
  const ck = citiesKnightsHints(view);
  if (ck && pending && 'module' in pending && pending.module === 'citiesKnights' && selfId && pending.responders.includes(selfId)) {
    if (pending.kind === 'citiesKnights.pillage') {
      return { kind: 'vertex', commandType: 'barbarians.pillage', labelId: 'play.pending.citiesKnights.pillage', targets: ck.pillage, fromHints: true };
    }
    if (pending.kind === 'citiesKnights.displaced') {
      return { kind: 'vertex', commandType: 'knight.retreat', labelId: 'play.pending.citiesKnights.displaced', targets: ck.retreat, fromHints: true };
    }
    // Progress-card answers on the board: the knight Treason removes, the road Diplomacy rebuilds.
    if (pending.kind === 'citiesKnights.treasonRemove' || pending.kind === 'citiesKnights.diplomacyRoad') {
      const commandType = pending.kind === 'citiesKnights.treasonRemove' ? 'progress.treasonRemove' : 'progress.diplomacyRoad';
      return {
        kind: commandType === 'progress.treasonRemove' ? 'vertex' : 'edge',
        commandType,
        labelId: `play.pending.${pending.kind}`,
        targets: citiesKnightsTargets(view, { commandType }) ?? [],
        fromHints: true,
      };
    }
  }

  const setup = view.turn.setup;
  if (setup && selfId) {
    const actor = view.players.find((player) => player.seat === setup.seat);
    if (actor?.id === selfId) {
      return setup.stage === 'building'
        ? {
            kind: 'vertex',
            commandType: 'setup.placeBuilding',
            labelId: 'play.build.settlement',
            targets: view.hints?.legalSettlements ?? allVertices(state),
            fromHints: !!view.hints,
          }
        : (view.hints?.legalRoads.length ?? 0) === 0 && (seafarersHints(view)?.setupShips.length ?? 0) > 0
          ? {
              kind: 'edge',
              commandType: 'setup.placeShip',
              labelId: 'sf.build.ship',
              targets: seafarersHints(view)!.setupShips,
              fromHints: true,
            }
          : {
            kind: 'edge',
            commandType: 'setup.placeRoad',
            labelId: 'play.build.road',
            targets: view.hints?.legalRoads ?? allEdges(state),
            fromHints: !!view.hints,
          };
    }
  }

  return null;
}

/** Resolves the advisory target list for one command type. */
export function targetsFor(state: TableState, commandType: string, selfId: string | null): number[] {
  void selfId;
  const hints = state.game?.view.hints ?? null;
  switch (commandType) {
    case 'build.road':
      return hints?.legalRoads ?? allEdges(state);
    case 'build.settlement':
      return hints?.legalSettlements ?? allVertices(state);
    case 'build.city':
      return hints?.legalCities ?? [];
    case 'setup.placeBuilding':
      return hints?.legalSettlements ?? allVertices(state);
    case 'setup.placeRoad':
      return hints?.legalRoads ?? allEdges(state);
    case 'pending.moveRobber':
    case 'dev.playKnight':
      return robberHexes(state);
    case 'build.ship':
      return seafarersHints(state.game?.view)?.legalShips ?? [];
    case 'setup.placeShip':
      return seafarersHints(state.game?.view)?.setupShips ?? [];
    case 'ship.pick':
      return seafarersHints(state.game?.view)?.movableShips.map((ship) => ship.edge) ?? [];
    case 'knight.chasePirate':
      return seafarersCitiesKnightsHints(state.game?.view)?.pirateChase ?? [];
    case 'ship.move': {
      const from = state.selection.params?.from;
      return seafarersHints(state.game?.view)?.movableShips.find((ship) => ship.edge === from)?.targets ?? [];
    }
    default:
      return citiesKnightsTargets(state.game?.view, { commandType, params: state.selection.params }) ?? [];
  }
}
