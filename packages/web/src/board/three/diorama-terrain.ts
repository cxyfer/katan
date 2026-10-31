import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { ModelBuilder, PaintedMesh, sceneryRandom } from './diorama-geometry.ts';
import type { Vec3 } from './transforms.ts';

const TAU = Math.PI * 2;
const greens = ['#426b51', '#577b58', '#6c8b61', '#385c4a'];
const stone = ['#8c9290', '#a5aaa1', '#777f80', '#b7b7a9'];

/** Closed radial solids triangulate each cap without a redundant center fan. */
function radialSolid(topRadius: number, bottomRadius: number, height: number, sides: number): BufferGeometry {
  const vertices: number[] = [];
  const ring = (radius: number, y: number): Vec3[] => Array.from({ length: sides }, (_, index) => [
    Math.sin(index / sides * TAU) * radius, y, Math.cos(index / sides * TAU) * radius,
  ]);
  const top = ring(topRadius, height / 2);
  const bottom = ring(bottomRadius, -height / 2);
  const face = (a: Vec3, b: Vec3, c: Vec3) => vertices.push(...a, ...b, ...c);
  for (let index = 0; index < sides; index++) {
    const next = (index + 1) % sides;
    face(bottom[index]!, bottom[next]!, top[index]!);
    if (topRadius > 0) face(bottom[next]!, top[next]!, top[index]!);
  }
  for (let index = 1; index < sides - 1; index++) {
    face(bottom[0]!, bottom[index + 1]!, bottom[index]!);
    if (topRadius > 0) face(top[0]!, top[index]!, top[index + 1]!);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A six-face grain keeps pointed tips and a full three-dimensional cross section. */
function grainGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const vertices: number[] = [];
  const ring: Vec3[] = [[0, 0, 1], [1, 0, -0.5], [-1, 0, -0.5]];
  for (let side = 0; side < 3; side++) {
    const a = ring[side]!;
    const b = ring[(side + 1) % 3]!;
    vertices.push(...a, ...b, 0, 1, 0, ...b, ...a, 0, -1, 0);
  }
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function box(b: ModelBuilder, color: string, at: Vec3, size: Vec3, rotation: Vec3 = [0, 0, 0]) {
  b.add(new BoxGeometry(1, 1, 1), color, at, size, rotation);
}

function pebble(b: ModelBuilder, color: string, x: number, z: number, r: number, height = r * 1.25) {
  b.add(new IcosahedronGeometry(1, 0), color, [x, height * 0.48, z], [r, height * 0.5, r * 0.8], [0, x * 5, 0]);
}

/** Place an intact miniature with translation/yaw only; its dimensions stay native. */
function rigidGroup(b: ModelBuilder, x: number, z: number, yaw: number, draw: (group: ModelBuilder) => void) {
  const groupRotation = new Matrix4().makeRotationY(yaw);
  const group = new class extends ModelBuilder {
    override add(source: BufferGeometry, color: string, position: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1], rotation: Vec3 = [0, 0, 0]): this {
      source.applyMatrix4(groupRotation.clone().multiply(new Matrix4().compose(
        new Vector3(...position), new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...scale),
      )));
      b.add(source, color, [x, 0, z]);
      return this;
    }
  }();
  draw(group);
}

