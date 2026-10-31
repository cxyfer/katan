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

/** Deterministic scenery variation; never consumes game randomness. */
export function sceneryRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
