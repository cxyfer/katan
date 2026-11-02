/**
 * Explorers & Pirates miniatures for the 3D board: the fog bank over an
 * unexplored hex with its region marker, cargo pieces (settler, crew, fish
 * haul, spice sack), the harbour flag, and the site markers (pirate lair,
 * fish shoal pips, spice farm, Council of Catan). Procedural geometry in the
 * style of `diorama-ships.ts`; nothing is traced from official artwork.
 */

import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, SphereGeometry } from 'three';
import type { EpCargo } from '@catan/rules';
import type { BoardGeometry } from '../geometry.ts';
import type { EpView } from '../explorersPirates.ts';
import { SEA_LEVEL } from '../sea.ts';
import { ModelBuilder } from './diorama-geometry.ts';
import { shipTransform } from './diorama-ships.ts';
import type { InstanceTransform, Vec3 } from './transforms.ts';

const MIST = '#eef1f0';
const MIST_SHADE = '#cfd6d8';

function box(model: ModelBuilder, color: string, position: Vec3, scale: Vec3, rotation: Vec3 = [0, 0, 0]) {
  model.add(new BoxGeometry(1, 1, 1), color, position, scale, rotation);
}

/** A low bank of cloud puffs covering a hex (radius ≈ 0.9 world units). */
export function createFogModel(): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.9, 0.92, 0.1, 6), MIST_SHADE, [0, 0.05, 0], [1, 1, 1], [0, Math.PI / 6, 0]);
  const puffs: [number, number, number, number][] = [
    [0, 0.16, 0, 0.42], [0.42, 0.12, 0.2, 0.3], [-0.4, 0.13, 0.18, 0.32], [0.16, 0.12, -0.42, 0.3],
    [-0.22, 0.11, -0.36, 0.28], [0.5, 0.1, -0.18, 0.24], [-0.52, 0.1, -0.12, 0.24], [0.08, 0.1, 0.5, 0.26],
  ];
  for (const [x, y, z, r] of puffs) model.add(new IcosahedronGeometry(r, 1), MIST, [x, y, z], [1, 0.55, 1]);
  return model.build();
}

/** Region marker on top of the fog: a parrot (red with a yellow beak) or a goose (white with a long neck). */
export function createRegionModel(region: 'parrot' | 'goose'): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.17, 0.17, 0.03, 16), region === 'parrot' ? '#2f7d4a' : '#5a6d7a', [0, 0.015, 0]);
  if (region === 'parrot') {
    model.add(new SphereGeometry(0.07, 10, 8), '#d9442f', [0, 0.09, 0], [1, 1.25, 1]);
    model.add(new SphereGeometry(0.045, 10, 8), '#d9442f', [0.03, 0.18, 0]);
    model.add(new ConeGeometry(0.02, 0.05, 6), '#f2c95a', [0.08, 0.17, 0], [1, 1, 1], [0, 0, -Math.PI / 2]);
    box(model, '#2f9a4f', [-0.06, 0.08, 0], [0.04, 0.1, 0.1], [0, 0, 0.5]);
  } else {
    model.add(new SphereGeometry(0.075, 10, 8), '#f6f4ee', [0, 0.08, 0], [1.3, 0.9, 1]);
    model.add(new CylinderGeometry(0.018, 0.022, 0.13, 6), '#f6f4ee', [0.07, 0.16, 0], [1, 1, 1], [0, 0, -0.35]);
    model.add(new SphereGeometry(0.03, 8, 6), '#f6f4ee', [0.1, 0.23, 0]);
    model.add(new ConeGeometry(0.014, 0.04, 6), '#e08a2a', [0.14, 0.23, 0], [1, 1, 1], [0, 0, -Math.PI / 2]);
  }
  return model.build();
}

/** One cargo piece; `color` paints settlers and crews in their owner's colour. */
export function createCargoModel(piece: EpCargo, color: string): BufferGeometry {
  const model = new ModelBuilder();
  switch (piece) {
    case 'settler':
      model.add(new CylinderGeometry(0.028, 0.04, 0.08, 8), color, [0, 0.04, 0]);
      model.add(new SphereGeometry(0.026, 8, 6), color, [0, 0.105, 0]);
      box(model, '#8a6a35', [-0.035, 0.06, 0], [0.03, 0.04, 0.04]);
      break;
    case 'crew':
      model.add(new CylinderGeometry(0.024, 0.034, 0.07, 8), color, [0, 0.035, 0]);
      model.add(new SphereGeometry(0.022, 8, 6), '#e9dcc0', [0, 0.09, 0]);
      model.add(new ConeGeometry(0.036, 0.03, 3), '#2a2523', [0, 0.115, 0]);
      break;
    case 'fish':
      model.add(new SphereGeometry(0.04, 10, 6), '#7cc6e8', [0, 0.03, 0], [1.5, 0.6, 0.7]);
      model.add(new ConeGeometry(0.03, 0.04, 4), '#5aa6c8', [-0.07, 0.03, 0], [1, 1, 0.5], [0, 0, Math.PI / 2]);
      break;
    case 'spice':
      model.add(new CylinderGeometry(0.03, 0.04, 0.07, 8), '#c9762e', [0, 0.035, 0]);
      model.add(new SphereGeometry(0.028, 8, 6), '#c9762e', [0, 0.075, 0], [1, 0.6, 1]);
      box(model, '#5a3505', [0, 0.085, 0], [0.04, 0.008, 0.008]);
      break;
  }
  return model.build();
}