/** Low closed turf/dune banks follow the well instead of covering its centre. */
function crescentPatch(b: ModelBuilder, color: string, start: number, end: number, height: number, inner = 0.34, outer = 0.67) {
  const vertices: number[] = [];
  const segments = 8;
  const point = (step: number, radius: number, y: number): Vec3 => {
    const angle = start + (end - start) * step / segments;
    return [Math.sin(angle) * radius, y, -Math.cos(angle) * radius];
  };
  const face = (a: Vec3, c: Vec3, d: Vec3) => vertices.push(...a, ...d, ...c);
  for (let segment = 0; segment < segments; segment++) {
    const a = point(segment, inner, 0);
    const c = point(segment + 1, inner, 0);
    const d = point(segment, outer, 0);
    const e = point(segment + 1, outer, 0);
    const peakA = point(segment, (inner + outer) / 2, height);
    const peakB = point(segment + 1, (inner + outer) / 2, height);
    face(a, peakA, c); face(c, peakA, peakB);
    face(peakA, d, peakB); face(peakB, d, e);
    face(a, c, d); face(d, c, e);
    if (segment === 0) face(a, d, peakA);
    if (segment === segments - 1) face(c, peakB, e);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  b.add(geometry, color);
}

function branch(b: ModelBuilder, from: Vec3, to: Vec3, radius: number, color: string, sides = 5, pointed = false) {
  const a = new Vector3(...from);
  const direction = new Vector3(...to).sub(a);
  const geometry = radialSolid(pointed ? 0 : radius * 0.75, radius, direction.length(), sides);
  // Bake an arbitrary branch direction before handing geometry ownership over.
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()));
  geometry.computeBoundingBox();
  const center = a.addScaledVector(direction, 0.5);
  center.y = Math.max(center.y, -geometry.boundingBox!.min.y);
  b.add(geometry, color, center.toArray() as [number, number, number]);
}

function conifer(b: ModelBuilder, x: number, z: number, size: number, tint: number) {
  const h = 0.39 * size;
  b.add(radialSolid(0.014, 0.023, h * 0.7, 5), '#80674b', [x, h * 0.35, z]);
  for (let layer = 0; layer < 4; layer++) {
    const y = h * (0.36 + layer * 0.155);
    const r = (0.115 - layer * 0.023) * size;
    b.add(radialSolid(0, r, h * 0.43, 6), greens[(tint + layer) % greens.length]!, [x, y, z], [1, 1, 0.9], [0, layer * 0.55 + tint, 0]);
    if (layer < 2) {
      for (let limb = 0; limb < 3; limb++) {
        const angle = limb * TAU / 3 + tint;
        branch(b, [x, y - 0.035, z], [x + Math.cos(angle) * r * 0.86, y - 0.025, z + Math.sin(angle) * r * 0.86], 0.007, '#715b43', 3, true);
      }
    }
  }
}

function forest(b: ModelBuilder, random: () => number, variant: number) {
  crescentPatch(b, '#78976a', -1.8, -0.06, 0.035);
  crescentPatch(b, '#8ba276', 0.06, 1.8, 0.035);
  const positions = [
    [-0.59, 0], [-0.52, -0.3], [-0.3, -0.52], [0, -0.61], [0.3, -0.52], [0.52, -0.3], [0.59, 0],
    [-0.45, -0.04], [-0.225, -0.39], [0.225, -0.39], [0.45, -0.04],
  ];
  positions.forEach(([x, z], index) => conifer(b, x!, z!, 0.78 + random() * 0.38, index + variant));
  // Round, branching deciduous trees break up the needle-tree silhouette.
  for (const [x, z] of [[-0.42, 0.24], [0.42, 0.24]]) {
    branch(b, [x!, 0, z!], [x! + 0.018, 0.23, z!], 0.018, '#8b7053');
    for (let crown = 0; crown < 4; crown++) {
      const angle = crown * 2.2;
      const dx = Math.cos(angle) * 0.045;
      const dz = Math.sin(angle) * 0.045;
      branch(b, [x!, 0.12, z!], [x! + dx, 0.23, z! + dz], 0.009, '#8b7053', 3, true);
      b.add(new IcosahedronGeometry(1, 0), ['#8ba36b', '#9bb77b', '#719564', '#a8bc80'][crown]!, [x! + dx, 0.25 + random() * 0.035, z! + dz], [0.072, 0.078, 0.068]);
    }
  }
  branch(b, [-0.54, 0.032, 0.43], [-0.36, 0.032, 0.38], 0.025, '#8f7250', 7);
  b.add(new CylinderGeometry(0.019, 0.019, 0.004, 7), '#d0b184', [-0.54, 0.032, 0.43], [1, 1, 1], [0, 0, Math.PI / 2]);
  for (const [x, z] of [[0.56, 0.32], [-0.61, 0.14], [0.5, -0.4], [-0.08, -0.71]]) pebble(b, '#a5ae95', x!, z!, 0.035);
}

