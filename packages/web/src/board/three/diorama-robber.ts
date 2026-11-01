import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { ModelBuilder } from './diorama-geometry.ts';
import type { Vec3 } from './transforms.ts';

const TAU = Math.PI * 2;
const CLOAK = '#36444a';
const CLOAK_EDGE = '#4a5a60';
const SHADOW = '#182024';
const SKIN = '#bd9977';
const LEATHER = '#855f3d';

/**
 * A closed solid of revolution from a bottom-to-top (radius, y) profile.
 * `fold` scales the radius by height and angle, for draped cloth.
 */
function lathe(
  profile: readonly (readonly [number, number])[],
  sides: number,
  fold: (y: number, angle: number) => number = () => 1,
): BufferGeometry {
  const rings = profile.map(([radius, y]) => Array.from({ length: sides }, (_, index): Vec3 => {
    const angle = index / sides * TAU;
    const r = radius * fold(y, angle);
    return [Math.sin(angle) * r, y, Math.cos(angle) * r];
  }));
  const positions: number[] = [];
  for (let level = 0; level < rings.length - 1; level++) {
    const lower = rings[level]!;
    const upper = rings[level + 1]!;
    for (let index = 0; index < sides; index++) {
      const next = (index + 1) % sides;
      if (profile[level]![0] > 0) positions.push(...lower[index]!, ...lower[next]!, ...upper[index]!);
      if (profile[level + 1]![0] > 0) positions.push(...lower[next]!, ...upper[next]!, ...upper[index]!);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A tapered limb between two points. */
function limb(model: ModelBuilder, from: Vec3, to: Vec3, radius: number, tip: number, color: string) {
  const start = new Vector3(...from);
  const direction = new Vector3(...to).sub(start);
  const geometry = lathe([[0, 0], [radius, 0], [tip, direction.length()], [0, direction.length()]], 7);
  geometry.translate(0, -direction.length() / 2, 0);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()));
  model.add(geometry, color, start.addScaledVector(direction, 0.5).toArray() as Vec3);
}

/** A hooded bandit in a draped cloak, with a scarf, a loot sack, a dagger and a lantern. */
export function createRobberModel(): BufferGeometry {
  const model = new ModelBuilder();
  // A bevelled slate plinth keeps the figure readable on any terrain.
  model.add(lathe([[0, 0], [0.17, 0], [0.176, 0.014], [0.166, 0.03], [0, 0.03]], 18), '#454d50');
  // Deep folds fade out toward the shoulders.
  const drape = (y: number, angle: number) => 1 + Math.max(0, 0.5 - y) * 0.2 * Math.cos(angle * 7);
  model.add(lathe([
    [0, 0.03], [0.168, 0.03], [0.158, 0.12], [0.138, 0.25], [0.12, 0.36], [0.118, 0.44],
    [0.14, 0.5], [0.128, 0.56], [0.08, 0.6], [0, 0.61],
  ], 21, drape), CLOAK);
  // A paler hem picks the silhouette off dark ground.
  model.add(lathe([[0, 0.03], [0.172, 0.03], [0.17, 0.055], [0, 0.055]], 21, drape), CLOAK_EDGE);
  model.add(lathe([[0, 0.405], [0.124, 0.405], [0.124, 0.435], [0, 0.435]], 14), LEATHER);
  model.add(new BoxGeometry(0.04, 0.034, 0.012), '#c4a05d', [0, 0.42, 0.124]);
  model.add(new BoxGeometry(0.018, 0.016, 0.014), SHADOW, [0, 0.42, 0.128]);
  model.add(new TorusGeometry(0.098, 0.022, 5, 12), '#8a3a2e', [0, 0.585, 0.004], [1, 1, 1], [Math.PI / 2, 0, 0]);
  model.add(new BoxGeometry(0.04, 0.09, 0.016), '#7a3229', [0.04, 0.53, 0.105], [1, 1, 1], [0.15, 0, -0.12]);

  // Peaked hood, tilted slightly back, with a shadowed opening.
  const hood = lathe([
    [0, 0.555], [0.1, 0.56], [0.132, 0.62], [0.136, 0.69], [0.122, 0.755], [0.088, 0.8], [0.048, 0.835], [0.018, 0.88], [0, 0.915],
  ], 16);
  // The pointed crown slumps backward so the opening faces forward and slightly up.
  hood.translate(0, -0.62, 0).rotateX(-0.38).translate(0, 0.625, -0.004);
  model.add(hood, CLOAK);
  model.add(new SphereGeometry(1, 10, 6), SHADOW, [0, 0.725, 0.075], [0.074, 0.086, 0.05]);
  model.add(new SphereGeometry(1, 8, 5), SKIN, [0, 0.718, 0.088], [0.054, 0.064, 0.04]);
  model.add(new IcosahedronGeometry(1, 0), '#c9a785', [0, 0.712, 0.128], [0.014, 0.02, 0.014]);
  model.add(new BoxGeometry(0.118, 0.028, 0.02), '#1e2e34', [0, 0.745, 0.118]);
  for (const x of [-0.026, 0.026]) {
    model.add(new BoxGeometry(0.02, 0.011, 0.008), '#ece2c6', [x, 0.747, 0.129]);
    model.add(new BoxGeometry(0.007, 0.011, 0.009), '#1e2e34', [x + 0.002, 0.747, 0.131]);
  }
  model.add(new TorusGeometry(0.078, 0.014, 4, 12, Math.PI), CLOAK_EDGE, [0, 0.69, 0.098], [1, 1.25, 1]);

  // Sleeves bend at the elbow; both hands carry something.
  for (const side of [-1, 1]) {
    const shoulder: Vec3 = [side * 0.12, 0.53, 0];
    const elbow: Vec3 = [side * 0.158, 0.42, 0.045];
    const wrist: Vec3 = [side * 0.13, 0.36, 0.12];
    limb(model, shoulder, elbow, 0.05, 0.042, CLOAK);
    limb(model, elbow, wrist, 0.042, 0.036, CLOAK);
    model.add(new IcosahedronGeometry(1, 0), CLOAK_EDGE, wrist, [0.038, 0.03, 0.038]);
    model.add(new IcosahedronGeometry(0.03, 0), SKIN, [wrist[0], wrist[1] - 0.025, wrist[2] + 0.012]);
  }
  // A short dagger held point-down in the right hand.
  model.add(new BoxGeometry(0.012, 0.03, 0.012), LEATHER, [0.13, 0.33, 0.135]);
  model.add(new BoxGeometry(0.04, 0.008, 0.014), '#c4a05d', [0.13, 0.312, 0.135]);
  model.add(new BoxGeometry(0.016, 0.085, 0.005), '#cdd5d8', [0.13, 0.264, 0.135]);
  // A small lantern swings from the left hand.
  limb(model, [-0.13, 0.32, 0.135], [-0.13, 0.27, 0.135], 0.003, 0.003, '#2b3133');
  model.add(new BoxGeometry(0.044, 0.008, 0.044), '#2b3133', [-0.13, 0.268, 0.135]);
  model.add(new BoxGeometry(0.034, 0.05, 0.034), '#ffd27a', [-0.13, 0.238, 0.135]);
  model.add(new BoxGeometry(0.046, 0.008, 0.046), '#2b3133', [-0.13, 0.209, 0.135]);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    model.add(new BoxGeometry(0.005, 0.05, 0.005), '#2b3133', [-0.13 + x * 0.018, 0.238, 0.135 + z * 0.018]);
  }

  // The loot sack slung over the left shoulder, tied off with a gold coin peeking out.
  model.add(new IcosahedronGeometry(1, 1), '#a18a5d', [-0.07, 0.5, -0.14], [0.1, 0.12, 0.085], [0.2, 0.4, 0.15]);
  model.add(lathe([[0, 0], [0.03, 0], [0.022, 0.05], [0.032, 0.07], [0, 0.075]], 7), '#8d7650', [-0.11, 0.6, -0.12], [1, 1, 1], [0, 0, 0.5]);
  model.add(new TorusGeometry(0.024, 0.006, 3, 8), '#5e4a33', [-0.122, 0.62, -0.12], [1, 1, 1], [Math.PI / 2, 0, 0.5]);
  model.add(new BoxGeometry(0.03, 0.006, 0.03), '#e3c062', [-0.01, 0.57, -0.08], [1, 1, 1], [0.6, 0.4, 0]);
  return model.build();
}
