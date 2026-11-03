/** Cities & Knights module state (`GameState.moduleState.citiesKnights`). */

import type { CardKind, GameState, ProgressCardType } from '../../types.ts';
import { moduleStateOf, setModuleState } from '../state.ts';
import { CITIES_KNIGHTS, type EventFace, type KnightLevel, type Track } from './constants.ts';

/** A knight on the board. Knights in a player's supply are not listed. */
export interface Knight {
  player: string;
  vertex: number;
  level: KnightLevel;
  active: boolean;
  /**
   * Action window (`GameState.windowId`) in which the knight was last
   * activated; it may not act in that window (CK25 p. 9).
   */
  activatedIn?: number;
  /** Window of the knight's last promotion; once per turn (CK25 p. 9). */
  promotedIn?: number;
}

export interface Metropolis {
  player: string;
  vertex: number;
}

/** The last roll's event die, kept for the table display. */
export interface EventRoll {
  event: EventFace;
  red: number;
  /** `GameState.seq` of the roll. */
  atSeq: number;
  /** The production dice were set by Alchemy. */
  alchemy?: boolean;
}

/** Public outcome of the last barbarian attack. */
export interface AttackSummary {
  atSeq: number;
  barbarians: number;
  defenders: number;
  /** Active-knight strength contributed per player. */
  contributions: Record<string, number>;
  outcome: 'barbarians' | 'defenders';
  /** Players who lose a city (barbarians win). */
  losers: string[];
  /** The Defender of Catan (single highest contributor), if any. */
  defender: string | null;
  /** Tied best contributors who draw a progress card instead. */
  tied: string[];
  /** Pillaged cities as they are resolved. */
  pillaged: { player: string; vertex: number }[];
}

export interface CitiesKnightsState {
  /** Barbarian ship position, 0 (start) .. BARBARIAN_TRACK_LENGTH (attack). */
  barbarian: number;
  /** Attacks so far; the robber enters play with the first (CK25 p. 6). */
  attacks: number;
  knights: Knight[];
  /** City vertices with a wall (the owner is the city's owner). */
  walls: number[];
  metropolises: Record<Track, Metropolis | null>;
  /**
   * Pillaged cities that lie on their side as a settlement because the owner
   * had no settlement piece left; each must be upgraded before any other
   * settlement (CK25 p. 11).
   */
  toppled: number[];
  /** Face-up victory-point progress cards per player (CK25 pp. 6, 10). */
  progressVp: Record<string, ProgressCardType[]>;
  lastRoll: EventRoll | null;
  lastAttack: AttackSummary | null;
  /**
   * Players who received at least one card in the current production, for
   * the science level-3 ability (cleared once it is resolved).
   */
  produced?: string[];
  /** The merchant piece (CK25 pp. 7, 14); absent until the first Merchant card. */
  merchant?: MerchantPiece | null;
  /** Production dice set by Alchemy for the coming roll (CK25 p. 13). */
  alchemy?: { player: string; windowId: number; dice: [number, number] } | null;
  /** Card kinds named by Merchant Fleet, valid in their action window (CK25 p. 15). */
  fleets?: { player: string; windowId: number; kind: CardKind }[];
  /**
   * Commercial Harbor offers still open in the current window: the player who
   * played it and how many offers each other player may still receive
   * (CK25 p. 14).
   */
  harbor?: { player: string; windowId: number; offers: Record<string, number> } | null;
}

export interface MerchantPiece {
  player: string;
  hex: number;
}

export function initialCitiesKnightsState(state: GameState): CitiesKnightsState {
  return {
    barbarian: 0,
    attacks: 0,
    knights: [],
    walls: [],
    metropolises: { science: null, trade: null, politics: null },
    toppled: [],
    progressVp: Object.fromEntries(state.players.map((player) => [player.id, []])),
    lastRoll: null,
    lastAttack: null,
  };
}

export function ckState(state: GameState): CitiesKnightsState {
  return moduleStateOf<CitiesKnightsState>(state, CITIES_KNIGHTS) ??
    setModuleState(state, CITIES_KNIGHTS, initialCitiesKnightsState(state));
}

/** Read-only access for views (never writes a missing slot). */
export function ckView(state: GameState): CitiesKnightsState {
  return moduleStateOf<CitiesKnightsState>(state, CITIES_KNIGHTS) ?? initialCitiesKnightsState(state);
}

export function knightAt(state: GameState, vertex: number): Knight | undefined {
  return ckView(state).knights.find((knight) => knight.vertex === vertex);
}

export function metropolisAt(state: GameState, vertex: number): Track | null {
  const metropolises = ckView(state).metropolises;
  for (const track of Object.keys(metropolises) as Track[]) {
    if (metropolises[track]?.vertex === vertex) return track;
  }
  return null;
}

/** Turn order starting with the current actor (CK25 p. 6: draws in turn order). */
export function turnOrder(state: GameState): string[] {
  const count = state.players.length;
  return Array.from({ length: count }, (_, offset) => state.players[(state.turn.seat + offset) % count]!.id);
}