/** Keep every footprint vertex out of the token well and the shared building lanes. */
function clampFootprint(x: number, z: number): [number, number] {
  const radius = Math.hypot(x, z);
  // Chords between two clamped corners still clear the 0.3 token well.
  if (radius < 0.335) {
    const scale = 0.335 / (radius || 1);
    x *= scale; z *= scale;
  }
  const sideLimit = Math.sqrt(3) * 0.86 / 2 - 0.002;
  x = Math.max(-sideLimit, Math.min(sideLimit, x));
  const diagonal = Math.abs(z) + Math.abs(x) / Math.sqrt(3);
  if (diagonal > 0.858) z = Math.sign(z) * Math.max(0, 0.858 - Math.abs(x) / Math.sqrt(3));
  return [x, z];
}

interface MassOptions {
  x: number; z: number; rx: number; rz: number; height: number; seed: number;
  /** Ring heights in 0..1; the last level is the crest. */
  levels: readonly number[];
  /** Radius multiplier per level; zero closes the crest at a single peak. */
  profile: (t: number) => number;
  /** Paint for a face whose centroid sits at relative height t. */
  paint: (t: number, face: number, random: () => number) => string;
  sides?: number;
  jitter?: number;
}

/** A closed faceted lathe with jittered rings, painted face by face by height. */
function rockMass(mesh: PaintedMesh, options: MassOptions) {
  const random = sceneryRandom(options.seed);
  const sides = options.sides ?? 9;
  const jitter = options.jitter ?? 0.26;
  const phase = random() * TAU;
  const rings = options.levels.map((t, level) => {
    const scale = options.profile(t);
    const y = level === 0 ? 0 : options.height * t * (0.95 + random() * 0.08);
    return Array.from({ length: sides }, (_, index) => {
      const angle = phase + (index + (random() - 0.5) * 0.35) / sides * TAU;
      const wobble = 1 - jitter / 2 + random() * jitter;
      const [x, z] = clampFootprint(
        options.x + Math.sin(angle) * options.rx * scale * wobble,
        options.z + Math.cos(angle) * options.rz * scale * wobble,
      );
      return [x, Math.min(y, 0.8), z] as Vec3;
    });
  });
  const center: Vec3 = [options.x, options.height * 0.4, options.z];
  let face = 0;
  const outward = (a: Vec3, b: Vec3, c: Vec3, t: number) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (a[0] + b[0] + c[0]) / 3 - center[0];
    const cy = (a[1] + b[1] + c[1]) / 3 - center[1];
    const cz = (a[2] + b[2] + c[2]) / 3 - center[2];
    const color = options.paint(t, face++, random);
    if (nx * cx + ny * cy + nz * cz >= 0) mesh.face(a, b, c, color);
    else mesh.face(a, c, b, color);
  };
  const pointed = options.profile(options.levels.at(-1)!) === 0;
  for (let level = 0; level < rings.length - 1; level++) {
    const lower = rings[level]!;
    const upper = rings[level + 1]!;
    const t = (options.levels[level]! + options.levels[level + 1]!) / 2;
    // A crest of zero radius is a single peak, so its second triangle would be a sliver.
    const peak = pointed && level === rings.length - 2;
    for (let index = 0; index < sides; index++) {
      const next = (index + 1) % sides;
      outward(lower[index]!, lower[next]!, upper[index]!, t);
      if (!peak) outward(lower[next]!, upper[next]!, upper[index]!, t + 0.04);
    }
  }
  if (!pointed) {
    const crest = rings.at(-1)!;
    const apex: Vec3 = [options.x, Math.max(...crest.map((point) => point[1])) + options.height * 0.02, options.z];
    for (let index = 0; index < sides; index++) outward(crest[index]!, crest[(index + 1) % sides]!, apex, 1);
  }
  const base = rings[0]!;
  const floor: Vec3 = [options.x, 0, options.z];
  for (let index = 0; index < sides; index++) {
    const a = base[index]!;
    const b = base[(index + 1) % sides]!;
    // The floor faces down regardless of jitter.
    const ny = (b[2] - a[2]) * (floor[0] - a[0]) - (b[0] - a[0]) * (floor[2] - a[2]);
    const color = options.paint(0, face++, random);
    if (ny <= 0) mesh.face(a, b, floor, color); else mesh.face(a, floor, b, color);
  }
}

