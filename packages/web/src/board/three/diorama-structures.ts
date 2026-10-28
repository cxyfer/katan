import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Quaternion,
  Shape,
  TorusGeometry,
  Vector3,
} from 'three';
import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from '../geometry.ts';
import { geometryToWorld } from './bounds.ts';
import { ModelBuilder } from './diorama-geometry.ts';
import { harborInstances } from './model-specs.ts';
import type { InstanceTransform, Vec3 } from './transforms.ts';

const PLASTER = '#f4dfb5';
const STONE = '#c2c4ae';
const TIMBER = '#6b442c';
const DARK = '#263b3d';
const WOOD = '#b9834d';
const ROPE = '#dfcb93';

function tint(color: string, amount: number): string {
  return `#${new Color(color).lerp(new Color(amount > 0 ? '#fff0ce' : '#212e32'), Math.abs(amount)).getHexString()}`;
}

function box(model: ModelBuilder, color: string, position: Vec3, scale: Vec3, rotation: Vec3 = [0, 0, 0]) {
  model.add(new BoxGeometry(1, 1, 1), color, position, scale, rotation);
}

function beam(model: ModelBuilder, color: string, from: Vec3, to: Vec3, radius: number) {
  const start = new Vector3(...from);
  const end = new Vector3(...to);
  const direction = end.clone().sub(start);
  const geometry = new CylinderGeometry(radius, radius, direction.length(), 4);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
  model.add(geometry, color, start.add(end).multiplyScalar(0.5).toArray() as [number, number, number]);
}

/** Closed triangular prism: the gable, thick roof and walls intersect at the eaves. */
function pitchedRoof(width: number, height: number, depth: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 }).translate(0, 0, -depth / 2);
}

function windowFront(model: ModelBuilder, x: number, y: number, z: number, color: string, size = 0.038, facing = -1) {
  box(model, TIMBER, [x, y, z], [size + 0.012, size + 0.014, 0.009]);
  box(model, DARK, [x, y + 0.001, z + facing * 0.005], [size, size, 0.006]);
  box(model, PLASTER, [x, y - size / 2 - 0.006, z + facing * 0.008], [size + 0.025, 0.01, 0.021]);
  box(model, color, [x - size / 2 - 0.008, y, z + facing * 0.007], [0.011, size + 0.006, 0.009]);
  box(model, color, [x + size / 2 + 0.008, y, z + facing * 0.007], [0.011, size + 0.006, 0.009]);
  box(model, PLASTER, [x, y, z + facing * 0.009], [0.004, size, 0.004]);
}

function house(
  model: ModelBuilder, color: string, x: number, z: number,
  width: number, depth: number, height: number, roofHeight: number,
) {
  const floor = 0.04;
  const top = floor + height;
  const front = z - depth / 2;
  const roofWidth = width + 0.038;
  const roofDepth = depth + 0.036;
  box(model, PLASTER, [x, floor + height / 2, z], [width, height, depth]);
  // Foundation, corner beams and eaves make the small facade read at board scale.
  box(model, tint(color, -0.2), [x, floor + 0.014, z], [width + 0.012, 0.028, depth + 0.012]);
  for (const dx of [-width / 2, width / 2]) {
    for (const dz of [-depth / 2, depth / 2]) {
      box(model, TIMBER, [x + dx, floor + height / 2, z + dz], [0.013, height, 0.013]);
    }
  }
  box(model, tint(color, -0.22), [x, top - 0.003, z], [roofWidth, 0.023, roofDepth]);
  model.add(pitchedRoof(roofWidth, roofHeight, roofDepth), color, [x, top - 0.002, z]);
  // Raised ridge and gable fascia are visible from the free camera's rear view too.
  box(model, tint(color, 0.14), [x, top + roofHeight, z], [0.018, 0.014, roofDepth + 0.009]);
  for (const face of [-1, 1]) {
    const faceZ = z + face * (roofDepth / 2 + 0.002);
    beam(model, tint(color, -0.33), [x - roofWidth / 2, top, faceZ], [x, top + roofHeight, faceZ], 0.007);
    beam(model, tint(color, -0.33), [x, top + roofHeight, faceZ], [x + roofWidth / 2, top, faceZ], 0.007);
  }
  // Narrow seams across the pitched surface suggest overlapping clay tiles.
  for (const side of [-1, 1]) {
    for (let row = 1; row <= 3; row++) {
      const fraction = row / 4;
      box(model, tint(color, -0.08), [x + side * roofWidth * fraction / 2, top + roofHeight * (1 - fraction) + 0.003, z],
        [0.006, 0.006, roofDepth - 0.009]);
    }
  }
  box(model, TIMBER, [x, floor + 0.053, front - 0.005], [0.049, 0.106, 0.012]);
  box(model, DARK, [x, floor + 0.05, front - 0.012], [0.035, 0.094, 0.006]);
  box(model, '#e1bd69', [x + 0.01, floor + 0.045, front - 0.017], [0.006, 0.007, 0.005]);
  box(model, STONE, [x, 0.025, front - 0.022], [0.067, 0.025, 0.041]);
  if (width > 0.15) {
    windowFront(model, x - width * 0.29, floor + height * 0.64, front - 0.008, color, 0.031);
    windowFront(model, x + width * 0.29, floor + height * 0.64, front - 0.008, color, 0.031);
  }
  windowFront(model, x, floor + height * 0.64, z + depth / 2 + 0.009, color, 0.03, 1);
  for (const side of [-1, 1]) {
    box(model, DARK, [x + side * (width / 2 + 0.005), floor + height * 0.6, z + 0.018], [0.009, 0.047, 0.037]);
    box(model, PLASTER, [x + side * (width / 2 + 0.009), floor + height * 0.6 - 0.026, z + 0.018], [0.023, 0.009, 0.052]);
  }
}

