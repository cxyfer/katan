/**
 * Seafarers miniatures for the 3D board: a cog per player colour, the pirate
 * ship and the island-bonus token stack. Procedural geometry in the style of
 * `diorama-structures.ts` (painted boxes, cylinders and extrusions); nothing is
 * traced from official artwork. Ships float at sea level, so their placement
 * pushes coastal ships off the beach towards the water.
 */

import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Shape } from 'three';
import type { PublicBoardView } from '@catan/rules';
import { confirmedPlacement } from '../effects.ts';
import type { BoardEffectGroup } from '../animation.ts';
import type { BoardGeometry } from '../geometry.ts';
import { SEA_LEVEL } from '../sea.ts';
import { ModelBuilder } from './diorama-geometry.ts';
import { horizontalRotation, type InstanceTransform, type Vec3 } from './transforms.ts';

const TIMBER = '#6b442c';
const SAIL = '#f6ead0';
const ROPE = '#dfcb93';

function tint(color: string, amount: number): string {
  return `#${new Color(color).lerp(new Color(amount > 0 ? '#fff0ce' : '#212e32'), Math.abs(amount)).getHexString()}`;
}

function box(model: ModelBuilder, color: string, position: Vec3, scale: Vec3, rotation: Vec3 = [0, 0, 0]) {
  model.add(new BoxGeometry(1, 1, 1), color, position, scale, rotation);
}

/** Side profile of a hull (x along the keel, y up), extruded across its beam. */
function hull(length: number, depth: number, beam: number, sheer: number): BufferGeometry {
  const half = length / 2;
  const shape = new Shape();
  shape.moveTo(-half, sheer);
  shape.lineTo(-half * 0.86, -depth * 0.35);
  shape.quadraticCurveTo(-half * 0.6, -depth, -half * 0.2, -depth);
  shape.lineTo(half * 0.45, -depth);
  shape.quadraticCurveTo(half * 0.9, -depth * 0.85, half, sheer + depth * 0.25);
  shape.lineTo(-half, sheer);
  return new ExtrudeGeometry(shape, { depth: beam, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1, steps: 1 })
    .translate(0, 0, -beam / 2);
}

/** A player's cog: coloured hull, one mast with a striped square sail, seat marks on the deck. */
export function createShipModel(color: string, seat: number): BufferGeometry {
  const model = new ModelBuilder();
  model.add(hull(0.4, 0.06, 0.13, 0.04), color, [0, 0.045, 0]);
  box(model, tint(color, -0.35), [0, 0.082, 0], [0.34, 0.012, 0.12]);
  box(model, TIMBER, [0.14, 0.1, 0], [0.07, 0.04, 0.11]);
  box(model, TIMBER, [-0.15, 0.098, 0], [0.06, 0.03, 0.11]);
  model.add(new CylinderGeometry(0.008, 0.01, 0.34, 6), TIMBER, [0, 0.25, 0]);
  box(model, TIMBER, [0, 0.36, 0], [0.012, 0.012, 0.2]);
  box(model, SAIL, [0, 0.27, 0.012], [0.012, 0.17, 0.19]);
  box(model, color, [0, 0.29, 0.02], [0.014, 0.05, 0.192]);
  model.add(new CylinderGeometry(0.003, 0.003, 0.3, 4), ROPE, [0.1, 0.22, 0], [1, 1, 1], [0, 0, 0.62]);
  box(model, color, [0, 0.43, 0.035], [0.006, 0.03, 0.06]);
  const count = 1 + ((Math.trunc(seat) % 6) + 6) % 6;
  for (let index = 0; index < count; index++) box(model, '#f8e9c9', [-0.1 + index * 0.04, 0.09, 0.062], [0.02, 0.012, 0.006]);
  return model.build();
}