const ROCK = ['#7d8784', '#6b7574', '#8f9893', '#5f6a6b', '#99a09a'];
const SCREE = ['#8b8d80', '#9c9b8b', '#7c8077'];
const SNOW = ['#f3f2ea', '#e2e7e2', '#fbf8ef'];

function peakPaint(snowline: number, gold: boolean) {
  return (t: number, face: number, random: () => number) => {
    const ragged = snowline + (random() - 0.5) * 0.14;
    if (t > ragged) return SNOW[face % SNOW.length]!;
    if (gold && t > 0.22 && t < 0.5 && random() < 0.28) return ['#d8b34f', '#c79a3c'][face % 2]!;
    if (t < 0.2) return SCREE[face % SCREE.length]!;
    return ROCK[Math.floor(random() * ROCK.length)]!;
  };
}

function mountains(b: ModelBuilder, random: () => number, variant: number, gold = false) {
  const mesh = new PaintedMesh();
  const peaks = [
    { x: 0.02, z: -0.53, rx: 0.33, rz: 0.27, h: 0.77 + variant * 0.012, snow: 0.6 },
    { x: -0.46, z: -0.3, rx: 0.27, rz: 0.22, h: 0.57, snow: 0.66 },
    { x: 0.48, z: -0.25, rx: 0.22, rz: 0.19, h: 0.44, snow: 0.74 },
    { x: -0.55, z: 0.13, rx: 0.15, rz: 0.13, h: 0.3, snow: 2 },
  ];
  peaks.forEach((peak, index) => rockMass(mesh, {
    x: peak.x, z: peak.z, rx: peak.rx, rz: peak.rz, height: peak.h, seed: variant * 31 + index * 7 + 5,
    levels: [0, 0.18, 0.4, 0.62, 0.82, 1], profile: (t) => t >= 1 ? 0 : Math.pow(1 - t, 0.85),
    paint: peakPaint(peak.snow, gold), sides: 9,
  }));
  b.addPainted(mesh.geometry());
  // Loose scree, hardy pines and gold ore around the foot of the range.
  for (let index = 0; index < 18; index++) {
    const angle = -1.85 + index * 3.7 / 17;
    const radius = 0.4 + random() * 0.08;
    pebble(b, gold && index % 3 === 0 ? '#d6b356' : stone[index % stone.length]!, Math.sin(angle) * radius, -Math.cos(angle) * radius, 0.016 + random() * 0.022);
  }
  for (const [x, z, size] of [[0.58, 0.1, 0.55], [0.47, 0.3, 0.48], [-0.33, 0.47, 0.5]] as const) {
    alpinePine(b, x, z, size, variant);
  }
  if (gold) {
    for (const [x, z] of [[-0.49, 0.3], [0.36, -0.02], [0.2, 0.52]]) {
      pebble(b, '#caa24c', x!, z!, 0.07, 0.08);
      pebble(b, '#ebcd6e', x! - 0.026, z! + 0.022, 0.04, 0.06);
    }
  }
}

/** A small dark pine for highland slopes; distinct paint from the forest tile. */
function alpinePine(b: ModelBuilder, x: number, z: number, size: number, variant: number) {
  const h = 0.36 * size;
  b.add(radialSolid(0.012, 0.018, h * 0.4, 5), '#6f5a44', [x, h * 0.2, z]);
  for (let layer = 0; layer < 3; layer++) {
    b.add(radialSolid(0, (0.1 - layer * 0.022) * size, h * 0.5, 6), ['#33564a', '#3d6352', '#2c4c41'][(layer + variant) % 3]!,
      [x, h * (0.42 + layer * 0.2), z], [1, 1, 1], [0, layer * 0.7, 0]);
  }
}

