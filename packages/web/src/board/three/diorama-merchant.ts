/**
 * The Cities & Knights merchant for the 3D board: a cloaked trader with a
 * wide-brimmed hat and a pack, on a round base in the owner's colour with a
 * gold point coin. Procedural geometry in the style of `diorama-knights.ts`;
 * nothing is traced from official artwork.
 */

import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, SphereGeometry, type BufferGeometry } from 'three';
import type { BoardGeometry } from '../geometry.ts';
import { merchantSpot } from '../citiesKnights.ts';
import { ModelBuilder } from './diorama-geometry.ts';
import type { Vec3 } from './transforms.ts';

const SKIN = '#e9c9a3';
const HAT = '#5b3a22';
const PACK = '#a8743f';
const GOLD = '#e2b33c';

function tint(color: string, amount: number): string {
  return `#${new Color(color).lerp(new Color(amount > 0 ? '#fff0ce' : '#212e32'), Math.abs(amount)).getHexString()}`;
}

/** The merchant at 1:1; the base is 0.3 wide like a knight's. */
export function createMerchantModel(color: string, seat: number): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.15, 0.16, 0.035, 18), tint(color, -0.3), [0, 0.018, 0]);
  model.add(new CylinderGeometry(0.135, 0.135, 0.008, 18), color, [0, 0.039, 0]);
  // Cloak, head, hat brim and crown.
  model.add(new ConeGeometry(0.085, 0.26, 10), color, [0, 0.17, 0]);
  model.add(new SphereGeometry(0.045, 10, 8), SKIN, [0, 0.33, 0]);
  model.add(new CylinderGeometry(0.095, 0.095, 0.012, 14), HAT, [0, 0.365, 0]);
  model.add(new CylinderGeometry(0.04, 0.05, 0.05, 10), tint(HAT, -0.2), [0, 0.395, 0]);
  // Pack on the back and a walking staff.
  model.add(new BoxGeometry(0.08, 0.1, 0.06), PACK, [0, 0.22, -0.07]);
  model.add(new CylinderGeometry(0.007, 0.007, 0.36, 5), '#6b442c', [0.08, 0.2, 0.03]);
  // The point coin on the rim.
  model.add(new CylinderGeometry(0.04, 0.04, 0.012, 14), GOLD, [0.1, 0.05, 0.08] as Vec3);
  const count = 1 + ((Math.trunc(seat) % 6) + 6) % 6;
  for (let index = 0; index < count; index++) model.add(new BoxGeometry(0.012, 0.012, 0.006), '#f8e9c9', [-0.05 + index * 0.02, 0.026, -0.155]);
  return model.build();
}

/** The merchant reads at board scale like the knights. */
export const MERCHANT_SCALE = 1.5;

/** World position of the merchant on a hex (same spot as the SVG board). */
export function merchantPosition(geometry: BoardGeometry, hex: number): Vec3 | null {
  const cell = geometry.hexes[hex];
  if (!cell) return null;
  const spot = merchantSpot(cell);
  return [spot.x / geometry.scale, 0.005, spot.y / geometry.scale];
}