function seatMarks(model: ModelBuilder, seat: number, front: number, span: number) {
  const count = 1 + ((Math.trunc(seat) % 6) + 6) % 6;
  const step = span / 6;
  for (let index = 0; index < count; index++) {
    box(model, '#f8e9c9', [-span / 2 + step / 2 + index * step, 0.04, front], [step * 0.48, 0.015, 0.021]);
  }
}

export function createSettlementModel(color: string, city: boolean, seat: number): BufferGeometry {
  const model = new ModelBuilder();
  if (!city) {
    // A low single cottage remains unmistakably smaller than the double-tower city.
    box(model, tint(color, -0.25), [0, 0.015, 0], [0.25, 0.03, 0.218]);
    house(model, color, 0, 0, 0.197, 0.17, 0.145, 0.1);
    box(model, '#c3936c', [0.059, 0.271, 0.027], [0.029, 0.098, 0.031]);
    box(model, STONE, [0.059, 0.322, 0.027], [0.04, 0.012, 0.042]);
    box(model, DARK, [0.059, 0.329, 0.027], [0.021, 0.002, 0.022]);
    seatMarks(model, seat, -0.107, 0.175);
  } else {
    // Twin stone towers, an open gate and a rear hall create a castle silhouette.
    box(model, tint(color, -0.28), [0, 0.017, 0], [0.414, 0.034, 0.35]);
    box(model, '#d7c8a6', [0, 0.039, 0], [0.37, 0.014, 0.305]);
    const gate = new Shape();
    gate.moveTo(-0.083, 0.046);
    gate.lineTo(-0.083, 0.385);
    gate.lineTo(0.083, 0.385);
    gate.lineTo(0.083, 0.046);
    gate.lineTo(0.044, 0.046);
    gate.lineTo(0.044, 0.214);
    gate.lineTo(0, 0.267);
    gate.lineTo(-0.044, 0.214);
    gate.lineTo(-0.044, 0.046);
    gate.closePath();
    model.add(new ExtrudeGeometry(gate, { depth: 0.089, bevelEnabled: false, steps: 1 }), STONE, [0, 0, -0.126]);
    box(model, tint(color, -0.16), [0, 0.372, -0.079], [0.178, 0.027, 0.103]);
    for (const x of [-0.064, 0, 0.064]) {
      box(model, STONE, [x, 0.405, -0.079], [0.033, 0.042, 0.093]);
    }
    for (const x of [-0.026, 0, 0.026]) {
      box(model, TIMBER, [x, 0.132, -0.12], [0.006, 0.171, 0.009]);
    }
    box(model, TIMBER, [0, 0.12, -0.12], [0.081, 0.009, 0.01]);
    box(model, PLASTER, [0, 0.205, 0.067], [0.159, 0.318, 0.133]);
    box(model, tint(color, -0.18), [0, 0.36, 0.067], [0.186, 0.025, 0.164]);
    model.add(pitchedRoof(0.186, 0.119, 0.164), color, [0, 0.367, 0.067]);
    for (const side of [-1, 1]) {
      const towerX = side * 0.118;
      const towerZ = -0.027;
      const top = side < 0 ? 0.626 : 0.568;
      model.add(new CylinderGeometry(0.065, 0.072, top - 0.046, 6), STONE, [towerX, (top + 0.046) / 2, towerZ]);
      for (const y of [0.13, 0.31, top - 0.017]) {
        model.add(new CylinderGeometry(0.076, 0.076, 0.024, 6), '#e5d5b5', [towerX, y, towerZ]);
      }
      model.add(new CylinderGeometry(0.081, 0.081, 0.027, 6), tint(color, -0.16), [towerX, top, towerZ]);
      model.add(new ConeGeometry(0.087, 0.143, 6), color, [towerX, top + 0.081, towerZ]);
      box(model, DARK, [towerX, top - 0.127, towerZ - 0.065], [0.026, 0.079, 0.009]);
      box(model, DARK, [towerX, top - 0.127, towerZ + 0.065], [0.026, 0.079, 0.009]);
    }
    seatMarks(model, seat, -0.17, 0.23);
  }
  return model.build();
}

