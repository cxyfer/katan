/**
 * The Pirate Islands（海盜巢穴）的 3D 小模型：堡壘下的 pirate lair 疊（每枚一個深色骷髏牌）、
 * beachhead 標記（玩家色圓片加小旗）、船線目標環與航道標記。與 `diorama-ships.ts` 同一套程序化風格，
 * 沒有任何描摹官方美術的部分。
 */

import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, TorusGeometry } from 'three';
import type { BoardGeometry } from '../geometry.ts';
import { ModelBuilder } from './diorama-geometry.ts';
import type { Vec3 } from './transforms.ts';

const BONE = '#efe6cf';
const IRON = '#2a2523';

function tint(color: string, amount: number): string {
  return `#${new Color(color).lerp(new Color(amount > 0 ? '#fff0ce' : '#212e32'), Math.abs(amount)).getHexString()}`;
}

/** 疊在堡壘旁的 pirate lair：木樁上的深色圓牌，數量 1–3（每枚一層，頂端畫骷髏）。 */
export function createLairStackModel(count: number): BufferGeometry {
  const model = new ModelBuilder();
  const layers = Math.max(1, Math.min(3, count));
  model.add(new CylinderGeometry(0.17, 0.19, 0.02, 14), '#6b442c', [0, 0.01, 0]);
  for (let index = 0; index < layers; index++) {
    model.add(new CylinderGeometry(0.13, 0.14, 0.05, 14), index % 2 === 0 ? IRON : '#3c3634', [0, 0.045 + index * 0.055, 0]);
    model.add(new CylinderGeometry(0.135, 0.135, 0.008, 14), '#c9a14a', [0, 0.073 + index * 0.055, 0]);
  }
  const top = 0.1 + layers * 0.055;
  // 頂端的骷髏：圓頭、兩個眼窩與交叉的骨。
  model.add(new CylinderGeometry(0.045, 0.045, 0.03, 10), BONE, [0, top + 0.02, 0]);
  model.add(new BoxGeometry(0.014, 0.012, 0.014), IRON, [-0.016, top + 0.038, 0.03]);
  model.add(new BoxGeometry(0.014, 0.012, 0.014), IRON, [0.016, top + 0.038, 0.03]);
  model.add(new BoxGeometry(0.15, 0.012, 0.022), BONE, [0, top + 0.004, 0.0], [1, 1, 1], [0, 0.6, 0]);
  model.add(new BoxGeometry(0.15, 0.012, 0.022), BONE, [0, top + 0.004, 0.0], [1, 1, 1], [0, -0.6, 0]);
  return model.build();
}

/** beachhead marker：貼地的玩家色圓片（白色內圈）加一支小旗。 */
export function createBeachheadModel(color: string): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.15, 0.15, 0.014, 18), tint(color, -0.45), [0, 0.007, 0]);
  model.add(new CylinderGeometry(0.125, 0.125, 0.018, 18), color, [0, 0.012, 0]);
  model.add(new CylinderGeometry(0.06, 0.06, 0.02, 18), '#fff6dd', [0, 0.016, 0]);
  model.add(new CylinderGeometry(0.01, 0.012, 0.2, 6), '#6b442c', [0.08, 0.11, 0]);
  model.add(new BoxGeometry(0.09, 0.055, 0.008), color, [0.125, 0.18, 0]);
  return model.build();
}

/** 船線下一個目標的提示環：平放在目標頂點上的細環。 */
export function createTargetRingModel(): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new TorusGeometry(0.2, 0.014, 6, 28), '#ffd45c', [0, 0.04, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  return model.build();
}

/** 航道上的標記：水面上的小圓點，起點稍大。 */
export function createRouteMarkModel(): BufferGeometry {
  const model = new ModelBuilder();
  model.add(new CylinderGeometry(0.06, 0.06, 0.008, 12), '#f4e9c6', [0, 0.004, 0]);
  return model.build();
}

/** 堡壘旁的 lair 疊位置：從頂點往陸地（碰到的陸地格中心）退一點，落在陸地上。 */
export function lairSpot(geometry: BoardGeometry, vertexIndex: number): Vec3 | null {
  const vertex = geometry.vertices[vertexIndex];
  const info = geometry.topology.vertices[vertexIndex];
  if (!vertex || !info) return null;
  const scale = geometry.scale;
  const x = vertex.x / scale;
  const z = vertex.y / scale;
  const land = info.hexes.find((hex) => geometry.land[hex] !== false);
  const hex = land === undefined ? undefined : geometry.hexes[land];
  if (!hex) return [x, 0.005, z];
  const dx = hex.cx / scale - x;
  const dz = hex.cy / scale - z;
  const length = Math.hypot(dx, dz) || 1;
  // 先往陸地中心 0.3，再往側邊挪，避開建築。
  return [x + (dx / length) * 0.3 - (dz / length) * 0.1, 0.005, z + (dz / length) * 0.3 + (dx / length) * 0.1];
}

/** 頂點的世界座標（標記貼在地面）。 */
export function vertexSpot(geometry: BoardGeometry, vertexIndex: number): Vec3 | null {
  const vertex = geometry.vertices[vertexIndex];
  if (!vertex) return null;
  return [vertex.x / geometry.scale, 0.002, vertex.y / geometry.scale];
}
