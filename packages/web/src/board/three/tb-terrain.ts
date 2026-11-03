import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry } from 'three';
import type { ModelBuilder } from './diorama-geometry.ts';

/**
 * Procedural miniatures for the Traders & Barbarians hexes (lake, swamp,
 * watering hole, castle, quarry, glassworks, commodity castle). Same units as
 * `diorama-terrain.ts`: hex radius 1, y up from the tile top; the centre is
 * kept low so number tokens and pieces stay readable.
 */

const TAU = Math.PI * 2;

function disc(b: ModelBuilder, color: string, x: number, z: number, rx: number, rz: number, y = 0.004, h = 0.006) {
  b.add(new CylinderGeometry(1, 1, h, 18), color, [x, y, z], [rx, 1, rz]);
}

function reeds(b: ModelBuilder, x: number, z: number, count: number, seed: number) {
  for (let index = 0; index < count; index++) {
    const angle = seed + index * 2.1;
    const rx = x + Math.cos(angle) * 0.03 * (index % 3);
    const rz = z + Math.sin(angle) * 0.03 * (index % 2);
    const height = 0.07 + (index % 3) * 0.02;
    b.add(new CylinderGeometry(0.004, 0.005, height, 4), '#6f8d45', [rx, height / 2, rz]);
    b.add(new CylinderGeometry(0.007, 0.007, 0.022, 5), '#7b5a34', [rx, height - 0.01, rz]);
  }
}

function boat(b: ModelBuilder, x: number, z: number, yaw: number) {
  b.add(new BoxGeometry(0.11, 0.022, 0.045), '#7a5032', [x, 0.016, z], [1, 1, 1], [0, yaw, 0]);
  b.add(new BoxGeometry(0.004, 0.06, 0.004), '#5b3b22', [x, 0.05, z]);
}

function tower(b: ModelBuilder, x: number, z: number, height: number, radius = 0.045) {
  b.add(new CylinderGeometry(radius, radius * 1.08, height, 8), '#aaa395', [x, height / 2, z]);
  b.add(new ConeGeometry(radius * 1.3, height * 0.45, 8), '#b5523a', [x, height + height * 0.22, z]);
}

function wall(b: ModelBuilder, x: number, z: number, length: number, yaw: number) {
  b.add(new BoxGeometry(length, 0.08, 0.035), '#b9b2a2', [x, 0.04, z], [1, 1, 1], [0, yaw, 0]);
}

function palm(b: ModelBuilder, x: number, z: number, height: number) {
  b.add(new CylinderGeometry(0.008, 0.012, height, 5), '#8b6e4c', [x, height / 2, z], [1, 1, 1], [0.08, 0, 0.06]);
  for (let frond = 0; frond < 6; frond++) {
    const angle = frond * TAU / 6;
    b.add(new BoxGeometry(0.09, 0.006, 0.022), frond % 2 ? '#5e8f4c' : '#6fa057',
      [x + Math.cos(angle) * 0.04, height, z + Math.sin(angle) * 0.04], [1, 1, 1], [0, -angle, -0.35]);
  }
}

function tent(b: ModelBuilder, x: number, z: number, color: string) {
  b.add(new ConeGeometry(0.06, 0.08, 4), color, [x, 0.04, z], [1, 1, 1], [0, Math.PI / 4, 0]);
}

function house(b: ModelBuilder, x: number, z: number, yaw: number, roof: string) {
  b.add(new BoxGeometry(0.12, 0.07, 0.09), '#d9c49a', [x, 0.035, z], [1, 1, 1], [0, yaw, 0]);
  b.add(new ConeGeometry(0.095, 0.06, 4), roof, [x, 0.1, z], [1, 1, 0.8], [0, yaw + Math.PI / 4, 0]);
}

function marble(b: ModelBuilder, x: number, z: number, size: number) {
  b.add(new BoxGeometry(size, size * 0.7, size * 0.8), '#f1eee6', [x, size * 0.35, z], [1, 1, 1], [0, x * 7, 0]);
}

function lake(b: ModelBuilder) {
  disc(b, '#3d8eb4', 0, 0, 0.62, 0.5);
  disc(b, '#5aa9c9', -0.08, -0.06, 0.38, 0.28, 0.006, 0.006);
  reeds(b, -0.55, 0.32, 6, 0.3);
  reeds(b, 0.5, -0.36, 5, 1.1);
  reeds(b, 0.58, 0.28, 4, 2.4);
  boat(b, 0.24, -0.18, 0.6);
}

