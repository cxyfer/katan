/**
 * Which board target the current interaction is asking for, and which targets
 * are legal for it.
 *
 * Server hints are used whenever they exist (`hints.legalRoads`, …), including
 * initial setup. The server still rejects anything illegal and the rejection is
 * what the player finally sees.
 */

import type { TableState } from '../state/table.ts';
import { EP_FRAME, epHints, epView } from './explorersPirates.ts';
import { isShipCommand, seafarersHints } from './seafarers.ts';
import type { TargetKind } from './targets.ts';

export interface BoardIntent {
  kind: TargetKind;
  commandType: string;
  labelId: string;
  targets: number[];
  /** True when the target list came from server-provided action hints. */
  fromHints: boolean;
  /** Extra command fields an automatic intent carries (e.g. the ship in motion). */
  params?: Record<string, unknown>;
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
    const pirate = sea.pirateTargets.filter((hex): hex is number => hex !== null);
    return [...sea.robberTargets, ...pirate].sort((a, b) => a - b);
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
      fromHints: armed.startsWith('build.') || armed.startsWith('ep.') || isShipCommand(armed),
    };
  }

  // Explorers & Pirates owns its setup, its pirate frame and ship movement.
  if (epHints(view)) {
    const ep = explorersPiratesIntent(state, selfId);
    if (ep || view.turn.setup) return ep;
  }

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

/** The board choice an Explorers & Pirates player owes right now, if any. */
function explorersPiratesIntent(state: TableState, selfId: string | null): BoardIntent | null {
  const view = state.game?.view;
  const ep = epHints(view);
  if (!view || !ep || !selfId) return null;
  const pending = view.pending;
  if (pending?.kind === EP_FRAME) {
    return ep.pirateTargets.length > 0
      ? { kind: 'hex', commandType: 'ep.placePirate', labelId: 'ep.pirate.place', targets: ep.pirateTargets, fromHints: true }
      : null;
  }
  const setup = ep.setup;
  if (setup) {
    if (setup.step === 'harbor') return { kind: 'vertex', commandType: 'ep.setupHarbor', labelId: 'ep.setup.harbor', targets: setup.harbor, fromHints: true };
    if (setup.step === 'settlement') return { kind: 'vertex', commandType: 'ep.setupSettlement', labelId: 'ep.setup.settlement', targets: setup.settlement, fromHints: true };
    return setup.ship.length > 0
      ? { kind: 'edge', commandType: 'ep.setupShip', labelId: 'ep.setup.ship', targets: setup.ship, fromHints: true }
      : { kind: 'edge', commandType: 'ep.setupRoad', labelId: 'ep.setup.road', targets: setup.road, fromHints: true };
  }
  // The ship in motion keeps the board armed until it stops.
  const active = epView(view)?.turn.active ?? null;
  const ship = active ? ep.ships.find((candidate) => candidate.id === active) : undefined;
  if (ep.phase === 'movement' && ship && !ship.done && ship.steps.length > 0) {
    return {
      kind: 'edge', commandType: 'ep.moveShip', labelId: ep.stranded ? 'ep.move.stranded' : 'ep.move.step',
      targets: ship.steps.map((step) => step.edge), fromHints: true, params: { ship: ship.id },
    };
  }
  return null;
}

function epShipHint(state: TableState) {
  const id = state.selection.params?.ship;
  return epHints(state.game?.view)?.ships.find((ship) => ship.id === id);
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
    case 'ep.setupHarbor':
      return epHints(state.game?.view)?.setup?.harbor ?? [];
    case 'ep.setupSettlement':
      return epHints(state.game?.view)?.setup?.settlement ?? [];
    case 'ep.setupRoad':
      return epHints(state.game?.view)?.setup?.road ?? [];
    case 'ep.setupShip':
      return epHints(state.game?.view)?.setup?.ship ?? [];
    case 'ep.buildHarbor':
      return epHints(state.game?.view)?.harbors ?? [];
    case 'ep.buildShip':
      return epHints(state.game?.view)?.shipEdges ?? [];
    case 'ep.placePirate':
      return epHints(state.game?.view)?.pirateTargets ?? [];
    case 'ep.moveShip':
      return epShipHint(state)?.steps.map((step) => step.edge) ?? [];
    case 'ep.found':
      return epShipHint(state)?.found ?? [];
    case 'ep.dropCrew':
      return epShipHint(state)?.dropCrew ?? [];
    case 'ep.pickCrew':
      return epShipHint(state)?.pickCrew ?? [];
    case 'ep.loadFish':
      return epShipHint(state)?.loadFish ?? [];
    case 'ep.loadSpice':
      return epShipHint(state)?.loadSpice ?? [];
    case 'ship.move': {
      const from = state.selection.params?.from;
      return seafarersHints(state.game?.view)?.movableShips.find((ship) => ship.edge === from)?.targets ?? [];
    }
    default:
      return [];
  }
}
