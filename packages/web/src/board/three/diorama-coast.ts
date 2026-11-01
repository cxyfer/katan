import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  IcosahedronGeometry,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import type { BoardGeometry, Point } from '../geometry.ts';
import { coastLoops, distanceToLoop, insideLoop, offsetLoop, smoothLoop } from '../coastline.ts';
import { ModelBuilder, PaintedMesh, sceneryRandom, valueNoise } from './diorama-geometry.ts';
import type { Vec3 } from './transforms.ts';

/** The water plane height; the beach dips just below it so the waterline is clean. */
export const SEA_LEVEL = -0.285;

/**
 * Beach profile from inside the tile rim down below the waterline:
 * [outward offset, height, paint]. The first ring hides under the tile cap.
 */
const BEACH_PROFILE: readonly (readonly [number, number, string])[] = [
  [-0.06, -0.045, '#cdb07a'],
  [0.07, -0.075, '#ead6a4'],
  [0.17, -0.14, '#e3cb93'],
  [0.27, -0.235, '#cfb27c'],
  [0.36, -0.315, '#a99068'],
];

/** The surf line the ocean shader measures distance from. */
export const WATERLINE_OFFSET = 0.31;
/** Encoded range of the shoreline distance field, in hex radii. */
export const SHORE_DISTANCE_RANGE = 3;

function beachHeight(offset: number): number {
  for (let index = 1; index < BEACH_PROFILE.length; index++) {
    const [d1, y1] = BEACH_PROFILE[index]!;
    const [d0, y0] = BEACH_PROFILE[index - 1]!;
    if (offset <= d1) return y0 + (y1 - y0) * Math.max(0, (offset - d0) / (d1 - d0));
  }
  return BEACH_PROFILE.at(-1)![1];
}

/** Continuous sand skirt around every island loop, with soft painted variation. */
export function createBeachModel(geometry: BoardGeometry): BufferGeometry {
  const builder = new ModelBuilder();
  const noise = valueNoise(1931);
  for (const loop of coastLoops(geometry.topology)) {
    const rings = BEACH_PROFILE.map(([offset, y, paint]) => ({
      points: smoothLoop(offsetLoop(loop, offset), 2), y, paint: new Color(paint),
    }));
    const mesh = new PaintedMesh();
    const tint = (ring: (typeof rings)[number], point: Point) => {
      const grain = noise(point.x * 3.1, point.y * 3.1) * 0.7 + noise(point.x * 9, point.y * 9) * 0.3;
      return ring.paint.clone().multiplyScalar(0.93 + grain * 0.12);
    };
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const inner = rings[ring]!;
      const outer = rings[ring + 1]!;
      const count = inner.points.length;
      for (let index = 0; index < count; index++) {
        const next = (index + 1) % count;
        const a = inner.points[index]!;
        const b = inner.points[next]!;
        const c = outer.points[index]!;
        const d = outer.points[next]!;
        const at = (point: Point, y: number): Vec3 => [point.x, y, point.y];
        // Counter-clockwise loops put the sea on the right; this winding faces up.
        mesh.shaded(at(a, inner.y), at(b, inner.y), at(c, outer.y), [tint(inner, a), tint(inner, b), tint(outer, c)]);
        mesh.shaded(at(b, inner.y), at(d, outer.y), at(c, outer.y), [tint(inner, b), tint(outer, d), tint(outer, c)]);
      }
    }
    builder.addPainted(mesh.geometry());
  }
  return builder.build();
}

function rock(builder: ModelBuilder, random: () => number, point: Point, offset: number, size: number) {
  const color = ['#8c8a76', '#a29778', '#77806f', '#b3a888'][Math.floor(random() * 4)]!;
  builder.add(new IcosahedronGeometry(1, 0), color, [point.x, beachHeight(offset) + size * 0.25, point.y],
    [size * 1.4, size * 0.8, size], [random() * 0.6, random() * 3, random() * 0.6]);
}

