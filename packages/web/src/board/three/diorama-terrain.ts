import {
  BoxGeometry,
  BufferGeometry,
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
import { ModelBuilder, outwardFace, PaintedMesh, sceneryRandom } from './diorama-geometry.ts';
import { tbTerrainModel } from './tb-terrain.ts';
import type { Vec3 } from './transforms.ts';

const TAU = Math.PI * 2;
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
  /** Keep ring heights exact so stepped terraces cannot cross. */
  flatLevels?: boolean;
}

/** A closed faceted lathe with jittered rings, painted face by face by height. */
function rockMass(mesh: PaintedMesh, options: MassOptions) {
  const random = sceneryRandom(options.seed);
  const sides = options.sides ?? 9;
  const jitter = options.jitter ?? 0.26;
  const phase = random() * TAU;
  const rings = options.levels.map((t, level) => {
    const scale = options.profile(t);
    const lift = 0.95 + random() * 0.08;
    const y = level === 0 ? 0 : options.height * t * (options.flatLevels ? 1 : lift);
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

const SQRT3 = Math.sqrt(3);

/** Largest radius a round feature centred at (x, z) can take inside the lanes and clear of the well. */
function room(x: number, z: number): number {
  const side = SQRT3 * 0.86 / 2 - 0.002 - Math.abs(x);
  const slope = (0.858 - Math.abs(z) - Math.abs(x) / SQRT3) * SQRT3 / 2;
  const well = Math.hypot(x, z) - 0.31;
  return Math.max(0, Math.min(side, slope, well));
}

/** A thin closed leaf blade from base through a raised midrib to a pointed tip. */
function blade(b: ModelBuilder, base: Vec3, mid: Vec3, tip: Vec3, width: number, color: string) {
  const along = new Vector3(tip[0] - base[0], 0, tip[2] - base[2]).normalize();
  const side = new Vector3(-along.z, 0, along.x).multiplyScalar(width);
  const left: Vec3 = [mid[0] + side.x, mid[1], mid[2] + side.z];
  const right: Vec3 = [mid[0] - side.x, mid[1], mid[2] - side.z];
  const up: Vec3 = [mid[0], mid[1] + width * 0.25, mid[2]];
  const down: Vec3 = [mid[0], mid[1] - width * 0.25, mid[2]];
  const mesh = new PaintedMesh();
  for (const end of [base, tip]) {
    for (const [p, q] of [[left, up], [up, right], [right, down], [down, left]] as const) outwardFace(mesh, end, p, q, color, mid);
  }
  const geometry = mesh.geometry();
  b.add(geometry, color);
}

// Forest: a dense mixed wood with felled timber for the lumber resource.

const SPRUCE = ['#2f5a45', '#3b6a4d', '#4b7b53', '#284f3f'];
const LEAF = ['#7fa35e', '#93b56a', '#6c9254', '#a6c174'];
const BARK = '#6e5440';
const CUT = '#dcbc8a';

function spruce(b: ModelBuilder, x: number, z: number, radius: number, height: number, tint: number) {
  b.add(radialSolid(radius * 0.13, radius * 0.2, height * 0.32, 5), BARK, [x, height * 0.16, z]);
  for (let tier = 0; tier < 4; tier++) {
    const h = height * (0.42 - tier * 0.03);
    const y = height * (0.18 + tier * 0.19) + h / 2;
    b.add(radialSolid(0, radius * (1 - tier * 0.2), h, 7), SPRUCE[(tint + tier) % SPRUCE.length]!,
      [x, y, z], [1, 1, 1], [0, tier * 0.45 + tint, 0]);
  }
}

function broadleaf(b: ModelBuilder, x: number, z: number, radius: number, height: number, tint: number) {
  branch(b, [x, 0, z], [x, height * 0.6, z], radius * 0.14, '#7b5f45', 5);
  b.add(new IcosahedronGeometry(1, 0), LEAF[tint % LEAF.length]!, [x, height * 0.72, z],
    [radius * 0.62, radius * 0.56, radius * 0.62], [0, tint, 0]);
  for (let puff = 0; puff < 3; puff++) {
    const angle = puff * TAU / 3 + tint;
    b.add(new IcosahedronGeometry(1, 0), LEAF[(tint + puff + 1) % LEAF.length]!,
      [x + Math.cos(angle) * radius * 0.45, height * 0.58, z + Math.sin(angle) * radius * 0.45],
      [radius * 0.5, radius * 0.46, radius * 0.5], [0, angle, 0]);
  }
}

function logPile(b: ModelBuilder, x: number, z: number, yaw: number) {
  const r = 0.026;
  rigidGroup(b, x, z, yaw, (group) => {
    [3, 2, 1].forEach((count, row) => {
      const length = 0.21 - row * 0.014;
      for (let log = 0; log < count; log++) {
        const offset = (log - (count - 1) / 2) * r * 2.05;
        const y = r + row * r * 1.75;
        group.add(radialSolid(r, r, length, 7), log % 2 ? '#7a5b40' : '#86664a', [0, y, offset], [1, 1, 1], [0, 0, Math.PI / 2]);
        for (const end of [-1, 1]) {
          group.add(radialSolid(r * 0.82, r * 0.82, 0.004, 7), CUT, [end * (length / 2 + 0.002), y, offset], [1, 1, 1], [0, 0, Math.PI / 2]);
        }
      }
    });
  });
}

function stump(b: ModelBuilder, x: number, z: number) {
  b.add(radialSolid(0.036, 0.044, 0.05, 7), BARK, [x, 0.025, z]);
  b.add(radialSolid(0.032, 0.032, 0.004, 7), CUT, [x, 0.052, z]);
  // An axe left in the stump marks the woodcutter's clearing.
  branch(b, [x + 0.004, 0.05, z], [x + 0.05, 0.135, z + 0.01], 0.0055, '#a07a4f', 4);
  box(b, '#8c9599', [x + 0.012, 0.062, z], [0.032, 0.022, 0.008], [0, 0, 1.05]);
}

function forest(b: ModelBuilder, random: () => number, variant: number) {
  crescentPatch(b, '#6f9161', -1.9, -0.1, 0.03, 0.36, 0.72);
  crescentPatch(b, '#82a06e', 0.1, 1.9, 0.03, 0.36, 0.72);
  const stands: readonly (readonly [number, number, number, boolean])[] = [
    [0, -0.68, 1.08, false], [-0.26, -0.56, 1, false], [0.26, -0.56, 1, false],
    [-0.5, -0.4, 0.95, false], [0.5, -0.4, 0.95, false], [-0.13, -0.44, 0.85, true], [0.14, -0.43, 0.9, false],
    [-0.62, -0.12, 0.9, true], [0.63, -0.1, 0.9, false], [-0.42, -0.2, 0.8, false], [0.42, -0.22, 0.85, true],
    [-0.58, 0.2, 0.75, false], [0.6, 0.2, 0.75, false], [0.42, 0.44, 0.65, true],
    [-0.12, 0.66, 0.55, false], [0.14, 0.62, 0.6, false],
  ];
  stands.forEach(([x, z, size, round], index) => {
    const scale = size * (0.92 + random() * 0.16);
    const radius = Math.min(0.12 * scale, room(x, z) * 0.97);
    const height = 0.44 * scale * (1 + Math.max(0, -z) * 0.3);
    if (round) broadleaf(b, x, z, radius, height * 0.85, index + variant);
    else spruce(b, x, z, radius, height, index + variant);
  });
  logPile(b, -0.36, 0.48, 0.55 + variant * 0.1);
  stump(b, 0.22, 0.47);
  for (const [x, z] of [[0.5, 0.06], [-0.3, 0.6], [-0.66, 0.02]]) pebble(b, '#a5ae95', x!, z!, 0.03);
}

// Mountains and gold: a snow-capped range with a working mine.

const ROCK = ['#7d8784', '#6b7574', '#8f9893', '#5f6a6b', '#99a09a'];
const SCREE = ['#8b8d80', '#9c9b8b', '#7c8077'];
const SNOW = ['#f3f2ea', '#e2e7e2', '#fbf8ef'];
const ORE = ['#5d6b78', '#6f7f8c', '#4c5966', '#8b9aa6'];
const GOLD = ['#d8b34f', '#ebcd6e', '#c79a3c'];

function peakPaint(snowline: number, gold: boolean) {
  return (t: number, face: number, random: () => number) => {
    const ragged = snowline + (random() - 0.5) * 0.14;
    if (t > ragged) return SNOW[face % SNOW.length]!;
    if (gold && t > 0.22 && t < 0.5 && random() < 0.28) return GOLD[face % 2 ? 0 : 2]!;
    if (t < 0.2) return SCREE[face % SCREE.length]!;
    return ROCK[Math.floor(random() * ROCK.length)]!;
  };
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

/** A timber-framed adit with rails out to a loaded ore cart, all facing +Z. */
function mine(b: ModelBuilder, x: number, z: number, gold: boolean) {
  box(b, '#232829', [x, 0.05, z], [0.078, 0.1, 0.04]);
  for (const side of [-1, 1]) box(b, '#7a5a3c', [x + side * 0.046, 0.062, z + 0.022], [0.016, 0.124, 0.018]);
  box(b, '#6b4c33', [x, 0.13, z + 0.022], [0.124, 0.02, 0.026]);
  const length = 0.23;
  for (const side of [-1, 1]) box(b, '#5d6366', [x + side * 0.022, 0.008, z + 0.02 + length / 2], [0.006, 0.006, length]);
  for (let sleeper = 0; sleeper < 6; sleeper++) box(b, '#7d6248', [x, 0.0025, z + 0.04 + sleeper * 0.04], [0.068, 0.005, 0.014]);
  const cz = z + 0.17;
  b.add(radialSolid(0.05, 0.038, 0.05, 4), '#5a4433', [x, 0.047, cz], [1, 1, 1.2], [0, Math.PI / 4, 0]);
  box(b, '#3e4446', [x, 0.07, cz], [0.074, 0.006, 0.086]);
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      b.add(radialSolid(0.015, 0.015, 0.008, 6), '#2f3436', [x + dx * 0.038, 0.016, cz + dz * 0.028], [1, 1, 1], [0, 0, Math.PI / 2]);
    }
  }
  const load = gold ? GOLD : ORE;
  for (let chunk = 0; chunk < 6; chunk++) {
    b.add(new IcosahedronGeometry(1, 0), load[chunk % load.length]!,
      [x + ((chunk % 3) - 1) * 0.02, 0.078 + (chunk > 2 ? 0.012 : 0), cz + (chunk % 2 ? 0.016 : -0.016)],
      [0.022, 0.017, 0.02], [chunk, chunk * 2, 0]);
  }
}

function mountains(b: ModelBuilder, random: () => number, variant: number, gold = false) {
  const mesh = new PaintedMesh();
  const peaks = [
    { x: 0.02, z: -0.53, rx: 0.33, rz: 0.27, h: 0.77 + variant * 0.012, snow: 0.6 },
    { x: -0.46, z: -0.3, rx: 0.27, rz: 0.22, h: 0.57, snow: 0.66 },
    { x: 0.48, z: -0.25, rx: 0.22, rz: 0.19, h: 0.44, snow: 0.74 },
    { x: -0.55, z: 0.12, rx: 0.15, rz: 0.13, h: 0.3, snow: 2 },
  ];
  peaks.forEach((peak, index) => rockMass(mesh, {
    x: peak.x, z: peak.z, rx: peak.rx, rz: peak.rz, height: peak.h, seed: variant * 31 + index * 7 + 5,
    levels: [0, 0.18, 0.4, 0.62, 0.82, 1], profile: (t) => t >= 1 ? 0 : Math.pow(1 - t, 0.85),
    paint: peakPaint(peak.snow, gold), sides: 9,
  }));
  b.addPainted(mesh.geometry());
  mine(b, -0.55, 0.255, gold);
  // Loose scree around the foot of the range.
  for (let index = 0; index < 18; index++) {
    const angle = -1.85 + index * 3.7 / 17;
    const radius = 0.4 + random() * 0.08;
    pebble(b, gold && index % 3 === 0 ? '#d6b356' : stone[index % stone.length]!, Math.sin(angle) * radius, -Math.cos(angle) * radius, 0.016 + random() * 0.022);
  }
  for (const [x, z, size] of [[0.58, 0.1, 0.55], [0.47, 0.3, 0.48], [0.22, 0.56, 0.42]] as const) {
    alpinePine(b, x, z, size, variant);
  }
  if (gold) {
    // Gold nuggets glint in the scree.
    for (const [x, z] of [[0.36, -0.02], [0.62, -0.14]] as const) {
      pebble(b, '#caa24c', x, z, 0.05, 0.06);
      pebble(b, '#ebcd6e', x - 0.022, z + 0.02, 0.03, 0.045);
    }
  }
  // A heap of broken ore (or nuggets) waiting by the track.
  for (let chunk = 0; chunk < 7; chunk++) {
    const angle = chunk * 2.4;
    const spread = chunk ? 0.035 : 0;
    const color = gold ? GOLD[chunk % GOLD.length]! : ORE[chunk % ORE.length]!;
    pebble(b, color, -0.3 + Math.cos(angle) * spread, 0.5 + Math.sin(angle) * spread * 0.7, chunk ? 0.028 : 0.04, chunk ? 0.04 : 0.065);
  }
}

// Hills: terraced clay pits, a beehive kiln and fired brick.

const CLAY = ['#b4684a', '#c98260', '#a65b3f', '#d39a72', '#bb7354'];
const TURF = ['#97a862', '#a8b56d', '#8a9c5a'];
const BRICK = ['#c4724f', '#d6875f', '#b0603f', '#cf7b55'];

/** Terrace ledges sit at mid-heights .33 and .65; quads pass t and t + .04. */
function terracePaint(t: number, face: number, random: () => number): string {
  if (t >= 0.99 || (t > 0.32 && t < 0.38) || (t > 0.64 && t < 0.7)) return TURF[face % TURF.length]!;
  const band = Math.floor((t + (random() - 0.5) * 0.04) * 9);
  return CLAY[((band % CLAY.length) + CLAY.length) % CLAY.length]!;
}

function terraceProfile(t: number): number {
  if (t <= 0.32) return 1 - t * 0.1;
  if (t <= 0.64) return 0.74 - (t - 0.34) * 0.1;
  return 0.5 - (t - 0.66) * 0.1;
}

function kiln(b: ModelBuilder, x: number, z: number) {
  b.add(radialSolid(0.1, 0.108, 0.05, 10), '#9c5a3c', [x, 0.025, z]);
  b.add(new SphereGeometry(0.1, 10, 5, 0, TAU, 0, Math.PI / 2), '#c0714c', [x, 0.05, z], [1, 0.9, 1]);
  box(b, '#2d211c', [x, 0.05, z + 0.094], [0.05, 0.062, 0.022]);
  box(b, '#e0a07a', [x, 0.086, z + 0.1], [0.072, 0.014, 0.018]);
  b.add(radialSolid(0.022, 0.026, 0.12, 6), '#8a4f36', [x + 0.04, 0.17, z - 0.035]);
  b.add(radialSolid(0.027, 0.027, 0.012, 6), '#5e3a2b', [x + 0.04, 0.234, z - 0.035]);
  for (let puff = 0; puff < 3; puff++) {
    b.add(new IcosahedronGeometry(1, 0), ['#ebe5da', '#f3eee5', '#faf6ef'][puff]!,
      [x + 0.045 + puff * 0.016, 0.27 + puff * 0.045, z - 0.04 - puff * 0.01], [0.026 - puff * 0.004, 0.02 - puff * 0.003, 0.024 - puff * 0.004]);
  }
  for (const dz of [-0.02, 0.02]) b.add(radialSolid(0.012, 0.012, 0.09, 6), '#7a5b40', [x - 0.12, 0.012, z + 0.04 + dz], [1, 1, 1], [Math.PI / 2, 0, 0]);
}

function brickPallet(b: ModelBuilder, x: number, z: number, levels: number, yaw: number) {
  rigidGroup(b, x, z, yaw, (group) => {
    box(group, '#8a6845', [0, 0.008, 0], [0.21, 0.016, 0.135]);
    for (let level = 0; level < levels; level++) {
      for (let row = 0; row < 2; row++) {
        for (let brick = 0; brick < 4; brick++) {
          box(group, BRICK[(brick + row * 2 + level) % BRICK.length]!,
            [-0.075 + brick * 0.05, 0.028 + level * 0.025, row ? 0.031 : -0.031], [0.046, 0.022, 0.058]);
        }
      }
    }
  });
}

function hills(b: ModelBuilder, random: () => number, variant: number) {
  const mesh = new PaintedMesh();
  const pits = [
    { x: 0.02, z: -0.52, rx: 0.34, rz: 0.25, h: 0.4 },
    { x: -0.5, z: -0.22, rx: 0.2, rz: 0.17, h: 0.27 },
    { x: 0.52, z: -0.2, rx: 0.17, rz: 0.15, h: 0.2 },
  ];
  pits.forEach((pit, index) => rockMass(mesh, {
    x: pit.x, z: pit.z, rx: pit.rx, rz: pit.rz, height: pit.h, seed: variant * 17 + index * 13 + 3,
    levels: [0, 0.32, 0.34, 0.64, 0.66, 1], profile: terraceProfile, paint: terracePaint,
    sides: 11, jitter: 0.14, flatLevels: true,
  }));
  b.addPainted(mesh.geometry());
  kiln(b, -0.45, 0.3);
  brickPallet(b, 0.46, 0.26, 3, 0.4 + variant * 0.08);
  brickPallet(b, 0.08, 0.56, 2, 0.1);
  for (let rock = 0; rock < 10; rock++) {
    const angle = -1.4 + rock * 2.8 / 9;
    const radius = 0.66 + random() * 0.03;
    pebble(b, CLAY[rock % 4]!, Math.sin(angle) * radius, -Math.cos(angle) * radius * 0.9, 0.02 + random() * 0.016);
  }
  for (const [x, z] of [[-0.2, 0.52], [0.62, 0.02], [-0.66, 0.08]]) {
    for (let leaf = 0; leaf < 3; leaf++) {
      b.add(new IcosahedronGeometry(1, 0), ['#7f8f4e', '#93a35a', '#6f8045'][leaf]!,
        [x! + (leaf - 1) * 0.026, 0.028 + (leaf % 2) * 0.012, z! + (leaf % 2) * 0.018], [0.032, 0.028, 0.028]);
    }
  }
}

// Fields: ridged grain plots around a windmill, with stooks on the stubble.

const RIPE = ['#e3be62', '#d9b257', '#ecca72'];
const GREEN_GOLD = ['#c3b55c', '#b5a852', '#cfc068'];
const SOIL = '#9a7a3e';

function cropPlot(
  b: ModelBuilder, mesh: PaintedMesh, random: () => number,
  x: number, z: number, yaw: number, length: number, width: number, rows: number,
  palette: readonly string[], height: number,
) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const place = (lx: number, y: number, lz: number): Vec3 => {
    const [px, pz] = clampFootprint(x + lx * cos + lz * sin, z - lx * sin + lz * cos);
    return [px, y, pz];
  };
  // Dark soil shows between the ridges.
  const [a, c, d, e] = [place(-length / 2, 0.003, -width / 2), place(-length / 2, 0.003, width / 2),
    place(length / 2, 0.003, -width / 2), place(length / 2, 0.003, width / 2)];
  mesh.face(a, c, d, SOIL).face(d, c, e, SOIL);
  const segments = 4;
  const half = width / rows / 2;
  for (let row = 0; row < rows; row++) {
    const zc = -width / 2 + half * (2 * row + 1);
    const color = palette[row % palette.length]!;
    const tops = Array.from({ length: segments + 1 }, () => height * (0.8 + random() * 0.35));
    for (let segment = 0; segment < segments; segment++) {
      const x0 = -length / 2 + length * segment / segments;
      const x1 = -length / 2 + length * (segment + 1) / segments;
      const l0 = place(x0, 0, zc - half * 0.95), l1 = place(x1, 0, zc - half * 0.95);
      const r0 = place(x0, 0, zc + half * 0.95), r1 = place(x1, 0, zc + half * 0.95);
      const t0 = place(x0, tops[segment]!, zc), t1 = place(x1, tops[segment + 1]!, zc);
      mesh.face(l0, t0, l1, color).face(l1, t0, t1, color).face(r0, r1, t0, color).face(r1, t1, t0, color);
      if (segment === 0) mesh.face(l0, r0, t0, color);
      if (segment === segments - 1) mesh.face(l1, t1, r1, color);
    }
    // Grain heads nod above each ridge.
    for (let head = 0; head < 7; head++) {
      const along = (head + 0.5) / 7;
      const step = along * segments;
      const index = Math.min(segments - 1, Math.floor(step));
      const top = tops[index]! + (tops[index + 1]! - tops[index]!) * (step - index);
      const [px, , pz] = place(-length / 2 + length * along, 0, zc + (random() - 0.5) * half * 0.6);
      b.add(grainGeometry(), palette[(row + head) % palette.length]!, [px, top + 0.006, pz], [0.012, 0.018, 0.012],
        [random() * 0.3 - 0.15, random() * TAU, random() * 0.3 - 0.15]);
    }
  }
}

function windmill(b: ModelBuilder, x: number, z: number, variant: number) {
  b.add(radialSolid(0.102, 0.108, 0.03, 8), '#b9a88d', [x, 0.015, z]);
  b.add(radialSolid(0.075, 0.1, 0.3, 8), '#efe4cf', [x, 0.18, z]);
  b.add(radialSolid(0.082, 0.082, 0.02, 8), '#8f5b3c', [x, 0.34, z]);
  b.add(radialSolid(0, 0.096, 0.13, 8), '#a5563b', [x, 0.415, z]);
  box(b, '#5b3f2c', [x, 0.07, z + 0.099], [0.04, 0.07, 0.012], [0.08, 0, 0]);
  box(b, '#33403f', [x, 0.22, z + 0.086], [0.026, 0.034, 0.01], [0.08, 0, 0]);
  const hubY = 0.37;
  const hubZ = z + 0.1;
  b.add(radialSolid(0.018, 0.018, 0.05, 6), '#5b3f2c', [x, hubY, hubZ - 0.016], [1, 1, 1], [Math.PI / 2, 0, 0]);
  for (let arm = 0; arm < 4; arm++) {
    const angle = arm * Math.PI / 2 + 0.35 + variant * 0.2;
    const rotation: Vec3 = [0, 0, angle];
    const dx = -Math.sin(angle), dy = Math.cos(angle);
    const sx = Math.cos(angle), sy = Math.sin(angle);
    box(b, '#6b4a33', [x + dx * 0.11, hubY + dy * 0.11, hubZ], [0.012, 0.22, 0.01], rotation);
    box(b, '#f1e6c8', [x + dx * 0.13 + sx * 0.03, hubY + dy * 0.13 + sy * 0.03, hubZ - 0.002], [0.046, 0.16, 0.005], rotation);
    for (let bar = 0; bar < 3; bar++) {
      const reach = 0.075 + bar * 0.055;
      box(b, '#8a6a4a', [x + dx * reach + sx * 0.03, hubY + dy * reach + sy * 0.03, hubZ + 0.003], [0.052, 0.006, 0.004], rotation);
    }
  }
}

function stook(b: ModelBuilder, x: number, z: number, tint: number) {
  b.add(radialSolid(0.014, 0.05, 0.1, 7), RIPE[tint % RIPE.length]!, [x, 0.05, z], [1, 1, 1], [0, tint, 0]);
  b.add(radialSolid(0, 0.022, 0.04, 7), '#ecd38a', [x, 0.118, z]);
  b.add(new TorusGeometry(0.029, 0.005, 3, 7), '#9b7951', [x, 0.07, z], [1, 1, 1], [Math.PI / 2, 0, 0]);
}

function fields(b: ModelBuilder, random: () => number, variant: number) {
  const mesh = new PaintedMesh();
  cropPlot(b, mesh, random, -0.4, -0.38, 0.55, 0.36, 0.26, 6, RIPE, 0.07);
  cropPlot(b, mesh, random, 0.4, -0.38, -0.55, 0.36, 0.26, 6, variant === 1 ? GREEN_GOLD : RIPE, 0.07);
  cropPlot(b, mesh, random, -0.53, 0.1, Math.PI / 2, 0.34, 0.26, 6, variant === 2 ? GREEN_GOLD : RIPE, 0.065);
  cropPlot(b, mesh, random, 0.53, 0.1, Math.PI / 2, 0.34, 0.26, 6, variant === 0 ? GREEN_GOLD : RIPE, 0.06);
  b.addPainted(mesh.geometry());
  windmill(b, 0, -0.62, variant);
  for (const [index, [x, z]] of [[-0.3, 0.5], [-0.14, 0.6], [0.04, 0.64], [0.2, 0.58], [0.34, 0.48]].entries()) {
    stook(b, x!, z!, index + variant);
  }
}

// Pasture: rolling meadow, a flock of sheep, hay and a split-rail fence.

const MEADOW = ['#8eae60', '#98b768', '#86a75a', '#a2bf70'];
const WOOL = '#ece6d2';
const FLEECE = '#faf5e6';
const SHEEP_FACE = '#3f3a35';

function sheep(b: ModelBuilder, x: number, z: number, yaw: number, size: number) {
  rigidGroup(b, x, z, yaw, (group) => {
    const s = size;
    for (const px of [-0.045, 0.045]) {
      for (const pz of [-0.03, 0.03]) group.add(radialSolid(0.009 * s, 0.011 * s, 0.062 * s, 4), SHEEP_FACE, [px * s, 0.031 * s, pz * s]);
    }
    group.add(new SphereGeometry(1, 8, 5), WOOL, [0, 0.1 * s, 0], [0.086 * s, 0.062 * s, 0.06 * s]);
    for (let puff = 0; puff < 4; puff++) {
      group.add(new IcosahedronGeometry(1, 0), FLEECE, [(-0.048 + puff * 0.032) * s, 0.136 * s, (puff % 2 ? 0.02 : -0.02) * s],
        [0.034 * s, 0.03 * s, 0.033 * s], [0, puff, 0]);
    }
    group.add(new IcosahedronGeometry(1, 0), SHEEP_FACE, [0.094 * s, 0.118 * s, 0], [0.04 * s, 0.032 * s, 0.026 * s]);
    group.add(new IcosahedronGeometry(1, 0), FLEECE, [0.082 * s, 0.146 * s, 0], [0.022 * s, 0.015 * s, 0.022 * s]);
    for (const side of [-1, 1]) {
      group.add(new OctahedronGeometry(1, 0), '#5a524a', [0.084 * s, 0.13 * s, side * 0.034 * s], [0.012 * s, 0.006 * s, 0.022 * s], [side * 0.5, 0, 0]);
    }
    group.add(new IcosahedronGeometry(1, 0), FLEECE, [-0.09 * s, 0.11 * s, 0], [0.018 * s, 0.018 * s, 0.016 * s]);
  });
}

function hayBale(b: ModelBuilder, x: number, z: number, yaw: number) {
  rigidGroup(b, x, z, yaw, (group) => {
    group.add(radialSolid(0.04, 0.04, 0.075, 9), '#d9bb6a', [0, 0.04, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
    for (const end of [-1, 1]) group.add(radialSolid(0.03, 0.03, 0.003, 9), '#c9a655', [end * 0.039, 0.04, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
  });
}

function fence(b: ModelBuilder, points: readonly (readonly [number, number])[]) {
  for (const [x, z] of points) box(b, '#a58a61', [x, 0.05, z], [0.018, 0.1, 0.018]);
  for (let index = 0; index < points.length - 1; index++) {
    const [ax, az] = points[index]!;
    const [bx, bz] = points[index + 1]!;
    branch(b, [ax, 0.045, az], [bx, 0.045, bz], 0.006, '#b89d72', 4);
    branch(b, [ax, 0.083, az], [bx, 0.083, bz], 0.006, '#c3ab7e', 4);
  }
}

function pasture(b: ModelBuilder, random: () => number, variant: number) {
  const mesh = new PaintedMesh();
  const knolls = [
    { x: -0.04, z: -0.6, rx: 0.26, rz: 0.17, h: 0.12 },
    { x: -0.56, z: -0.24, rx: 0.15, rz: 0.13, h: 0.08 },
    { x: 0.56, z: -0.12, rx: 0.14, rz: 0.12, h: 0.07 },
  ];
  knolls.forEach((knoll, index) => rockMass(mesh, {
    x: knoll.x, z: knoll.z, rx: knoll.rx, rz: knoll.rz, height: knoll.h, seed: variant * 11 + index * 5 + 2,
    levels: [0, 0.3, 0.6, 0.85, 1], profile: (t) => t >= 1 ? 0.2 : Math.cos(t * Math.PI / 2) * 0.85 + 0.15,
    paint: (t, face) => MEADOW[(face * 7 + Math.floor(t * 4)) % MEADOW.length]!, sides: 14, jitter: 0.08,
  }));
  b.addPainted(mesh.geometry());
  const flock: readonly (readonly [number, number])[] = [
    [-0.58, 0.06], [-0.3, -0.38], [0.26, -0.4], [0.58, 0.1], [0.42, 0.24], [-0.04, 0.6], [-0.56, 0.3],
  ];
  flock.forEach(([x, z], index) => sheep(b, x, z, -0.6 + index * 1.1 + variant * 0.4, 1.05 + random() * 0.2));
  fence(b, [[0.18, 0.64], [0.36, 0.52], [0.53, 0.38], [0.66, 0.2]]);
  hayBale(b, -0.32, 0.52, 0.7);
  hayBale(b, -0.4, 0.42, 0.9);
  broadleaf(b, 0.34, -0.5, Math.min(0.1, room(0.34, -0.5)), 0.34, variant + 1);
  for (let flower = 0; flower < 20; flower++) {
    const angle = random() * TAU;
    const radius = 0.38 + random() * 0.3;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (room(x, z) < 0.02) continue;
    branch(b, [x, 0.008, z], [x, 0.035, z], 0.0025, '#739369', 3, true);
    b.add(new OctahedronGeometry(0.01, 0), flower % 3 ? '#eee5b4' : '#cda09d', [x, 0.038, z]);
  }
}

// Desert: dunes, a wind-cut butte and arch, and a palm oasis.

const SAND = ['#e3c992', '#d6b67e', '#f0dcac', '#cba672'];
const SANDSTONE = ['#c98b5c', '#dba274', '#bf7d52', '#e2b384'];

/** A barchan-like dune: its crest leans downwind, so the lee face is steep. */
function dune(mesh: PaintedMesh, x: number, z: number, rx: number, rz: number, height: number, lee: number) {
  const rings = 5;
  const sectors = 14;
  const apex: Vec3 = [x + Math.cos(lee) * rx * 0.3, height, z + Math.sin(lee) * rz * 0.3];
  const point = (ring: number, sector: number): Vec3 => {
    if (ring === 0) return apex;
    const s = ring / rings;
    const angle = sector / sectors * TAU;
    const [bx, bz] = clampFootprint(x + Math.cos(angle) * rx, z + Math.sin(angle) * rz);
    return [apex[0] + (bx - apex[0]) * s, ring === rings ? 0 : height * Math.pow(1 - s * s, 1.1), apex[2] + (bz - apex[2]) * s];
  };
  const below: Vec3 = [apex[0], -1, apex[2]];
  for (let ring = 0; ring < rings; ring++) {
    for (let sector = 0; sector < sectors; sector++) {
      const next = (sector + 1) % sectors;
      // Pale crest over a warmer foot; facets alone carry the ripple.
      const color = ring < 2 ? SAND[2]! : ring < 4 ? SAND[(sector % 2) * 2]! : SAND[sector % 2 ? 1 : 3]!;
      if (ring === 0) outwardFace(mesh, apex, point(1, sector), point(1, next), color, below);
      else {
        outwardFace(mesh, point(ring, sector), point(ring + 1, sector), point(ring + 1, next), color, below);
        outwardFace(mesh, point(ring, sector), point(ring + 1, next), point(ring, next), color, below);
      }
    }
  }
}

function rockArch(b: ModelBuilder, x: number, z: number) {
  const segments = 7;
  const radius = 0.085;
  for (let index = 0; index < segments; index++) {
    const a0 = Math.PI * index / segments;
    const a1 = Math.PI * (index + 1) / segments;
    branch(b, [x + Math.cos(a0) * radius, 0.03 + Math.sin(a0) * radius * 1.4, z],
      [x + Math.cos(a1) * radius, 0.03 + Math.sin(a1) * radius * 1.4, z], 0.024, SANDSTONE[index % SANDSTONE.length]!, 6);
  }
  for (const side of [-1, 1]) b.add(radialSolid(0.028, 0.038, 0.04, 6), SANDSTONE[side > 0 ? 2 : 0]!, [x + side * radius, 0.02, z]);
}

function palm(b: ModelBuilder, x: number, z: number, height: number, lean: number, tint: number) {
  let previous: Vec3 = [x, 0, z];
  for (let segment = 1; segment <= 4; segment++) {
    const t = segment / 4;
    const next: Vec3 = [x + Math.cos(lean) * t * t * 0.06, height * t, z + Math.sin(lean) * t * t * 0.06];
    branch(b, previous, next, 0.016 - segment * 0.0015, segment % 2 ? '#8b6e4c' : '#9c7e58', 5);
    previous = next;
  }
  const [tx, ty, tz] = previous;
  for (let frond = 0; frond < 7; frond++) {
    const angle = frond * TAU / 7 + tint;
    blade(b, [tx, ty, tz], [tx + Math.cos(angle) * 0.06, ty + 0.02, tz + Math.sin(angle) * 0.06],
      [tx + Math.cos(angle) * 0.11, ty - 0.035, tz + Math.sin(angle) * 0.11], 0.018, ['#5e8f4c', '#6fa057', '#4f7e43'][frond % 3]!);
  }
  for (let nut = 0; nut < 3; nut++) {
    const angle = nut * TAU / 3 + tint;
    b.add(new IcosahedronGeometry(0.011, 0), '#6b4e33', [tx + Math.cos(angle) * 0.014, ty - 0.012, tz + Math.sin(angle) * 0.014]);
  }
}

function oasis(b: ModelBuilder, x: number, z: number) {
  b.add(radialSolid(0.125, 0.135, 0.004, 12), '#c9ad78', [x, 0.002, z], [1, 1, 0.8]);
  b.add(radialSolid(0.1, 0.104, 0.004, 12), '#4f9ea3', [x, 0.005, z], [1, 1, 0.8]);
  b.add(radialSolid(0.055, 0.058, 0.002, 12), '#7cc2bf', [x - 0.015, 0.0075, z - 0.01], [1, 1, 0.8]);
  for (let reed = 0; reed < 6; reed++) {
    const angle = 0.6 + reed * 0.32;
    const rx = x + Math.cos(angle) * 0.11;
    const rz = z + Math.sin(angle) * 0.09;
    branch(b, [rx, 0.004, rz], [rx + 0.004, 0.05 + (reed % 2) * 0.015, rz], 0.003, '#7f9b55', 3, true);
  }
}

function saguaro(b: ModelBuilder, x: number, z: number) {
  branch(b, [x, 0, z], [x, 0.3, z], 0.027, '#7b9b77', 7);
  branch(b, [x, 0.12, z], [x - 0.07, 0.12, z], 0.018, '#78956e', 6);
  branch(b, [x - 0.07, 0.12, z], [x - 0.07, 0.23, z], 0.018, '#8ca57b', 6);
  branch(b, [x, 0.18, z], [x + 0.055, 0.18, z], 0.016, '#78956e', 6);
  branch(b, [x + 0.055, 0.18, z], [x + 0.055, 0.25, z], 0.016, '#8ca57b', 6);
}

function desert(b: ModelBuilder, random: () => number, variant: number) {
  const mesh = new PaintedMesh();
  dune(mesh, -0.28, -0.5, 0.28, 0.19, 0.2, 0.4 + variant * 0.2);
  dune(mesh, 0.38, 0.47, 0.17, 0.12, 0.1, 0.6);
  dune(mesh, 0.56, -0.02, 0.13, 0.15, 0.11, 1.2);
  // Wind-cut sandstone: a banded flat-topped butte and a slender spire beside it.
  const sandstone = (t: number, face: number) => t > 0.97 ? ['#e6bf8c', '#dcb27e'][face % 2]!
    : SANDSTONE[Math.floor(t * 5) % SANDSTONE.length]!;
  rockMass(mesh, { x: 0.34, z: -0.5, rx: 0.16, rz: 0.13, height: 0.3, seed: 71 + variant,
    levels: [0, 0.3, 0.62, 0.9, 1], profile: (t) => 1 - t * 0.22, paint: sandstone, sides: 8, jitter: 0.16 });
  rockMass(mesh, { x: 0.58, z: -0.28, rx: 0.06, rz: 0.055, height: 0.2, seed: 89 + variant,
    levels: [0, 0.4, 0.8, 1], profile: (t) => 1 - t * 0.35, paint: sandstone, sides: 7, jitter: 0.2 });
  b.addPainted(mesh.geometry());
  rockArch(b, -0.6, -0.1);
  oasis(b, -0.36, 0.38);
  palm(b, -0.55, 0.22, 0.3, Math.PI + 0.4, variant);
  palm(b, -0.18, 0.52, 0.25, 0.9, variant + 1);
  saguaro(b, 0.6, 0.2);
  // A bleached spine with paired ribs.
  branch(b, [0.02, 0.012, 0.62], [0.2, 0.012, 0.58], 0.008, '#eee5c8');
  for (let rib = 0; rib < 4; rib++) {
    const x = 0.05 + rib * 0.038;
    branch(b, [x, 0.012, 0.61], [x - 0.012, 0.025, 0.655], 0.004, '#eee5c8');
    branch(b, [x, 0.012, 0.61], [x - 0.018, 0.025, 0.56], 0.004, '#eee5c8');
  }
  for (let rock = 0; rock < 10; rock++) {
    const angle = random() * TAU;
    const radius = 0.4 + random() * 0.25;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (room(x, z) > 0.03) pebble(b, rock % 2 ? '#b8a989' : '#c4b699', x, z, 0.014 + random() * 0.014);
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
    default: if (!tbTerrainModel(builder, terrain)) sea(builder, normalized); break;
  }
  return builder.build();
}