/** The pirate: a dark galleon with three black sails and a bone-white mark. */
export function createPirateModel(): BufferGeometry {
  const model = new ModelBuilder();
  const hullColor = '#2b2522';
  model.add(hull(0.56, 0.08, 0.18, 0.05), hullColor, [0, 0.06, 0]);
  box(model, '#c9a14a', [0, 0.1, 0.092], [0.46, 0.012, 0.004]);
  box(model, '#c9a14a', [0, 0.1, -0.092], [0.46, 0.012, 0.004]);
  box(model, '#3a2f2a', [-0.21, 0.14, 0], [0.12, 0.07, 0.17]);
  for (const [x, height] of [[-0.12, 0.38], [0.04, 0.46], [0.18, 0.3]] as const) {
    model.add(new CylinderGeometry(0.009, 0.011, height, 6), '#21170e', [x, 0.1 + height / 2, 0]);
    box(model, '#1b1716', [x, 0.12 + height * 0.62, 0.012], [0.012, height * 0.42, 0.2]);
  }
  box(model, '#efe6cf', [0.04, 0.42, 0.02], [0.014, 0.05, 0.05]);
  box(model, '#0b0908', [0.04, 0.6, 0.04], [0.006, 0.04, 0.08]);
  return model.build();
}

/** Two stacked victory-point tokens with a coloured pin for their owner. */
export function createIslandTokenModel(color: string): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.075, 0.075, 0.018, 14), '#b9862a', [0, 0.012, 0]);
  model.add(new CylinderGeometry(0.075, 0.075, 0.018, 14), '#f2c95a', [0, 0.032, 0]);
  model.add(new CylinderGeometry(0.05, 0.05, 0.004, 14), '#d9a534', [0, 0.043, 0]);
  model.add(new CylinderGeometry(0.012, 0.012, 0.07, 6), color, [0.05, 0.075, 0]);
  return model.build();
}

export interface ShipInstance extends InstanceTransform {
  index: number;
  playerId: string;
  arriving: boolean;
}

/**
 * Where a ship floats on an edge: at sea level, nudged off a coast into the
 * water (towards the sea hex, or away from the land hex at the frame).
 */
export function shipTransform(geometry: BoardGeometry, edgeIndex: number): { position: Vec3; rotationY: number } | null {
  const edge = geometry.edges[edgeIndex];
  const info = geometry.topology.edges[edgeIndex];
  if (!edge || !info) return null;
  const scale = geometry.scale;
  const mx = (edge.x1 + edge.x2) / 2 / scale;
  const mz = (edge.y1 + edge.y2) / 2 / scale;
  let x = mx;
  let z = mz;
  const land = info.hexes.filter((hex) => geometry.land[hex] !== false);
  if (land.length === 1) {
    const hex = geometry.hexes[land[0]!]!;
    const dx = mx - hex.cx / scale;
    const dz = mz - hex.cy / scale;
    const length = Math.hypot(dx, dz) || 1;
    x += (dx / length) * 0.2;
    z += (dz / length) * 0.2;
  }
  return {
    position: [x, SEA_LEVEL + 0.01, z],
    rotationY: horizontalRotation((edge.x2 - edge.x1) / scale, (edge.y2 - edge.y1) / scale),
  };
}

export function shipInstances(geometry: BoardGeometry, board: PublicBoardView, active: BoardEffectGroup | null): ShipInstance[] {
  const out: ShipInstance[] = [];
  board.roads.forEach((road, index) => {
    if (!road?.ship) return;
    const transform = shipTransform(geometry, index);
    if (!transform) return;
    out.push({
      index,
      playerId: road.player,
      arriving: confirmedPlacement(active?.events ?? [], board, 'edge', index),
      position: transform.position,
      rotationY: transform.rotationY,
      scale: [1, 1, 1],
    });
  });
  return out;
}

/** The pirate on its sea hex, or waiting on the frame east of the map. */
export function pirateTransform(geometry: BoardGeometry, board: PublicBoardView): { position: Vec3; onFrame: boolean } {
  const scale = geometry.scale;
  const hex = board.pirate === null ? undefined : geometry.hexes[board.pirate];
  if (hex) return { position: [hex.cx / scale, SEA_LEVEL + 0.01, hex.cy / scale], onFrame: false };
  const maxX = Math.max(...geometry.hexes.map((cell) => cell.cx / scale));
  const midZ = geometry.hexes.reduce((sum, cell) => sum + cell.cy / scale, 0) / Math.max(1, geometry.hexes.length);
  return { position: [maxX + 0.9, SEA_LEVEL + 0.01, midZ], onFrame: true };
}