/** Rocks, dune grass and driftwood along the dry sand, deterministic per topology. */
export function createShoreScatterModel(geometry: BoardGeometry): BufferGeometry {
  const builder = new ModelBuilder();
  const random = sceneryRandom(84621);
  for (const loop of coastLoops(geometry.topology)) {
    const count = loop.points.length;
    for (let index = 0; index < count; index++) {
      const a = loop.points[index]!;
      const b = loop.points[(index + 1) % count]!;
      const ma = loop.miters[index]!;
      const mb = loop.miters[(index + 1) % count]!;
      const along = (t: number, offset: number): Point => ({
        x: a.x + (b.x - a.x) * t + (ma.x + (mb.x - ma.x) * t) * offset,
        y: a.y + (b.y - a.y) * t + (ma.y + (mb.y - ma.y) * t) * offset,
      });
      // A cluster of boulders where the surf meets the sand.
      const cluster = 0.2 + random() * 0.6;
      for (let stone = 0; stone < 3; stone++) {
        const offset = 0.2 + random() * 0.12;
        rock(builder, random, along(cluster + (random() - 0.5) * 0.16, offset), offset, 0.035 + random() * 0.04);
      }
      // Pebbles scattered over the dry beach.
      for (let pebble = 0; pebble < 2; pebble++) {
        const offset = 0.04 + random() * 0.14;
        rock(builder, random, along(random(), offset), offset, 0.014 + random() * 0.012);
      }
      // Dune grass tufts on alternating edges, close to the tile rim.
      if (index % 2 === 0) {
        const t = 0.25 + random() * 0.5;
        const offset = 0.05 + random() * 0.04;
        const at = along(t, offset);
        for (let blade = 0; blade < 4; blade++) {
          const lean = (blade - 1.5) * 0.35;
          builder.add(new CylinderGeometry(0, 0.009, 0.075, 3), blade % 2 ? '#8ea05e' : '#a7b26b',
            [at.x + Math.cos(blade * 1.7) * 0.012, beachHeight(offset) + 0.03, at.y + Math.sin(blade * 1.7) * 0.012],
            [1, 1, 1], [lean * 0.5, blade, lean]);
        }
      }
      if (index % 7 === 3) {
        const at = along(0.5, 0.13);
        builder.add(new CylinderGeometry(0.012, 0.015, 0.2, 5), '#b9a48a',
          [at.x, beachHeight(0.13) + 0.012, at.y], [1, 1, 1], [Math.PI / 2, 0, index]);
      }
    }
  }
  return builder.build();
}

export interface ShoreField {
  texture: DataTexture;
  /** World-space XZ rectangle covered by the texture. */
  min: Point;
  max: Point;
}

/**
 * Bake distance-to-surf into a small texture so the ocean shader can paint
 * shallows, a surf line and deep water without per-fragment polygon math.
 */
export function createShoreField(geometry: BoardGeometry, resolution = 160): ShoreField {
  const loops = coastLoops(geometry.topology).map((loop) => smoothLoop(offsetLoop(loop, WATERLINE_OFFSET), 2));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of loops) for (const point of loop) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  const margin = SHORE_DISTANCE_RANGE;
  const min = { x: minX - margin, y: minY - margin };
  const max = { x: maxX + margin, y: maxY + margin };
  const data = new Uint8Array(resolution * resolution * 4);
  for (let row = 0; row < resolution; row++) {
    for (let column = 0; column < resolution; column++) {
      const x = min.x + (max.x - min.x) * (column + 0.5) / resolution;
      const y = min.y + (max.y - min.y) * (row + 0.5) / resolution;
      let distance = SHORE_DISTANCE_RANGE;
      for (const loop of loops) {
        distance = insideLoop(loop, x, y) ? 0 : Math.min(distance, distanceToLoop(loop, x, y));
        if (distance === 0) break;
      }
      const value = Math.round(Math.min(1, distance / SHORE_DISTANCE_RANGE) * 255);
      const offset = (row * resolution + column) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(data, resolution, resolution, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, min, max };
}
