/**
 * Non-colour identification for terrain, resources, pieces and dice numbers.
 *
 * Every terrain carries a Latin letter *and* a glyph *and* a colour, so the
 * board stays readable without colour perception (docs/SPEC.md §8.1, U-04).
 */

import { TERRAIN_RESOURCE, type Resource } from '@catan/rules';

export const TERRAIN_LETTER: Readonly<Record<string, string>> = {
  forest: 'F',
  hills: 'H',
  pasture: 'P',
  fields: 'G',
  mountains: 'M',
  desert: 'D',
  gold: 'Au',
  sea: 'S',
};

export const TERRAIN_SYMBOL: Readonly<Record<string, string>> = {
  forest: '♠',
  hills: '▲',
  pasture: '❋',
  fields: '≋',
  mountains: '◆',
  desert: '∅',
  gold: '★',
  sea: '≈',
};

export const TERRAIN_FILL: Readonly<Record<string, string>> = {
  forest: '#2f6b3a',
  hills: '#a4552b',
  pasture: '#7fb069',
  fields: '#d8b24a',
  mountains: '#7d7d86',
  desert: '#e0cfa9',
  gold: '#c9a227',
  sea: '#2b5f8a',
};

export const ALL_TERRAIN: readonly string[] = [
  'forest',
  'hills',
  'pasture',
  'fields',
  'mountains',
  'desert',
  'gold',
  'sea',
];

export const RESOURCE_GLYPH: Readonly<Record<string, string>> = {
  lumber: '♠',
  brick: '▲',
  wool: '❋',
  grain: '≋',
  ore: '◆',
};

/** Probability pips per dice total (out of 36), shown as a non-colour cue. */
export const NUMBER_PIPS: Readonly<Record<number, number>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

export const PLAYER_COLOR_HEX: Readonly<Record<string, string>> = {
  red: '#c0392b',
  blue: '#2c6fb5',
  orange: '#d97b1f',
  white: '#f2f2f2',
  green: '#2e7d4f',
  brown: '#7b5230',
};

/**
 * Dash patterns indexed by seat, so two players' roads are distinguishable
 * without relying on colour.
 */
export const SEAT_DASH: readonly string[] = [
  '',
  '10 6',
  '3 4',
  '14 4 3 4',
  '6 3 2 3',
  '2 3',
];

export function seatDash(seat: number): string {
  return SEAT_DASH[seat % SEAT_DASH.length] ?? '';
}

export function terrainLetter(terrain: string): string {
  return TERRAIN_LETTER[terrain] ?? '?';
}

export function terrainSymbol(terrain: string): string {
  return TERRAIN_SYMBOL[terrain] ?? '?';
}

export function terrainFill(terrain: string): string {
  return TERRAIN_FILL[terrain] ?? '#999999';
}

export function resourceOfTerrain(terrain: string): Resource | null {
  return (TERRAIN_RESOURCE as Record<string, Resource | undefined>)[terrain] ?? null;
}

export function pipsFor(number: number | null | undefined): number {
  if (typeof number !== 'number') return 0;
  return NUMBER_PIPS[number] ?? 0;
}

export function playerColorHex(color: string): string {
  return PLAYER_COLOR_HEX[color] ?? '#888888';
}
