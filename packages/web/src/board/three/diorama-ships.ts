/**
 * Seafarers miniatures for the 3D board: a cog per player colour, the pirate
 * ship and the island-bonus token stack. Procedural geometry in the style of
 * `diorama-structures.ts` (painted boxes, cylinders and extrusions); nothing is
 * traced from official artwork. Ships float at sea level, so their placement
 * pushes coastal ships off the beach towards the water.
 */

import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Shape } from 'three';
import type { PublicBoardView } from '@katan/rules';
import { placementArrival } from '../effects.ts';
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

/**
 * 戰船：同一艘船「橫放」（船身繞龍骨轉約 70 度側躺在水面，桅杆平指向一側），船腹一排炮口與紅色三角旗，
 * 和直立的一般船一眼可分。龍骨沿用一般船的方向，所以放置用的 `shipTransform` 不變。
 */
export function createWarshipModel(color: string, seat: number): BufferGeometry {
  const model = new ModelBuilder();
  model.add(hull(0.4, 0.06, 0.13, 0.04), color, [0, 0.045, 0]);
  box(model, tint(color, -0.35), [0, 0.082, 0], [0.34, 0.012, 0.12]);
  box(model, TIMBER, [0.14, 0.1, 0], [0.07, 0.04, 0.11]);
  model.add(new CylinderGeometry(0.008, 0.01, 0.34, 6), TIMBER, [0, 0.25, 0]);
  box(model, SAIL, [0, 0.27, 0.012], [0.012, 0.15, 0.17]);
  box(model, '#b3261e', [0, 0.38, 0.02], [0.012, 0.05, 0.08]);
  // 炮口：船舷一排深色方塊加亮色邊框（側躺後朝上），船身另有一條收起的白帆，遠看也和直立的船分得開。
  for (const x of [-0.12, -0.04, 0.04, 0.12]) {
    box(model, '#f4e9c6', [x, 0.07, 0.068], [0.05, 0.044, 0.01]);
    box(model, '#1b1716', [x, 0.07, 0.074], [0.034, 0.028, 0.012]);
  }
  box(model, SAIL, [0, 0.1, -0.03], [0.3, 0.02, 0.03]);
  const count = 1 + ((Math.trunc(seat) % 6) + 6) % 6;
  for (let index = 0; index < count; index++) box(model, '#f8e9c9', [-0.1 + index * 0.04, 0.09, -0.062], [0.02, 0.012, 0.006]);
  const geometry = model.build();
  // 繞龍骨（x 軸）側躺，再抬到水面上，船舷不沉入水中。
  geometry.rotateX(Math.PI / 2 * 0.78);
  geometry.translate(0, 0.12, 0);
  return geometry;
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

/** 世外部落的禮物：立在細柱上的 VP 標記（金幣）、面朝下的發展牌、港口牌（資源色底，比率在標示牌上）。 */
export function createGiftModel(kind: 'vp' | 'devcard' | 'port', color = '#2f6d84'): BufferGeometry {
  const model = new ModelBuilder();
  // 細柱把標記抬到沙灘之上（標記原點在水面附近，沙灘頂面比水面高）。
  model.add(new CylinderGeometry(0.014, 0.018, 0.2, 6), TIMBER, [0, 0.1, 0]);
  if (kind === 'vp') {
    model.add(new CylinderGeometry(0.085, 0.085, 0.024, 18), '#b9862a', [0, 0.26, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    model.add(new CylinderGeometry(0.066, 0.066, 0.03, 18), '#f2c95a', [0, 0.26, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    model.add(new CylinderGeometry(0.03, 0.03, 0.034, 10), '#b9862a', [0, 0.26, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  } else if (kind === 'devcard') {
    box(model, '#0e2a47', [0, 0.28, 0], [0.12, 0.17, 0.022]);
    box(model, '#2e5b8c', [0, 0.28, 0.012], [0.104, 0.15, 0.006]);
    box(model, '#9dc3ea', [0, 0.28, 0.017], [0.055, 0.08, 0.004]);
  } else {
    model.add(new CylinderGeometry(0.11, 0.11, 0.016, 18), color, [0, 0.21, 0]);
    model.add(new CylinderGeometry(0.088, 0.088, 0.018, 18), '#f8f0d8', [0, 0.226, 0]);
    box(model, color, [0, 0.25, 0], [0.05, 0.04, 0.05]);
  }
  return model.build();
}

/** 禮物底座高度：高過水面，細柱立在沙灘邊（標記頂面在地形頂面之上）。 */
export const GIFT_BASE_Y = -0.15;

/** 禮物浮在海面，從陸地格往框的方向略推出（與船同一個作法）。 */
export function giftTransform(geometry: BoardGeometry, edgeIndex: number): { position: Vec3; rotationY: number } | null {
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
    x += (dx / length) * 0.17;
    z += (dz / length) * 0.17;
  }
  return { position: [x, GIFT_BASE_Y, z], rotationY: 0 };
}

/** Ships read at board scale next to the roads (their model is built at 1:1). */
export const SHIP_SCALE = 1.5;

export interface ShipInstance extends InstanceTransform {
  index: number;
  playerId: string;
  /** 海盜巢穴的戰船（橫放）。 */
  warship: boolean;
  arrivalKey: string | null;
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

export function shipInstances(geometry: BoardGeometry, board: PublicBoardView, arrivals: readonly BoardEffectGroup[], warships: Readonly<Record<string, readonly number[]>> = {}): ShipInstance[] {
  const out: ShipInstance[] = [];
  board.roads.forEach((road, index) => {
    if (!road?.ship) return;
    const transform = shipTransform(geometry, index);
    if (!transform) return;
    out.push({
      index,
      playerId: road.player,
      warship: warships[road.player]?.includes(index) ?? false,
      arrivalKey: placementArrival(arrivals, board, 'edge', index)?.id ?? null,
      position: transform.position,
      rotationY: transform.rotationY,
      scale: [SHIP_SCALE, SHIP_SCALE, SHIP_SCALE],
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

// ---------------------------------------------------------------------------
// 布匹產地的部落
// ---------------------------------------------------------------------------

/** 水中的木樁：撐起部落的數字圓片（圓片本身由 `NumberBadges` 畫在 y = 0）。 */
export function createTribePostModel(): BufferGeometry {
  const model = new ModelBuilder();
  const height = -SEA_LEVEL - 0.03;
  model.add(new CylinderGeometry(0.035, 0.045, height, 8), TIMBER, [0, -height / 2 - 0.03, 0]);
  model.add(new CylinderGeometry(0.15, 0.15, 0.02, 14), '#8a5a32', [0, -0.03, 0]);
  return model.build();
}

/** 一疊布匹：木托盤上橫放的布捲，數量 0–5（底層最多 3 捲，其上 2 捲）。 */
export function createClothStackModel(count: number): BufferGeometry {
  const model = new ModelBuilder();
  box(model, '#6b442c', [0, 0.012, 0], [0.4, 0.024, 0.26]);
  const rows: [number, number, number][] = [[-0.12, 0, 0], [0, 0, 0], [0.12, 0, 0], [-0.06, 0.1, 0], [0.06, 0.1, 0]];
  rows.slice(0, Math.max(0, Math.min(5, count))).forEach(([x, y], index) => {
    model.add(new CylinderGeometry(0.052, 0.052, 0.22, 10), index % 2 === 0 ? '#e9d8b0' : '#d9c28f', [x, 0.085 + y, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    model.add(new CylinderGeometry(0.054, 0.054, 0.05, 10), '#b8472f', [x, 0.085 + y, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  });
  return model.build();
}

/** 與部落建立貿易關係的玩家標記：玩家色的小木樁。 */
export function createLinkPinModel(color: string): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.035, 0.045, 0.1, 8), color, [0, 0.05, 0]);
  model.add(new CylinderGeometry(0.05, 0.05, 0.02, 8), tint(color, 0.3), [0, 0.11, 0]);
  return model.build();
}

/** 部落所在頂點的世界座標，以及從小島格往外（海的方向）的單位向量。 */
export function tribeSpot(geometry: BoardGeometry, vertexIndex: number): { x: number; z: number; outX: number; outZ: number } | null {
  const vertex = geometry.vertices[vertexIndex];
  const info = geometry.topology.vertices[vertexIndex];
  if (!vertex || !info) return null;
  const scale = geometry.scale;
  const x = vertex.x / scale;
  const z = vertex.y / scale;
  const land = info.hexes.find((hex) => geometry.land[hex] !== false);
  const hex = land === undefined ? undefined : geometry.hexes[land];
  if (!hex) return { x, z, outX: 0, outZ: -1 };
  const dx = x - hex.cx / scale;
  const dz = z - hex.cy / scale;
  const length = Math.hypot(dx, dz) || 1;
  return { x, z, outX: dx / length, outZ: dz / length };
}

/** 部落圓片（數字）在 3D 場景中的位置：頂點上、水中木樁頂端。 */
export function tribeNumberTokens(geometry: BoardGeometry, tribes: readonly { vertex: number; number: number }[] | undefined): { index: number; value: number; position: Vec3; rotationY: number; scale: Vec3 }[] {
  return (tribes ?? []).flatMap((tribe) => {
    const spot = tribeSpot(geometry, tribe.vertex);
    return spot ? [{ index: -1, value: tribe.number, position: [spot.x, 0, spot.z] as Vec3, rotationY: 0, scale: [0.5, 1, 0.5] as Vec3 }] : [];
  });
}

/**
 * 卡坦奇觀的地圖標記：立在頂點旁的細柱，柱頂是棕色牆塊（Great Wall）、紫色拱橋（Great Bridge）
 * 或紅色交叉木條（X，設置禁設點）。三種形狀不同，不只靠顏色。
 */
export function createWonderMarkerModel(kind: 'greatWall' | 'greatBridge' | 'x'): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.016, 0.02, 0.22, 6), TIMBER, [0, 0.11, 0]);
  if (kind === 'greatWall') {
    box(model, '#8a5a32', [0, 0.27, 0], [0.16, 0.1, 0.07]);
    box(model, '#b98450', [-0.055, 0.34, 0], [0.04, 0.05, 0.07]);
    box(model, '#b98450', [0.055, 0.34, 0], [0.04, 0.05, 0.07]);
  } else if (kind === 'greatBridge') {
    box(model, '#7a4fb0', [0, 0.25, 0], [0.18, 0.03, 0.08]);
    box(model, '#9a73d0', [-0.075, 0.29, 0], [0.03, 0.06, 0.08]);
    box(model, '#9a73d0', [0.075, 0.29, 0], [0.03, 0.06, 0.08]);
    box(model, '#7a4fb0', [0, 0.31, 0], [0.18, 0.025, 0.08]);
  } else {
    model.add(new BoxGeometry(0.2, 0.035, 0.035), '#c2281a', [0, 0.3, 0], [1, 1, 1], [0, 0, Math.PI / 4]);
    model.add(new BoxGeometry(0.2, 0.035, 0.035), '#c2281a', [0, 0.3, 0], [1, 1, 1], [0, 0, -Math.PI / 4]);
  }
  return model.build();
}