const CLAY = ['#b4684a', '#c98260', '#a65b3f', '#d39a72', '#bb7354'];

function clayPaint(grassTop: number) {
  return (t: number, face: number, random: () => number) => {
    if (t > grassTop) return ['#97a862', '#a8b56d', '#8a9c5a'][face % 3]!;
    // Horizontal strata: the band index follows height, with a little wobble.
    const band = Math.floor((t + (random() - 0.5) * 0.05) * 6);
    return CLAY[((band % CLAY.length) + CLAY.length) % CLAY.length]!;
  };
}

function kiln(b: ModelBuilder, x: number, z: number) {
  b.add(radialSolid(0.08, 0.092, 0.09, 8), '#9c5a3c', [x, 0.045, z]);
  b.add(new SphereGeometry(0.082, 8, 4, 0, TAU, 0, Math.PI / 2), '#b86a48', [x, 0.09, z], [1, 0.85, 1]);
  box(b, '#7a4a35', [x + 0.03, 0.2, z - 0.03], [0.036, 0.11, 0.036]);
  box(b, '#5e3a2b', [x + 0.03, 0.258, z - 0.03], [0.044, 0.012, 0.044]);
  box(b, '#3b2a22', [x, 0.05, z + 0.083], [0.05, 0.06, 0.012]);
  box(b, '#d39a72', [x, 0.084, z + 0.087], [0.064, 0.012, 0.014]);
  // A wisp of smoke rising from the chimney.
  b.add(new IcosahedronGeometry(1, 0), '#ebe5da', [x + 0.035, 0.31, z - 0.035], [0.026, 0.02, 0.024]);
  b.add(new IcosahedronGeometry(1, 0), '#f3eee5', [x + 0.05, 0.355, z - 0.045], [0.02, 0.016, 0.019]);
}

function brickStack(b: ModelBuilder, x: number, z: number, levels: number, yaw: number) {
  box(b, '#8a6845', [x, 0.008, z], [0.24, 0.016, 0.1], [0, yaw, 0]);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (let level = 0; level < levels; level++) {
    for (let brick = 0; brick < 4 - level; brick++) {
      const along = -0.09 + brick * 0.062 + level * 0.031;
      box(b, ['#c98262', '#db9a74', '#af7057'][(brick + level) % 3]!,
        [x + cos * along, 0.037 + level * 0.044, z - sin * along], [0.056, 0.04, 0.074], [0, yaw, 0]);
    }
  }
}

function hills(b: ModelBuilder, random: () => number, variant: number) {
  const mesh = new PaintedMesh();
  const mounds = [
    { x: 0.04, z: -0.56, rx: 0.32, rz: 0.24, h: 0.36 },
    { x: -0.47, z: -0.27, rx: 0.23, rz: 0.2, h: 0.25 },
    { x: 0.5, z: -0.24, rx: 0.18, rz: 0.16, h: 0.18 },
  ];
  mounds.forEach((mound, index) => rockMass(mesh, {
    x: mound.x, z: mound.z, rx: mound.rx, rz: mound.rz, height: mound.h, seed: variant * 17 + index * 13 + 3,
    levels: [0, 0.25, 0.5, 0.72, 0.9, 1], profile: (t) => Math.pow(Math.cos(t * Math.PI / 2), 0.7) * 0.82 + 0.18,
    paint: clayPaint(0.86), sides: 10, jitter: 0.18,
  }));
  b.addPainted(mesh.geometry());
  kiln(b, -0.48, 0.24);
  brickStack(b, 0.45, 0.18, 3, 0.25 + variant * 0.08);
  brickStack(b, 0.1, 0.5, 2, 0.12);
  for (let rock = 0; rock < 12; rock++) {
    const angle = -1.5 + rock * 3 / 11;
    const radius = 0.62 + random() * 0.02;
    pebble(b, CLAY[rock % 4]!, Math.sin(angle) * radius, -Math.cos(angle) * radius, 0.022 + random() * 0.018);
  }
  for (const [x, z] of [[-0.2, 0.5], [0.4, 0.42], [-0.62, -0.02]]) {
    for (let leaf = 0; leaf < 3; leaf++) {
      b.add(new IcosahedronGeometry(1, 0), ['#7f8f4e', '#93a35a', '#6f8045'][leaf]!,
        [x! + (leaf - 1) * 0.03, 0.03 + (leaf % 2) * 0.012, z! + (leaf % 2) * 0.02], [0.034, 0.03, 0.03]);
    }
  }
}

