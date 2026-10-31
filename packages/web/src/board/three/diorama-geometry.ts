import { useEffect, useMemo } from 'react';
import {
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec3 } from './transforms.ts';

/** Bake miniature parts into one colored draw call; add() takes ownership. */
export class ModelBuilder {
  private readonly parts: BufferGeometry[] = [];

  add(
    source: BufferGeometry,
    color: string,
    position: Vec3 = [0, 0, 0],
    scale: Vec3 = [1, 1, 1],
    rotation: Vec3 = [0, 0, 0],
  ): this {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    for (const key of Object.keys(geometry.attributes)) {
      if (key !== 'position' && key !== 'normal') geometry.deleteAttribute(key);
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.applyMatrix4(new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromEuler(new Euler(...rotation)),
      new Vector3(...scale),
    ));
    const tint = new Color(color);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) tint.toArray(colors, index * 3);
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.parts.push(geometry);
    return this;
  }

  /** Like add(), but keeps the source's own per-vertex `color` attribute. */
  addPainted(source: BufferGeometry, position: Vec3 = [0, 0, 0]): this {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    for (const key of Object.keys(geometry.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'color') geometry.deleteAttribute(key);
    }
    if (!geometry.getAttribute('color')) throw new Error('addPainted needs a color attribute');
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.translate(...position);
    this.parts.push(geometry);
    return this;
  }

  build(): BufferGeometry {
    if (!this.parts.length) throw new Error('A diorama model needs geometry');
    const geometry = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    if (!geometry) throw new Error('Diorama geometry attributes must match');
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Deferred release preserves resources across React's StrictMode effect replay. */
export function useDioramaGeometry(factory: () => BufferGeometry, dependencies: readonly unknown[]): BufferGeometry {
  const lease = useMemo(() => ({ geometry: factory(), references: 0 }), dependencies);
  useEffect(() => {
    lease.references++;
    return () => {
      lease.references--;
      queueMicrotask(() => {
        if (!lease.references) lease.geometry.dispose();
      });
    };
  }, [lease]);
  return lease.geometry;
}

/** Triangle soup with one flat color per face, for faceted multi-tone models. */
export class PaintedMesh {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly scratch = new Color();

  face(a: Vec3, b: Vec3, c: Vec3, color: string | Color): this {
    const tint = typeof color === 'string' ? this.scratch.set(color) : color;
    this.positions.push(...a, ...b, ...c);
    for (let corner = 0; corner < 3; corner++) this.colors.push(tint.r, tint.g, tint.b);
    return this;
  }

  /** Per-corner colors blend across the face. */
  shaded(a: Vec3, b: Vec3, c: Vec3, colors: readonly [Color, Color, Color]): this {
    this.positions.push(...a, ...b, ...c);
    for (const tint of colors) this.colors.push(tint.r, tint.g, tint.b);
    return this;
  }

  get empty(): boolean {
    return this.positions.length === 0;
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

/** Wind a face so its normal points away from `center`. */
export function outwardFace(mesh: PaintedMesh, a: Vec3, b: Vec3, c: Vec3, color: string, center: Vec3) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const dx = (a[0] + b[0] + c[0]) / 3 - center[0];
  const dy = (a[1] + b[1] + c[1]) / 3 - center[1];
  const dz = (a[2] + b[2] + c[2]) / 3 - center[2];
  if (nx * dx + ny * dy + nz * dz >= 0) mesh.face(a, b, c, color);
  else mesh.face(a, c, b, color);
}

/** Smooth deterministic value noise in [0, 1] for procedural paint and relief. */
export function valueNoise(seed: number): (x: number, y: number) => number {
  const hash = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * sx;
    const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

/** Deterministic scenery variation; never consumes game randomness. */
export function sceneryRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
