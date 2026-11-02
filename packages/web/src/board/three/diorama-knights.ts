/**
 * Cities & Knights miniatures for the 3D board: knights in three strengths
 * (standing when active, lying on their base when inactive), the stone city
 * wall and the metropolis tower of each track. Procedural geometry in the
 * style of `diorama-structures.ts`; nothing is traced from official artwork.
 * Strength never depends on colour alone: it is the helmet crest and the
 * number of studs on the base.
 */

import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from 'three';
import type { KnightLevel, Track } from '../citiesKnights.ts';
import type { BoardGeometry } from '../geometry.ts';
import { geometryToWorld } from './bounds.ts';
import { ModelBuilder } from './diorama-geometry.ts';
import { createSettlementModel } from './diorama-structures.ts';
import { SHIP_SCALE } from './diorama-ships.ts';
import { SEA_LEVEL } from '../sea.ts';
import type { InstanceTransform, Vec3 } from './transforms.ts';

const STEEL = '#c9ced3';
const DARK = '#263b3d';
const STONE = '#bdb59c';
const GOLD = '#e2b33c';
const TIMBER = '#6b442c';

/** Track banner colours (green science, yellow trade, blue politics). */
export const TRACK_HEX: Readonly<Record<Track, string>> = { science: '#3f9a4e', trade: '#d8a81f', politics: '#3a6fb8' };

function tint(color: string, amount: number): string {
  return `#${new Color(color).lerp(new Color(amount > 0 ? '#fff0ce' : '#212e32'), Math.abs(amount)).getHexString()}`;
}

function box(model: ModelBuilder, color: string, position: Vec3, scale: Vec3, rotation: Vec3 = [0, 0, 0]) {
  model.add(new BoxGeometry(1, 1, 1), color, position, scale, rotation);
}

/** The standing figure, built upright around the origin of its base. */
function knightFigure(model: ModelBuilder, color: string, level: KnightLevel, offset: Vec3, rotation: Vec3) {
  // Each part is placed in figure space, then the whole figure is rotated
  // (lying knights) and moved onto the base.
  const parts: [BufferGeometry, string, Vec3, Vec3?][] = [
    [new CylinderGeometry(0.045, 0.07, 0.16, 8), color, [0, 0.1, 0]],
    [new SphereGeometry(0.045, 10, 8), STEEL, [0, 0.215, 0]],
    [new BoxGeometry(0.07, 0.012, 0.012), DARK, [0, 0.215, 0.04]],
    [new BoxGeometry(0.1, 0.12, 0.018), tint(color, -0.25), [0.07, 0.12, 0.03]],
    [new BoxGeometry(0.02, 0.07, 0.02), STEEL, [0.07, 0.125, 0.042]],
    [new CylinderGeometry(0.007, 0.007, 0.32, 5), TIMBER, [-0.07, 0.16, 0]],
    [new ConeGeometry(0.014, 0.04, 5), STEEL, [-0.07, 0.34, 0]],
  ];
  if (level >= 2) parts.push([new ConeGeometry(0.02, 0.09, 6), tint(color, 0.35), [0, 0.29, -0.01]]);
  if (level >= 3) {
    parts.push([new TorusGeometry(0.04, 0.008, 6, 12), GOLD, [0, 0.25, 0], [1, 1, 1]]);
    parts.push([new BoxGeometry(0.004, 0.05, 0.06), GOLD, [-0.07, 0.29, 0.03]]);
  }
  const lying = rotation[2] !== 0;
  for (const [geometry, partColor, position] of parts) {
    // A lying figure rolls −90° about z: (x, y) → (y, −x), re-centred on the base.
    const placed: Vec3 = lying ? [position[1] - 0.17, 0.075 - position[0], position[2]] : position;
    const isTorus = geometry instanceof TorusGeometry;
    const base: Vec3 = isTorus ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    model.add(geometry, partColor, [placed[0] + offset[0], placed[1] + offset[1], placed[2] + offset[2]], [1, 1, 1],
      lying ? [base[0], base[1], base[2] - Math.PI / 2] : base);
  }
}

/** A knight token: a round coloured base with studs for its strength and the figure. */
export function createKnightModel(color: string, level: KnightLevel, active: boolean, seat: number): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.15, 0.16, 0.035, 18), tint(color, -0.3), [0, 0.018, 0]);
  model.add(new CylinderGeometry(0.135, 0.135, 0.008, 18), active ? color : tint(color, -0.15), [0, 0.039, 0]);
  for (let index = 0; index < level; index++) {
    const angle = Math.PI * 0.75 + index * 0.45;
    model.add(new SphereGeometry(0.016, 8, 6), '#fff6dd', [Math.cos(angle) * 0.12, 0.045, Math.sin(angle) * 0.12]);
  }
  // Seat marks on the rim (as on roads and buildings), for colour-blind play.
  const count = 1 + ((Math.trunc(seat) % 6) + 6) % 6;
  for (let index = 0; index < count; index++) box(model, '#f8e9c9', [-0.05 + index * 0.02, 0.026, -0.155], [0.012, 0.012, 0.006]);
  knightFigure(model, color, level, [0, 0.043, 0], active ? [0, 0, 0] : [0, 0, -Math.PI / 2]);
  return model.build();
}

