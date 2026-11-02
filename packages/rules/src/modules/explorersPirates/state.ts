/**
 * Explorers & Pirates module state (`GameState.moduleState.explorersPirates`).
 *
 * Everything here is public table information: coins, ships and their cargo,
 * harbour settlements, sites on explored hexes, mission tracks and the
 * composition of each unexplored region (the component list minus what has
 * been revealed). Unexplored tiles have no identity until a ship reveals
 * them, so the state holds nothing that a projection could leak.
 */

import type { EpMission, EpRegion, EpScenarioId, EpTile } from '../../explorers-pirates-boards.ts';
import type { GameState } from '../../types.ts';
import { moduleStateOf } from '../state.ts';

export const EXPLORERS_PIRATES = 'explorersPirates';

/** Large pieces fill a hold; small pieces take one of its two places. */
export type Cargo = 'settler' | 'crew' | 'fish' | 'spice';
export const CARGO_SIZE: Readonly<Record<Cargo, number>> = { settler: 2, fish: 2, crew: 1, spice: 1 };
export const HOLD_CAPACITY = 2;

export type SpiceAbility = 'swift' | 'fastGold' | 'pirateBonus';

export interface EpShip {
  id: string;
  player: string;
  edge: number;
  cargo: Cargo[];
}

export interface EpHarbor {
  vertex: number;
  player: string;
  cargo: Cargo[];
}

export type EpSite =
  | { hex: number; kind: 'council' }
  /** Gold field with its pirate lair; `crews` in arrival order (player ids). */
  | { hex: number; kind: 'lair'; crews: string[]; captured: boolean }
  | { hex: number; kind: 'shoal'; number: number; fish: boolean }
  /** `sacks`: players who may still load this farm's sack. */
  | { hex: number; kind: 'spice'; ability: SpiceAbility; bonus: number | null; crews: string[]; sacks: string[] };

export interface EpRegionPool {
  tiles: Partial<Record<EpTile, number>>;
  discs: number[];
  shoals: number[];
  abilities: SpiceAbility[];
}

export interface EpTrack {
  /** Track space per player (0 = start). */
  positions: Record<string, number>;
  /** Arrival order on the current space: lower arrived earlier (bottom of the stack). */
  arrivals: Record<string, number>;
}

/** Per-ship movement state for the current turn. */
export interface EpShipTurn {
  /** Edges moved so far. */
  used: number;
  /** 1 wool paid for 2 extra MP (once per ship and turn). */
  extra: boolean;
  /** Exploring ended the movement, or another ship started moving. */
  done: boolean;
  tribute: boolean;
  /** Tried to chase the pirate this turn. */
  chased: boolean;
}

export interface EpTurn {
  /** The action window this record belongs to; a new window starts empty. */
  windowId: number;
  phase: 'action' | 'movement';
  ships: Record<string, EpShipTurn>;
  /** The ship whose movement is in progress. */
  active: string | null;
  goldBuys: number;
  fastGold: number;
  fishRolled: boolean;
}

export interface EpSetup {
  /** Route step: the road and the settler ship placed by the current player. */
  road: boolean;
  ship: boolean;
}

export interface ExplorersPiratesState {
  scenario: EpScenarioId;
  startIsland: number[];
  /** Unexplored hexes and their region. */
  fog: { hex: number; region: EpRegion }[];
  council: number | null;
  harborMarks: number[];
  pools: Record<EpRegion, EpRegionPool>;
  lairTokens: number[];
  sites: EpSite[];
  ships: EpShip[];
  harbors: EpHarbor[];
  nextShip: number;
  gold: Record<string, number>;
  goldSupply: number;
  fishSupply: number;
  pirate: { hex: number; owner: string } | null;
  tracks: Partial<Record<EpMission, EpTrack>>;
  arrivalSeq: number;
  /** Lairs with a third crew, resolved after the active player's movement. */
  captures: number[];
  turn: EpTurn;
  setup: EpSetup | null;
}

export function epState(state: GameState): ExplorersPiratesState {
  const slot = moduleStateOf<ExplorersPiratesState>(state, EXPLORERS_PIRATES);
  if (!slot) throw new Error('explorersPirates module state missing');
  return slot;
}

export function emptyTurn(windowId: number): EpTurn {
  return { windowId, phase: 'action', ships: {}, active: null, goldBuys: 0, fastGold: 0, fishRolled: false };
}

/** The current action window's turn record (reset when a new window opens). */
export function epTurn(state: GameState): EpTurn {
  const slot = epState(state);
  if (slot.turn.windowId !== state.windowId) slot.turn = emptyTurn(state.windowId);
  return slot.turn;
}

/** Read-only view of the turn record (no reset), for projections and hints. */
export function viewTurn(state: GameState): EpTurn {
  const slot = epState(state);
  return slot.turn.windowId === state.windowId ? slot.turn : emptyTurn(state.windowId);
}

export function shipTurn(turn: EpTurn, shipId: string): EpShipTurn {
  turn.ships[shipId] ??= { used: 0, extra: false, done: false, tribute: false, chased: false };
  return turn.ships[shipId]!;
}

export function cargoLoad(cargo: readonly Cargo[]): number {
  return cargo.reduce((sum, piece) => sum + CARGO_SIZE[piece], 0);
}

export function hasRoom(cargo: readonly Cargo[], piece: Cargo): boolean {
  return cargoLoad(cargo) + CARGO_SIZE[piece] <= HOLD_CAPACITY;
}

export function isFog(slot: ExplorersPiratesState, hex: number): boolean {
  return slot.fog.some((entry) => entry.hex === hex);
}

export function siteAt(slot: ExplorersPiratesState, hex: number): EpSite | undefined {
  return slot.sites.find((site) => site.hex === hex);
}