function fields(b: ModelBuilder, random: () => number, variant: number) {
  for (let row = 0; row < 7; row++) {
    const angle = (row - 3) * 0.56;
    const inner = 0.36;
    const outer = 0.69;
    const middle = (inner + outer) / 2;
    box(b, '#b59451', [Math.sin(angle) * middle, 0.008, -Math.cos(angle) * middle], [0.094, 0.016, outer - inner], [0, -angle, 0]);
    for (let stalk = 0; stalk < 10; stalk++) {
      const radius = inner + (outer - inner) * (stalk + 0.5) / 10;
      for (let side = 0; side < 2; side++) {
        const offset = (side ? 0.024 : -0.024) + (random() - 0.5) * 0.012;
        const x = Math.sin(angle) * radius + Math.cos(angle) * offset;
        const z = -Math.cos(angle) * radius + Math.sin(angle) * offset;
        const h = 0.092 + random() * 0.045;
        const bend = (random() - 0.5) * 0.016;
        rigidGroup(b, x, z, -angle, group => {
          branch(group, [0, 0.015, 0], [bend, h, 0], 0.003, '#d0ae58', 3, true);
          group.add(grainGeometry(), ['#e7c975', '#edce81', '#d7b45c'][(row + variant) % 3]!, [bend, h + 0.018, 0], [0.01, 0.029, 0.011], [0, 0, -0.16 + side * 0.32]);
          branch(group, [0, h * 0.45, 0], [0.022, h * 0.76, 0.006], 0.002, '#c6ab61', 3, true);
        });
      }
    }
  }
  // Bound sheaves and a little boundary wall read clearly from the board view.
  for (let bundle = 0; bundle < 3; bundle++) {
    const x = -0.19 + bundle * 0.15;
    const z = -0.64;
    b.add(new CylinderGeometry(0.034, 0.05, 0.115, 7), '#dec17a', [x, 0.065, z], [1, 1, 0.8], [0, 0.2, 0.1]);
    b.add(new TorusGeometry(0.031, 0.005, 4, 7), '#9b7951', [x, 0.065, z], [1, 1, 0.8], [Math.PI / 2, 0, 0]);
  }
}

function sheep(b: ModelBuilder, x: number, z: number, rotation: number, size: number) {
  const local = (px: number, y: number, pz: number): Vec3 => [x + (px * Math.cos(rotation) + pz * Math.sin(rotation)) * size, y * size, z + (-px * Math.sin(rotation) + pz * Math.cos(rotation)) * size];
  const part = (geometry: BufferGeometry, color: string, at: Vec3, scale: Vec3) => b.add(geometry, color, local(...at), scale.map(value => value * size) as [number, number, number], [0, rotation, 0]);
  for (const px of [-0.047, 0.047]) for (const pz of [-0.033, 0.033]) part(radialSolid(0.009, 0.01, 0.065, 3), '#675c4e', [px, 0.035, pz], [1, 1, 1]);
  part(new SphereGeometry(1, 8, 4), '#e9e4cf', [0, 0.105, 0], [0.092, 0.065, 0.059]);
  for (let tuft = 0; tuft < 5; tuft++) part(new OctahedronGeometry(1, 0), '#f4eddb', [-0.065 + tuft * 0.028, 0.135, (tuft % 2 ? 1 : -1) * 0.018], [0.035, 0.035, 0.034]);
  part(new IcosahedronGeometry(1, 0), '#665e52', [0.091, 0.115, 0], [0.035, 0.043, 0.031]);
  part(new OctahedronGeometry(1, 0), '#8d8170', [0.086, 0.144, -0.04], [0.026, 0.01, 0.018]);
  part(new OctahedronGeometry(1, 0), '#8d8170', [0.086, 0.144, 0.04], [0.026, 0.01, 0.018]);
  part(radialSolid(0, 1, 2, 3), '#262f2c', [0.112, 0.126, 0.023], [0.005, 0.005, 0.005]);
  part(new OctahedronGeometry(1, 0), '#e9e4cf', [-0.09, 0.12, 0], [0.025, 0.026, 0.023]);
}

