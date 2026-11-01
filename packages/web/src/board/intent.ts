/**
 * Which board target the current interaction is asking for, and which targets
 * are legal for it.
 *
 * Server hints are used whenever they exist (`hints.legalRoads`, …), including
 * initial setup. The server still rejects anything illegal and the rejection is
 * what the player finally sees.
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
  /** Extra command fields (rules-module targets). */
  extra?: Record<string, unknown>;
  /** Command field receiving the picked index (rules-module targets). */
  field?: string;
}

/**
 * Board hints a rules module publishes in `hints.modules[id]`: `targets`
 * maps a command type to its legal indices, and `board` asks the board to arm
 * itself for a pending choice of the viewer.
 */
interface ModuleBoardHints {
  targets?: Record<string, number[]>;
  board?: Omit<BoardIntent, 'fromHints'> | null;
}

function moduleHints(state: TableState): ModuleBoardHints[] {
  const modules = state.game?.view.hints?.modules ?? {};
  return Object.values(modules).filter((value): value is ModuleBoardHints => !!value && typeof value === 'object');
}

/** Legal indices a rules module publishes for one of its command types. */
export function moduleTargets(state: TableState, commandType: string): number[] | null {
  for (const hints of moduleHints(state)) {
    const targets = hints.targets?.[commandType];
    if (Array.isArray(targets)) return targets.slice();
  }
  return null;
}

function moduleBoardIntent(state: TableState): BoardIntent | null {
  for (const hints of moduleHints(state)) {
    if (hints.board) return { ...hints.board, targets: hints.board.targets.slice(), fromHints: true };
  }
  return null;
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
  // A rules module that narrows the robber's hexes publishes them as a hint.
  const narrowed = (state.game?.view.hints?.modules?.tradersBarbarians as { robberHexes?: number[] } | undefined)?.robberHexes;
  if (Array.isArray(narrowed)) return narrowed.slice();
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
      fromHints: armed.startsWith('build.') || moduleTargets(state, armed) !== null,
      ...(state.selection.extra ? { extra: state.selection.extra } : {}),
      ...(state.selection.field ? { field: state.selection.field } : {}),
    };
  }

  // A rules module's pending choice (or end-of-turn step) of this viewer.
  const fromModule = moduleBoardIntent(state);
  if (fromModule) return fromModule;

  const pending = view.pending;
  // `discard` is the one pending effect with no single actor and no board
  // target: the discard UI owns it, not the board.
  if (pending && pending.kind !== 'discard' && 'actor' in pending && pending.actor === selfId) {
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
            targets: view.hints?.legalSettlements ?? allVertices(state),
            fromHints: !!view.hints,
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
    default:
      return moduleTargets(state, commandType) ?? [];
  }
}
