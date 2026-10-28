import { createHash } from 'node:crypto';
import { Color, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createTerrainModel } from '../src/board/three/diorama-terrain.ts';

const terrains = ['forest', 'mountains', 'hills', 'fields', 'pasture', 'desert', 'gold', 'sea'];

function attributeHash(array: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) {
  return createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
}

function distanceToSegment(ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / lengthSquared)) : 0;
  return Math.hypot(ax + t * dx, az + t * dz);
}

/** Inspect independently connected painted solids after all parts are baked. */
function paintedSolids(geometry: BufferGeometry, paints: readonly string[]) {
  const palette = paints.map(paint => new Color(paint));
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const owners = new Map<string, number>();
  const parents: number[] = [];
  const faces: { keys: string[]; volume: number }[] = [];
  const root = (index: number): number => parents[index] === index ? index : (parents[index] = root(parents[index]!));
  for (let vertex = 0; vertex < positions.count; vertex += 3) {
    if (!palette.some(color => Math.abs(color.r - colors.getX(vertex)) < 1e-7 && Math.abs(color.g - colors.getY(vertex)) < 1e-7 && Math.abs(color.b - colors.getZ(vertex)) < 1e-7)) continue;
    const points = [0, 1, 2].map(offset => [positions.getX(vertex + offset), positions.getY(vertex + offset), positions.getZ(vertex + offset)] as const);
    const keys = points.map(point => point.map(value => value.toFixed(6)).join(','));
    const index = faces.length;
    parents.push(index);
    for (const key of keys) {
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, index);
      else parents[root(index)] = root(owner);
    }
    const [a, b, c] = points as [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
    const volume = (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    faces.push({ keys, volume });
  }
  const solids = new Map<number, { edges: Map<string, number>; volume: number }>();
  faces.forEach((face, index) => {
    const id = root(index);
    let solid = solids.get(id);
    if (!solid) { solid = { edges: new Map(), volume: 0 }; solids.set(id, solid); }
    solid.volume += face.volume;
    face.keys.forEach((key, edge) => {
      const endpoint = face.keys[(edge + 1) % 3]!;
      const edgeKey = [key, endpoint].sort().join('|');
      solid.edges.set(edgeKey, (solid.edges.get(edgeKey) ?? 0) + 1);
    });
  });
  return [...solids.values()];
}

describe('miniature terrain landscapes', () => {
  it.each([['fields', 2400], ['forest', 1700], ['pasture', 1600]] as const)('%s stays within its triangle budget in every variant', (terrain, budget) => {
    for (let variant = 0; variant < 3; variant++) {
      const geometry = createTerrainModel(terrain, variant);
      expect(geometry.getAttribute('position').count / 3).toBeLessThanOrEqual(budget);
      geometry.dispose();
    }
  });

  it.each([
    { terrain: 'fields', detail: 'grain heads', paints: ['#e7c975', '#edce81', '#d7b45c'], count: 140 },
    { terrain: 'fields', detail: 'wheat stems', paints: ['#d0ae58'], count: 140 },
    { terrain: 'fields', detail: 'wheat leaves', paints: ['#c6ab61'], count: 140 },
    { terrain: 'forest', detail: 'layered conifer crowns', paints: ['#426b51', '#577b58', '#6c8b61', '#385c4a'], count: 44 },
    { terrain: 'forest', detail: 'broadleaf crowns', paints: ['#8ba36b', '#9bb77b', '#719564', '#a8bc80'], count: 8 },
    { terrain: 'pasture', detail: 'sheep heads', paints: ['#665e52'], count: 5 },
    { terrain: 'pasture', detail: 'sheep ears', paints: ['#8d8170'], count: 10 },
    { terrain: 'pasture', detail: 'sheep legs', paints: ['#675c4e'], count: 20 },
    { terrain: 'pasture', detail: 'wool tufts', paints: ['#f4eddb'], count: 25 },
    { terrain: 'pasture', detail: 'flowers', paints: ['#eee5b4', '#cda09d'], count: 24 },
  ])('$terrain keeps all $count $detail as closed volumes', ({ terrain, paints, count }) => {
    for (let variant = 0; variant < 3; variant++) {
      const geometry = createTerrainModel(terrain, variant);
      const solids = paintedSolids(geometry, paints);
      expect(solids).toHaveLength(count);
      for (const solid of solids) {
        expect([...solid.edges.values()].every(incidence => incidence === 2)).toBe(true);
        expect(solid.volume).toBeGreaterThan(1e-10);
      }
      geometry.dispose();
    }
  });

  it.each(terrains)('%s has finite, colored geometry above the tile and below the camera envelope', terrain => {
    for (let variant = 0; variant < 3; variant++) {
      const geometry = createTerrainModel(terrain, variant);
      const positions = geometry.getAttribute('position');
      const colors = geometry.getAttribute('color');
      const normals = geometry.getAttribute('normal');
      expect(positions.count).toBeGreaterThan(300);
      expect(positions.count % 3).toBe(0);
      expect(colors.count).toBe(positions.count);
      expect(normals.count).toBe(positions.count);
      for (const attribute of [positions, normals, colors]) expect(attribute.array.every(Number.isFinite)).toBe(true);
      expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.00001);
      expect(geometry.boundingBox!.max.y).toBeLessThanOrEqual(0.82);
      expect(geometry.boundingBox!.max.y).toBeGreaterThan(0.025);
      geometry.dispose();
    }
  });

  it.each(terrains)('%s leaves shared placement lanes and the front token clear', terrain => {
    for (let variant = 0; variant < 3; variant++) {
      const geometry = createTerrainModel(terrain, variant);
      const positions = geometry.getAttribute('position');
      let maxX = 0;
      let maxDiagonal = 0;
      let tokenDistance = Infinity;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = positions.getX(vertex);
        const z = positions.getZ(vertex);
        maxX = Math.max(maxX, Math.abs(x));
        maxDiagonal = Math.max(maxDiagonal, Math.abs(z) + Math.abs(x) / Math.sqrt(3));
        const next = vertex % 3 === 2 ? vertex - 2 : vertex + 1;
        tokenDistance = Math.min(tokenDistance, distanceToSegment(x, z - 0.34, positions.getX(next), positions.getZ(next) - 0.34));
        if (vertex % 3 === 0) {
          const ax = x;
          const az = z - 0.34;
          const bx = positions.getX(vertex + 1);
          const bz = positions.getZ(vertex + 1) - 0.34;
          const cx = positions.getX(vertex + 2);
          const cz = positions.getZ(vertex + 2) - 0.34;
          const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
          const sides = [ax * bz - az * bx, bx * cz - bz * cx, cx * az - cz * ax];
          if (Math.abs(area) > 1e-12 && (sides.every(side => side >= 0) || sides.every(side => side <= 0))) tokenDistance = 0;
        }
      }
      expect(maxX, `${terrain} side boundary`).toBeLessThanOrEqual(Math.sqrt(3) * 0.86 / 2 + 0.00001);
      expect(maxDiagonal, `${terrain} sloping boundary`).toBeLessThanOrEqual(0.86001);
      expect(tokenDistance, `${terrain} complete triangle token clearance`).toBeGreaterThanOrEqual(0.23999);
      geometry.dispose();
    }
  });

  it.each(terrains)('%s reproduces geometry and paint without depending on game randomness', terrain => {
    const a = createTerrainModel(terrain, 1);
    const b = createTerrainModel(terrain, 1);
    const wrapped = createTerrainModel(terrain, 4);
    for (const name of ['position', 'normal', 'color']) {
      expect(attributeHash(a.getAttribute(name).array)).toEqual(attributeHash(b.getAttribute(name).array));
      expect(attributeHash(a.getAttribute(name).array)).toEqual(attributeHash(wrapped.getAttribute(name).array));
    }
    a.dispose(); b.dispose(); wrapped.dispose();
  });

  it('gives each resource a different silhouette and several painted materials', () => {
    const signatures = new Set<string>();
    for (const terrain of terrains) {
      const geometry = createTerrainModel(terrain);
      const color = geometry.getAttribute('color');
      const palette = new Set<string>();
      for (let vertex = 0; vertex < color.count; vertex++) palette.add(`${color.getX(vertex)},${color.getY(vertex)},${color.getZ(vertex)}`);
      expect(palette.size).toBeGreaterThanOrEqual(2);
      const size = geometry.boundingBox!;
      signatures.add(`${geometry.getAttribute('position').count}:${size.max.y}:${size.max.x - size.min.x}`);
      geometry.dispose();
    }
    expect(signatures.size).toBe(terrains.length);
  });
});