function pasture(b: ModelBuilder, random: () => number, variant: number) {
  crescentPatch(b, '#8da679', -1.95, -0.04, 0.065);
  crescentPatch(b, '#a6ba84', 0.04, 1.95, 0.06);
  for (const [index, [x, z]] of [[-0.48, -0.24], [-0.18, -0.53], [0.23, -0.5], [0.49, -0.1], [-0.45, 0.25]].entries()) sheep(b, x!, z!, -0.6 + index * 0.65 + variant * 0.15, 0.85 + random() * 0.2);
  for (let post = 0; post < 5; post++) box(b, '#a58a61', [-0.43 + post * 0.22, 0.095, -0.57], [0.025, 0.186, 0.026], [0, 0, post % 2 ? 0.06 : -0.04]);
  for (let rail = 0; rail < 4; rail++) {
    branch(b, [-0.43 + rail * 0.22, 0.075, -0.57], [-0.21 + rail * 0.22, 0.105, -0.57], 0.009, '#b89d72');
    branch(b, [-0.43 + rail * 0.22, 0.14, -0.57], [-0.21 + rail * 0.22, 0.15, -0.57], 0.009, '#c3ab7e');
  }
  for (let flower = 0; flower < 24; flower++) {
    const side = flower % 2 ? 1 : -1;
    const x = side * (0.32 + random() * 0.22);
    const z = -0.02 + random() * 0.24;
    branch(b, [x, 0.01, z], [x, 0.04, z], 0.0025, '#739369', 3, true);
    b.add(new OctahedronGeometry(0.011, 0), flower % 3 ? '#eee5b4' : '#cda09d', [x, 0.043, z]);
  }
}