function swamp(b: ModelBuilder) {
  const pools: [number, number, number, number][] = [[-0.36, -0.2, 0.2, 0.14], [0.22, 0.34, 0.24, 0.12], [0.4, -0.3, 0.16, 0.1], [-0.2, 0.42, 0.12, 0.08]];
  for (const [x, z, rx, rz] of pools) disc(b, '#4f8ea3', x, z, rx, rz);
  reeds(b, -0.52, 0.1, 6, 0.7);
  reeds(b, 0.02, -0.5, 5, 1.6);
  reeds(b, 0.56, 0.08, 6, 2.2);
  for (let tuft = 0; tuft < 8; tuft++) {
    const angle = tuft * TAU / 8 + 0.3;
    b.add(new IcosahedronGeometry(0.03, 0), '#5a7d3c', [Math.cos(angle) * 0.55, 0.015, Math.sin(angle) * 0.5], [1, 0.5, 1]);
  }
}

function oasis(b: ModelBuilder) {
  disc(b, '#c9ad78', 0.05, -0.05, 0.42, 0.34);
  disc(b, '#3d9cc0', 0.05, -0.05, 0.34, 0.27, 0.007);
  palm(b, -0.42, -0.3, 0.26);
  palm(b, 0.48, -0.36, 0.22);
  palm(b, -0.5, 0.36, 0.24);
  tent(b, 0.42, 0.4, '#c9502f');
  tent(b, 0.18, 0.55, '#e6c27a');
}

function castle(b: ModelBuilder) {
  for (const [x, z, yaw] of [[0, -0.42, 0], [0, 0.42, 0], [-0.36, 0, Math.PI / 2], [0.36, 0, Math.PI / 2]] as const) wall(b, x, z, 0.72, yaw);
  for (const [x, z] of [[-0.36, -0.42], [0.36, -0.42], [-0.36, 0.42], [0.36, 0.42]] as const) tower(b, x, z, 0.16);
  tower(b, -0.12, -0.18, 0.24, 0.06);
  b.add(new BoxGeometry(0.06, 0.05, 0.02), '#5a3d26', [0, 0.025, 0.44]);
}

function quarry(b: ModelBuilder) {
  disc(b, '#e5e1d6', -0.1, -0.1, 0.4, 0.32);
  disc(b, '#c9c3b5', -0.1, -0.1, 0.28, 0.22, 0.008);
  marble(b, -0.4, 0.3, 0.08);
  marble(b, -0.28, 0.4, 0.06);
  marble(b, 0.42, -0.42, 0.07);
  // Crane: mast, jib and a hanging block.
  b.add(new BoxGeometry(0.018, 0.3, 0.018), '#6d4b31', [0.42, 0.15, 0.22]);
  b.add(new BoxGeometry(0.26, 0.016, 0.016), '#6d4b31', [0.31, 0.3, 0.22]);
  b.add(new BoxGeometry(0.004, 0.1, 0.004), '#3a2a1c', [0.2, 0.25, 0.22]);
  marble(b, 0.2, 0.22, 0.05);
}

function glassworks(b: ModelBuilder) {
  house(b, -0.3, -0.32, 0.2, '#8f4a2f');
  house(b, 0.38, 0.34, -0.4, '#6d8a3c');
  // Furnace with a tall chimney and a stack of glass panes.
  b.add(new CylinderGeometry(0.09, 0.11, 0.1, 10), '#a7643f', [0.3, 0.05, -0.38]);
  b.add(new CylinderGeometry(0.025, 0.03, 0.26, 8), '#7d776c', [0.36, 0.13, -0.44]);
  for (let pane = 0; pane < 3; pane++) {
    b.add(new BoxGeometry(0.07, 0.006, 0.05), pane % 2 ? '#8fd0e8' : '#6fb6d8', [-0.42, 0.006 + pane * 0.008, 0.36]);
  }
}

/** Builds the scenery of a T&B hex; false when the terrain is not one of them. */
export function tbTerrainModel(b: ModelBuilder, terrain: string): boolean {
  switch (terrain) {
    case 'lake': lake(b); return true;
    case 'swamp': swamp(b); return true;
    case 'oasis': oasis(b); return true;
    case 'castle':
    case 'keep': castle(b); return true;
    case 'quarry': quarry(b); return true;
    case 'glassworks': glassworks(b); return true;
    default: return false;
  }
}