/** A ring of stone wall with crenels, sized to sit under a city. */
export function createWallModel(color: string): BufferGeometry {
  const model = new ModelBuilder();
  const radius = 0.3;
  const segments = 14;
  for (let index = 0; index < segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    box(model, STONE, [x, 0.035, z], [0.13, 0.07, 0.045], [0, -angle + Math.PI / 2, 0]);
    if (index % 2 === 0) box(model, tint(STONE, -0.12), [x, 0.085, z], [0.05, 0.03, 0.05], [0, -angle + Math.PI / 2, 0]);
  }
  model.add(new TorusGeometry(radius, 0.012, 4, 28), color, [0, 0.072, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  return model.build();
}

/**
 * A toppled city (pillaged with no settlement piece left, CK25 p. 11): the city
 * miniature rolled a quarter turn onto its side, resting on the ground, so the
 * owner sees it must be rebuilt before another settlement is upgraded.
 */
export function createToppledCityModel(color: string, seat: number): BufferGeometry {
  const model = createSettlementModel(color, true, seat);
  model.rotateZ(-Math.PI / 2);
  model.computeBoundingBox();
  model.translate(0, -model.boundingBox!.min.y, 0);
  model.computeBoundingBox();
  return model;
}

/** A metropolis: a tall stone keep with the track banner on top. */
export function createMetropolisModel(color: string, track: Track): BufferGeometry {
  const model = new ModelBuilder();
  const banner = TRACK_HEX[track];
  model.add(new CylinderGeometry(0.075, 0.09, 0.82, 8), '#d9ceb1', [0, 0.41, 0]);
  model.add(new CylinderGeometry(0.1, 0.1, 0.05, 8), '#cfc3a3', [0, 0.84, 0]);
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2;
    box(model, '#cfc3a3', [Math.cos(angle) * 0.09, 0.885, Math.sin(angle) * 0.09], [0.035, 0.04, 0.035]);
  }
  model.add(new CylinderGeometry(0.093, 0.093, 0.04, 8), color, [0, 0.12, 0]);
  box(model, DARK, [0, 0.55, 0.083], [0.03, 0.08, 0.01]);
  model.add(new CylinderGeometry(0.006, 0.006, 0.3, 5), TIMBER, [0, 1.03, 0]);
  box(model, banner, [0.075, 1.12, 0], [0.14, 0.09, 0.008]);
  box(model, tint(banner, -0.4), [0.075, 1.12, 0.006], [0.05, 0.03, 0.004]);
  return model.build();
}

export interface KnightInstance extends InstanceTransform {
  vertex: number;
  playerId: string;
  level: KnightLevel;
  active: boolean;
}

/** World transform of a piece on an intersection. */
export function vertexTransform(geometry: BoardGeometry, vertexIndex: number, offset: [number, number] = [0, 0], scale = 1): InstanceTransform | null {
  const vertex = geometry.vertices[vertexIndex];
  if (!vertex) return null;
  const point = geometryToWorld(geometry, vertex.x, vertex.y);
  return { position: [point.x + offset[0], vertexBaseY(geometry, vertexIndex), point.z + offset[1]], rotationY: ((vertexIndex * 23) % 6) * (Math.PI / 6), scale: [scale, scale, scale] };
}

/** Deck height of a player's ship above the water, at board scale. */
export const SHIP_DECK_Y = SEA_LEVEL + 0.01 + 0.088 * SHIP_SCALE;

/**
 * Height a piece stands at on an intersection: the land, or — on an
 * intersection between sea hexes only (Seafarers + C&K, COMB-3) — the deck of
 * the ship that carries the knight.
 */
export function vertexBaseY(geometry: BoardGeometry, vertexIndex: number): number {
  const hexes = geometry.topology.vertices[vertexIndex]?.hexes ?? [];
  const atSea = hexes.length > 0 && hexes.every((hex) => geometry.land[hex] === false);
  return atSea ? SHIP_DECK_Y : 0.005;
}

/** Knights read at board scale next to cities (their model is built at 1:1). */
export const KNIGHT_SCALE = 1.5;

/** The metropolis keep stands just behind its city (towards −z). */
export const METROPOLIS_OFFSET: [number, number] = [0.2, -0.16];
