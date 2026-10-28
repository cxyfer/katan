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
import { ModelBuilder, sceneryRandom } from './diorama-geometry.ts';
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

function patch(b: ModelBuilder, color: string, x: number, z: number, rx: number, rz: number, height = 0.035) {
  b.add(new SphereGeometry(1, 12, 6), color, [x, height * 0.5, z], [rx, height * 0.5, rz]);
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

/** A closed irregular ridge with a separate, continuous snow line. */
function ridge(b: ModelBuilder, x: number, z: number, radius: number, height: number, seed: number) {
  const random = sceneryRandom(seed);
  const base: Vec3[] = Array.from({ length: 7 }, (_, index) => {
    const angle = index / 7 * TAU;
    const r = radius * (0.8 + random() * 0.2);
    return [Math.cos(angle) * r, 0, Math.sin(angle) * r * 0.82];
  });
  const peak: Vec3 = [radius * 0.15, height, -radius * 0.12];
  const addFace = (points: readonly Vec3[], color: string) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
    geometry.computeVertexNormals();
    b.add(geometry, color, [x, 0, z]);
  };
  for (let index = 0; index < base.length; index++) {
    const a = base[index]!;
    const c = base[(index + 1) % base.length]!;
    const snow = 0.64 + random() * 0.12;
    const snowA: Vec3 = [a[0] + (peak[0] - a[0]) * snow, height * snow, a[2] + (peak[2] - a[2]) * snow];
    const snowC: Vec3 = [c[0] + (peak[0] - c[0]) * snow, height * snow, c[2] + (peak[2] - c[2]) * snow];
    addFace([a, snowA, snowC, a, snowC, c], stone[index % stone.length]!);
    addFace([snowA, peak, snowC], ['#e7e9dc', '#f6f2df', '#cfd9d2'][index % 3]!);
    addFace([[0, 0, 0], a, c], '#747d79');
  }
}

function mountains(b: ModelBuilder, random: () => number, variant: number, gold = false) {
  ridge(b, 0, -0.54, 0.31, 0.77 + variant * 0.014, variant + 7);
  ridge(b, -0.47, -0.3, 0.27, 0.59, variant + 13);
  ridge(b, 0.48, -0.24, 0.2, 0.42, variant + 37);
  ridge(b, -0.54, 0.12, 0.14, 0.32, variant + 41);
  for (let index = 0; index < 22; index++) {
    const angle = -1.85 + index * 3.7 / 21;
    const radius = 0.39 + random() * 0.08;
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    pebble(b, gold && index % 3 === 0 ? '#d6b356' : stone[index % stone.length]!, x, z, 0.016 + random() * 0.026);
  }
  // Dark fractured seams sit on the near slopes, away from the number badge.
  branch(b, [-0.02, 0.08, -0.32], [0.07, 0.33, -0.385], 0.012, '#596466');
  branch(b, [0.44, 0.025, -0.06], [0.51, 0.18, -0.15], 0.009, '#596466');
  if (gold) {
    for (const [x, z] of [[-0.49, 0.3], [0.49, 0.25], [0.39, -0.03]]) {
      pebble(b, '#caa24c', x!, z!, 0.083, 0.09);
      pebble(b, '#ebcd6e', x! - 0.028, z! + 0.025, 0.047, 0.07);
    }
  }
}

function hills(b: ModelBuilder, random: () => number, variant: number) {
  const clay = ['#b77c5d', '#c98e6c', '#d69f77', '#bb805d'];
  rigidGroup(b, 0.04, -0.55, 3, group => {
    for (let terrace = 0; terrace < 4; terrace++) {
      const r = 0.32 - terrace * 0.058;
      group.add(new CylinderGeometry(r * 0.91, r, 0.09, 7), clay[terrace]!, [-terrace * 0.018, 0.045 + terrace * 0.08, 0], [1, 1, 0.83]);
      for (let cut = 0; cut < 3; cut++) box(group, '#916a54', [-0.15 + cut * 0.09, 0.08 + terrace * 0.065, 0.17 - terrace * 0.041], [0.06, 0.016, 0.018]);
    }
  });
  patch(b, '#8c7059', -0.5, -0.26, 0.23, 0.22, 0.025);
  for (let terrace = 0; terrace < 2; terrace++) {
    b.add(new TorusGeometry(0.17 + terrace * 0.025, 0.024, 4, 9), clay[terrace]!, [-0.5, 0.045 + terrace * 0.05, -0.26], [1, 1, 0.8], [Math.PI / 2, 0, 0.1]);
  }
  for (let level = 0; level < 3; level++) {
    for (let brick = 0; brick < 4 - level; brick++) {
      box(b, ['#c98262', '#db9a74', '#af7057'][(brick + level) % 3]!, [0.43 + brick * 0.065 - level * 0.015, 0.027 + level * 0.046, 0.08], [0.059, 0.041, 0.077], [0, (level % 2 ? Math.PI / 2 : 0) + variant * 0.04, 0]);
    }
  }
  for (let rock = 0; rock < 12; rock++) {
    const angle = -1.5 + rock * 3 / 11;
    const radius = 0.61 + random() * 0.02;
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    pebble(b, clay[rock % 4]!, x, z, 0.025 + random() * 0.02);
  }
  for (const [x, z] of [[-0.5, 0.35], [0.5, 0.35]]) {
    pebble(b, '#b88162', x!, z!, 0.09, 0.1);
    box(b, '#dba581', [x! + 0.027, 0.085, z! - 0.01], [0.08, 0.025, 0.08]);
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