/** A harbour settlement's flag: a mast with a white pennant and a coloured band. */
export function createHarborFlagModel(color: string): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.008, 0.01, 0.3, 6), '#3b2a17', [0, 0.15, 0]);
  box(model, '#fff6dd', [0.05, 0.26, 0], [0.1, 0.06, 0.006]);
  box(model, color, [0.05, 0.245, 0.004], [0.1, 0.018, 0.004]);
  model.add(new CylinderGeometry(0.03, 0.03, 0.012, 10), '#3b2a17', [0, 0.006, 0]);
  return model.build();
}

/** The Council of Catan: a small columned hall with a red banner. */
export function createCouncilModel(): BufferGeometry {
  const model = new ModelBuilder();
  box(model, '#d9c79a', [0, 0.03, 0], [0.62, 0.06, 0.44]);
  for (const x of [-0.24, -0.08, 0.08, 0.24]) model.add(new CylinderGeometry(0.03, 0.03, 0.2, 8), '#efe3c2', [x, 0.16, 0.16]);
  box(model, '#e8d6a8', [0, 0.16, -0.06], [0.56, 0.2, 0.22]);
  model.add(new ConeGeometry(0.4, 0.14, 4), '#a8553a', [0, 0.33, 0], [1, 1, 0.62], [0, Math.PI / 4, 0]);
  model.add(new CylinderGeometry(0.006, 0.006, 0.18, 4), '#3b2a17', [0, 0.47, 0]);
  box(model, '#b83a2e', [0.045, 0.52, 0], [0.08, 0.05, 0.006]);
  return model.build();
}

/** An unconquered pirate lair: a black flag with a bone mark on a rocky cairn. */
export function createLairModel(): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new IcosahedronGeometry(0.09, 0), '#6b625a', [0, 0.04, 0], [1, 0.6, 1]);
  model.add(new CylinderGeometry(0.008, 0.01, 0.36, 6), '#20180f', [0, 0.2, 0]);
  box(model, '#1b1716', [0.07, 0.32, 0], [0.14, 0.09, 0.008]);
  box(model, '#efe6cf', [0.07, 0.32, 0.006], [0.03, 0.03, 0.004]);
  return model.build();
}

/** A spice farm's sack stack. */
export function createSpiceFarmModel(): BufferGeometry {
  const model = new ModelBuilder();
  for (const [x, z] of [[-0.06, 0], [0.06, 0.02], [0, -0.07]] as const) {
    model.add(new CylinderGeometry(0.05, 0.06, 0.1, 8), '#c9762e', [x, 0.05, z]);
    model.add(new SphereGeometry(0.045, 8, 6), '#b8682a', [x, 0.11, z], [1, 0.5, 1]);
  }
  return model.build();
}

/** A shoal number as a ring of white pips on a buoy disc (no text in the scene). */
export function createShoalModel(number: number): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.16, 0.17, 0.03, 18), '#fff8e4', [0, 0.015, 0]);
  model.add(new CylinderGeometry(0.11, 0.11, 0.034, 18), '#3a6f8f', [0, 0.017, 0]);
  const count = Math.max(1, Math.min(12, Math.trunc(number)));
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2;
    model.add(new SphereGeometry(0.014, 6, 4), '#ffffff', [Math.cos(angle) * 0.075, 0.04, Math.sin(angle) * 0.075]);
  }
  return model.build();
}

/** World centre of a hex at the given height. */
export function hexPoint(geometry: BoardGeometry, hex: number, y: number): Vec3 | null {
  const cell = geometry.hexes[hex];
  return cell ? [cell.cx / geometry.scale, y, cell.cy / geometry.scale] : null;
}

/** Height of a hex surface: tiles sit at 0, open water at sea level. */
export function hexHeight(geometry: BoardGeometry, hex: number): number {
  return geometry.land[hex] === false ? SEA_LEVEL : 0;
}

export interface EpShipPlacement extends InstanceTransform {
  id: string;
  playerId: string;
  cargo: EpCargo[];
}

/** Ships sharing a path sit side by side across it. */
export function epShipPlacements(geometry: BoardGeometry, view: EpView, scale: number): EpShipPlacement[] {
  const byEdge = new Map<number, string[]>();
  for (const ship of view.ships) byEdge.set(ship.edge, [...(byEdge.get(ship.edge) ?? []), ship.id]);
  return view.ships.flatMap((ship) => {
    const transform = shipTransform(geometry, ship.edge);
    if (!transform) return [];
    const group = byEdge.get(ship.edge) ?? [ship.id];
    const slot = group.indexOf(ship.id);
    const offset = group.length > 1 ? (slot === 0 ? -0.12 : 0.12) : 0;
    // Perpendicular to the keel (rotationY turns +X towards the edge direction).
    const nx = Math.sin(transform.rotationY);
    const nz = Math.cos(transform.rotationY);
    const [x, y, z] = transform.position;
    return [{
      id: ship.id,
      playerId: ship.player,
      cargo: ship.cargo.slice(),
      position: [x + nx * offset, y, z + nz * offset] as Vec3,
      rotationY: transform.rotationY,
      scale: [scale, scale, scale] as Vec3,
    }];
  });
}