/** Local +X has length one; the instance applies only the actual edge length. */
export function createRoadModel(color: string, seat: number): BufferGeometry {
  const model = new ModelBuilder();
  const dark = tint(color, -0.3);
  for (const side of [-1, 1]) {
    box(model, dark, [0, 0.013, side * 0.035], [1, 0.025, 0.015]);
  }
  for (let index = 0; index < 7; index++) {
    const x = -0.5 + (index + 0.5) / 7;
    const y = 0.02 + (index % 2) * 0.002;
    box(model, index % 2 ? color : tint(color, 0.1), [x, y, 0], [0.135, 0.033, 0.07]);
    box(model, tint(color, 0.2), [x, y + 0.018, 0], [0.118, 0.004, 0.056]);
  }
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      model.add(new CylinderGeometry(0.009, 0.012, 0.043, 4), dark, [end * 0.48, 0.022, side * 0.0305]);
    }
  }
  const count = 1 + ((Math.trunc(seat) % 6) + 6) % 6;
  for (let index = 0; index < count; index++) {
    box(model, '#f8e9c9', [-0.32 + index * 0.125, 0.043, 0], [0.022, 0.004, 0.047]);
  }
  // Widen every cobble, curb and seat mark together without moving the X endpoints.
  return model.build().scale(1, 0.055 / 0.045, 0.15 / 0.085);
}

function boatHull(): BufferGeometry {
  const outline = [[-0.055, -0.17], [-0.083, -0.09], [-0.079, 0.085], [0, 0.19], [0.079, 0.085], [0.083, -0.09], [0.055, -0.17]];
  const vertices: number[] = [];
  const add = (...points: number[][]) => points.forEach((point) => vertices.push(...point));
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index]!;
    const b = outline[(index + 1) % outline.length]!;
    const topA = [a[0]!, 0.038, a[1]!];
    const topB = [b[0]!, 0.038, b[1]!];
    const lowerA = [a[0]! * 0.55, -0.024, a[1]! * 0.8];
    const lowerB = [b[0]! * 0.55, -0.024, b[1]! * 0.8];
    add(topA, lowerA, topB, topB, lowerA, lowerB);
    add([0, 0.038, 0], topA, topB);
    add([0, -0.024, 0], lowerB, lowerA);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function crate(model: ModelBuilder, x: number, z: number) {
  box(model, '#c49659', [x, 0.127, z], [0.076, 0.076, 0.076]);
  for (const dx of [-0.032, 0.032]) {
    box(model, TIMBER, [x + dx, 0.127, z - 0.04], [0.009, 0.073, 0.008]);
    box(model, TIMBER, [x + dx, 0.167, z], [0.009, 0.007, 0.078]);
  }
  box(model, TIMBER, [x, 0.127, z - 0.041], [0.009, 0.089, 0.009], [0, 0, -Math.PI / 4]);
}

export const HARBOR_LABEL_POSITION: Vec3 = [0, 0.205, 0.285];

