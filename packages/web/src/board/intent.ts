/**
 * Which board target the current interaction is asking for, and which targets
 * are legal for it.
 *
 * Server hints are used whenever they exist (`hints.legalRoads`, …). Setup and
 * robber placement are not covered by hints, so they fall back to a purely
 * local filter that is explicitly advisory — the server still rejects anything
 * illegal and the rejection is what the player finally sees.
 */

import type { TableState } from '../state/table.ts';
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
      state.selection.kind ?? (armed === 'build.road' || armed === 'setup.placeRoad' ? 'edge' : 'vertex');
    return {
      kind,
      commandType: armed,
      labelId: state.selection.labelId ?? armed,
      targets: targetsFor(state, armed, selfId),
      fromHints: armed.startsWith('build.'),
    };
  }

  const pending = view.pending;
  if (pending && pending.actor === selfId) {
    if (pending.kind === 'moveRobber') {
      return {
        kind: 'hex',
        commandType: 'pending.moveRobber',
        labelId: 'play.pending.moveRobber',
        targets: robberHexes(state),
        fromHints: false,
      };
    }
    if (pending.kind === 'freeRoads') {
      return {
        kind: 'edge',
        commandType: 'build.road',
        labelId: 'play.build.road',
        targets: hints?.legalRoads ?? allEdges(state),
        fromHints: !!hints,
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
            targets: allVertices(state),
            fromHints: false,
          }
        : {
            kind: 'edge',
            commandType: 'setup.placeRoad',
            labelId: 'play.build.road',
            targets: allEdges(state),
            fromHints: false,
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
      return allVertices(state);
    case 'setup.placeRoad':
      return allEdges(state);
    case 'pending.moveRobber':
    case 'dev.playKnight':
      return robberHexes(state);
    default:
      return [];
  }
}