function desert(b: ModelBuilder, random: () => number, variant: number) {
  crescentPatch(b, '#d9c395', -1.65, -0.28, 0.13);
  crescentPatch(b, '#e7d5a7', -0.12, 1.05, 0.16, 0.36, 0.7);
  crescentPatch(b, '#d0b888', 1.18, 2.05, 0.075, 0.35, 0.65);
  for (let ridgeIndex = 0; ridgeIndex < 4; ridgeIndex++) branch(b, [-0.25 + ridgeIndex * 0.06, 0.045 + ridgeIndex * 0.018, -0.44 - ridgeIndex * 0.04], [0.09 + ridgeIndex * 0.035, 0.09, -0.52 - ridgeIndex * 0.03], 0.008, '#eee0b8', 5);
  const cactusX = variant % 2 ? -0.5 : 0.5;
  const cactusZ = -0.28;
  branch(b, [cactusX, 0, cactusZ], [cactusX, 0.3, cactusZ], 0.027, '#7b9b77', 7);
  branch(b, [cactusX, 0.12, cactusZ], [cactusX - 0.07, 0.12, cactusZ], 0.018, '#78956e', 6);
  branch(b, [cactusX - 0.07, 0.12, cactusZ], [cactusX - 0.07, 0.23, cactusZ], 0.018, '#8ca57b', 6);
  branch(b, [cactusX, 0.18, cactusZ], [cactusX + 0.055, 0.18, cactusZ], 0.016, '#78956e', 6);
  branch(b, [cactusX + 0.055, 0.18, cactusZ], [cactusX + 0.055, 0.25, cactusZ], 0.016, '#8ca57b', 6);
  // A bleached spine with paired ribs gives the desert a distinct story.
  branch(b, [-0.56, 0.022, 0.22], [-0.38, 0.022, 0.18], 0.009, '#eee5c8');
  for (let rib = 0; rib < 4; rib++) {
    const x = -0.53 + rib * 0.038;
    branch(b, [x, 0.022, 0.21], [x - 0.012, 0.035, 0.26], 0.005, '#eee5c8');
    branch(b, [x, 0.022, 0.21], [x - 0.018, 0.035, 0.155], 0.005, '#eee5c8');
  }
  for (let rock = 0; rock < 10; rock++) pebble(b, rock % 2 ? '#b8a989' : '#c4b699', -0.55 + random() * 1.1, -0.51 + random() * 0.13, 0.018 + random() * 0.018);
  // Wind-cut sandstone: a banded flat-topped butte and a slender spire beside it.
  const sandstone = (t: number, face: number) => t > 0.97 ? ['#e6bf8c', '#dcb27e'][face % 2]!
    : ['#c98b5c', '#dba274', '#bf7d52', '#e2b384'][Math.floor(t * 5) % 4]!;
  const mesh = new PaintedMesh();
  rockMass(mesh, { x: -cactusX * 0.86, z: -0.36, rx: 0.16, rz: 0.13, height: 0.27, seed: 71 + variant,
    levels: [0, 0.3, 0.62, 0.9, 1], profile: (t) => 1 - t * 0.22, paint: sandstone, sides: 8, jitter: 0.16 });
  rockMass(mesh, { x: cactusX * 0.2, z: -0.66, rx: 0.07, rz: 0.06, height: 0.2, seed: 89 + variant,
    levels: [0, 0.4, 0.8, 1], profile: (t) => 1 - t * 0.35, paint: sandstone, sides: 7, jitter: 0.2 });
  b.addPainted(mesh.geometry());
  for (const [x, z] of [[cactusX * 0.62, 0.3], [-cactusX * 0.3, 0.55]]) {
    for (let twig = 0; twig < 5; twig++) {
      const angle = twig * TAU / 5;
      branch(b, [x!, 0.004, z!], [x! + Math.cos(angle) * 0.04, 0.05, z! + Math.sin(angle) * 0.04], 0.004, '#9a8a62', 3, true);
    }
  }
}

function sea(b: ModelBuilder, variant: number) {
  for (let wave = 0; wave < 5; wave++) {
    const angle = (wave - 2) * 0.87;
    const point = (segment: number): Vec3 => {
      const theta = angle + (segment - 3.5) * 0.12;
      const radius = 0.54 + Math.sin(segment * 0.65 + variant * 0.3) * 0.015;
      return [Math.sin(theta) * radius, 0.022, -Math.cos(theta) * radius];
    };
    for (let segment = 0; segment < 7; segment++) {
      branch(b, point(segment), point(segment + 1), 0.01, wave % 2 ? '#b3d9cc' : '#e0e9d6');
    }
  }
}

/** Original miniature landscapes, in hex-radius world units above the tile top. */
export function createTerrainModel(terrain: string, variant = 0): BufferGeometry {
  const normalized = ((Math.trunc(variant) % 3) + 3) % 3;
  const random = sceneryRandom(7021 + normalized * 7919);
  const builder = new ModelBuilder();
  switch (terrain) {
    case 'forest': forest(builder, random, normalized); break;
    case 'mountains': mountains(builder, random, normalized); break;
    case 'gold': mountains(builder, random, normalized, true); break;
    case 'hills': hills(builder, random, normalized); break;
    case 'fields': fields(builder, random, normalized); break;
    case 'pasture': pasture(builder, random, normalized); break;
    case 'desert': desert(builder, random, normalized); break;
    default: sea(builder, normalized); break;
  }
  return builder.build();
}
