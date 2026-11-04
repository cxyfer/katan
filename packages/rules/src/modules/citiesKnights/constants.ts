/**
 * Cities & Knights constants, transcribed from CK25 (CN3087) and CK56-25
 * (CN3088). Pages are cited per value; see
 * docs/aegis/work/2026-11-02-cities-knights-core.md for the transcription.
 */

import type { Commodity, ProgressCardType, Resource } from '../../types.ts';

export const CITIES_KNIGHTS = 'citiesKnights';

/** The three city-improvement tracks (CK25 p. 3). */
export type Track = 'science' | 'trade' | 'politics';
export const TRACKS: readonly Track[] = ['science', 'trade', 'politics'];

/** Commodity paid for each track's improvements (CK25 p. 3 board). */
export const TRACK_COMMODITY: Readonly<Record<Track, Commodity>> = {
  science: 'paper',
  trade: 'cloth',
  politics: 'coin',
};

/** Highest improvement level; level n costs n commodities (CK25 p. 3). */
export const MAX_LEVEL = 5;
/** Level with the track's permanent ability (CK25 p. 8). */
export const ABILITY_LEVEL = 3;
/** First level that can take the track's metropolis (temporary, CK25 p. 8). */
export const METROPOLIS_LEVEL = 4;
/** Level whose first holder keeps the metropolis permanently (CK25 p. 8). */
export const PERMANENT_METROPOLIS_LEVEL = 5;

/**
 * Highest red-die value that draws a progress card at a level: level 1 draws
 * on 1–2, level 2 on 1–3 … level 5 on 1–6; level 0 never (CK25 p. 3 board,
 * p. 8 example).
 */
export function drawThreshold(level: number): number {
  return level <= 0 ? 0 : level + 1;
}

/** Building costs printed in CK25 pp. 8–9. */
export const WALL_COST: Partial<Record<Resource, number>> = { brick: 2 };
export const KNIGHT_COST: Partial<Record<Resource, number>> = { wool: 1, ore: 1 };
export const PROMOTE_COST: Partial<Record<Resource, number>> = { wool: 1, ore: 1 };
export const ACTIVATE_COST: Partial<Record<Resource, number>> = { grain: 1 };

/** City walls a player may have built at once (CK25 p. 8). */
export const MAX_WALLS = 3;
/** Each wall raises the 7 discard limit by this much (CK25 p. 8). */
export const WALL_HAND_BONUS = 2;
/** Knights per strength per player: two basic, two strong, two mighty (CK25 p. 9). */
export const KNIGHTS_PER_LEVEL = 2;
export type KnightLevel = 1 | 2 | 3;

/**
 * Barbarian track: the ship starts on space 0 and the barbarians attack when
 * it reaches space 7 (the printed frame has 8 spaces, CK25 pp. 3, 6).
 */
export const BARBARIAN_TRACK_LENGTH = 7;

/** Progress-card hand limit, unchanged for 5–6 players (CK25 p. 10, CK56-25). */
export const PROGRESS_HAND_LIMIT = 4;

/**
 * Event-die faces. CK25 does not list them; the die is the C&K component
 * with three barbarian-ship faces and one city gate per track (source gap
 * recorded in docs/FIDELITY.md).
 */
export type EventFace = 'ship' | Track;
export const EVENT_FACES: readonly EventFace[] = ['ship', 'ship', 'ship', 'science', 'trade', 'politics'];

/** Victory-point progress cards, revealed at once (CK25 pp. 6, 14, 16). */
export const VP_PROGRESS_CARDS: readonly ProgressCardType[] = ['printing', 'constitution'];

/** The three progress decks, 18 cards each (CK25 pp. 13–16). */
export const PROGRESS_DECKS: Readonly<Record<Track, readonly ProgressCardType[]>> = {
  science: [
    ...repeat('alchemy', 2),
    ...repeat('crane', 2),
    'engineering',
    ...repeat('invention', 2),
    ...repeat('irrigation', 2),
    ...repeat('medicine', 2),
    ...repeat('mining', 2),
    'printing',
    ...repeat('roadBuilding', 2),
    ...repeat('smithing', 2),
  ],
  trade: [
    ...repeat('commercialHarbor', 2),
    ...repeat('guildDues', 2),
    ...repeat('merchant', 6),
    ...repeat('merchantFleet', 2),
    ...repeat('resourceMonopoly', 4),
    ...repeat('tradeMonopoly', 2),
  ],
  politics: [
    'constitution',
    ...repeat('diplomacy', 2),
    ...repeat('encouragement', 2),
    ...repeat('espionage', 3),
    ...repeat('intrigue', 2),
    ...repeat('sabotage', 2),
    ...repeat('taxation', 2),
    ...repeat('treason', 2),
    ...repeat('wedding', 2),
  ],
};

/** The deck a progress card belongs to (discards go under it, CK25 p. 6). */
export function trackOfCard(card: ProgressCardType): Track {
  for (const track of TRACKS) if (PROGRESS_DECKS[track].includes(card)) return track;
  throw new Error(`unknown progress card: ${card}`);
}

function repeat(value: ProgressCardType, count: number): ProgressCardType[] {
  return Array<ProgressCardType>(count).fill(value);
}