export function createHarborModel(): BufferGeometry {
  const model = new ModelBuilder();
  // The inland end is at the topology edge. All scenery points toward local +Z.
  for (const x of [-0.195, 0.195]) {
    box(model, TIMBER, [x, 0.035, 0.295], [0.033, 0.04, 0.58]);
    for (const z of [0.055, 0.3, 0.555]) {
      // Square-cut timber and triangular rope sections retain their tiny silhouettes.
      model.add(new CylinderGeometry(0.022, 0.029, 0.46, 4), TIMBER, [x, -0.1, z]);
      model.add(new CylinderGeometry(0.027, 0.027, 0.013, 4), '#d1a46a', [x, 0.137, z]);
      model.add(new TorusGeometry(0.025, 0.004, 3, 6), ROPE, [x, 0.113, z], [1, 1, 1], [Math.PI / 2, 0, 0]);
    }
  }
  for (let plank = 0; plank < 12; plank++) {
    box(model, plank % 3 ? WOOD : '#c7975d', [0, 0.072, 0.025 + plank * 0.05], [0.432, 0.031, 0.047]);
  }
  // A raised trading sign clears the piling caps and remains legible at board fit.
  for (const x of [-0.13, 0.13]) {
    box(model, TIMBER, [x, 0.136, 0.285], [0.023, 0.105, 0.09]);
  }
  box(model, TIMBER, [0, 0.191, 0.285], [0.72, 0.015, 0.43]);
  box(model, '#eed9ab', [0, 0.1995, 0.285], [0.704, 0.009, 0.414]);
  crate(model, -0.122, 0.55);
  model.add(new CylinderGeometry(0.037, 0.033, 0.09, 6), '#a26e40', [0.11, 0.131, 0.55]);
  for (const y of [0.102, 0.158]) {
    model.add(new TorusGeometry(0.036, 0.004, 3, 6), DARK, [0.11, y, 0.55], [1, 1, 1], [Math.PI / 2, 0, 0]);
  }
  model.add(new TorusGeometry(0.028, 0.007, 3, 6), ROPE, [-0.1, 0.096, 0.04], [1, 1, 1], [Math.PI / 2, 0, 0]);
  // Mooring rope and a side-tied fishing boat give each harbor a maritime silhouette.
  // The ocean is at Y=-.285: submerge the keel while retaining the dock elevation.
  const boatYOffset = -0.312;
  beam(model, ROPE, [0.195, 0.113, 0.555], [0.31, 0.071 + boatYOffset, 0.71], 0.0035);
  const boatX = 0.32;
  const boatZ = 0.63;
  model.add(boatHull(), '#276d7b', [boatX, 0.022 + boatYOffset, boatZ]);
  model.add(boatHull(), '#dfc28b', [boatX, 0.029 + boatYOffset, boatZ], [0.82, 0.8, 0.94]);
  for (const z of [-0.1, 0.045]) {
    box(model, '#9b653c', [boatX, 0.069 + boatYOffset, boatZ + z], [0.13, 0.012, 0.029]);
  }
  beam(model, TIMBER, [boatX, 0.06 + boatYOffset, boatZ], [boatX, 0.535 + boatYOffset, boatZ], 0.009);
  beam(model, TIMBER, [boatX, 0.17 + boatYOffset, boatZ - 0.135], [boatX, 0.17 + boatYOffset, boatZ + 0.14], 0.005);
  // A thin closed triangular prism is visible from either camera side.
  const sail = new Shape();
  sail.moveTo(0, 0);
  sail.lineTo(0.232, 0);
  sail.lineTo(0.027, 0.315);
  sail.closePath();
  const sailGeometry = new ExtrudeGeometry(sail, { depth: 0.006, bevelEnabled: false, steps: 1 });
  model.add(sailGeometry, '#f8ebc8', [boatX - 0.003, 0.185 + boatYOffset, boatZ - 0.12], [1, 1, 1], [0, -Math.PI / 2, 0]);
  beam(model, ROPE, [boatX, 0.515 + boatYOffset, boatZ], [boatX, 0.073 + boatYOffset, boatZ + 0.175], 0.002);
  return model.build();
}

export interface DioramaHarborInstance extends InstanceTransform {
  edge: number;
  type: string;
}

/** Preserve public edge IDs while choosing the local +Z side from its adjacent hex. */
export function dioramaHarborInstances(geometry: BoardGeometry, board: PublicBoardView): DioramaHarborInstance[] {
  return harborInstances(geometry, board).map((harbor) => {
    const edge = geometry.edges[harbor.edge]!;
    const midpoint = geometryToWorld(geometry, (edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2);
    const normalX = harbor.position[0] - midpoint.x;
    const normalZ = harbor.position[2] - midpoint.z;
    const rotationY = Math.sin(harbor.rotationY) * normalX + Math.cos(harbor.rotationY) * normalZ > 0
      ? harbor.rotationY : harbor.rotationY + Math.PI;
    return { edge: harbor.edge, type: harbor.type, position: [midpoint.x, 0, midpoint.z], rotationY, scale: [1, 1, 1] };
  });
}

export function harborLabelInstances(geometry: BoardGeometry, board: PublicBoardView): DioramaHarborInstance[] {
  return dioramaHarborInstances(geometry, board).map((harbor) => {
    const [x, y, z] = HARBOR_LABEL_POSITION;
    const cos = Math.cos(harbor.rotationY);
    const sin = Math.sin(harbor.rotationY);
    return {
      ...harbor,
      position: [harbor.position[0] + cos * x + sin * z, y, harbor.position[2] - sin * x + cos * z],
      scale: [0.68, 1, 0.39],
    };
  });
}
