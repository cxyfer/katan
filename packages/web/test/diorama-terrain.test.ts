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
  return [...solids.values()].map(solid => ({
    ...solid,
    points: [...new Set([...solid.edges.keys()].flatMap(edge => edge.split('|')))].map(key => key.split(',').map(Number)),
  }));
}

function diameter(points: readonly number[][]) {
  let maximum = 0;
  for (const a of points) for (const c of points) maximum = Math.max(maximum, Math.hypot(a[0]! - c[0]!, a[1]! - c[1]!, a[2]! - c[2]!));
  return maximum;
}

describe('miniature terrain landscapes', () => {
  it.each([
    ['forest', 2400], ['fields', 3400], ['pasture', 3200], ['hills', 2400], ['mountains', 1800], ['gold', 1800], ['desert', 2200],
  ] as const)('%s stays within its triangle budget in every variant', (terrain, budget) => {
    for (let variant = 0; variant < 3; variant++) {
      const geometry = createTerrainModel(terrain, variant);
      expect(geometry.getAttribute('position').count / 3).toBeLessThanOrEqual(budget);
      geometry.dispose();
    }
  });

  it.each([
    { terrain: 'forest', detail: 'spruce tiers', paints: ['#2f5a45', '#3b6a4d', '#4b7b53', '#284f3f'], count: 48 },
    { terrain: 'forest', detail: 'broadleaf crown puffs', paints: ['#7fa35e', '#93b56a', '#6c9254', '#a6c174'], count: 16 },
    { terrain: 'forest', detail: 'sawn log ends and the stump top', paints: ['#dcbc8a'], count: 13 },
    { terrain: 'fields', detail: 'windmill sails', paints: ['#f1e6c8'], count: 4 },
    { terrain: 'fields', detail: 'stook caps', paints: ['#ecd38a'], count: 5 },
    { terrain: 'pasture', detail: 'sheep heads and legs', paints: ['#3f3a35'], count: 35 },
    { terrain: 'pasture', detail: 'fleece puffs, crowns and tails', paints: ['#faf5e6'], count: 42 },
    { terrain: 'hills', detail: 'fired bricks', paints: ['#c4724f', '#d6875f', '#b0603f', '#cf7b55'], count: 40 },
    { terrain: 'mountains', detail: 'ore cart wheels', paints: ['#2f3436'], count: 4 },
    // Fronds meet at the crown, so each palm is one connected solid.
    { terrain: 'desert', detail: 'palm crowns', paints: ['#5e8f4c', '#6fa057', '#4f7e43'], count: 2 },
    { terrain: 'forest', detail: 'moss banks', paints: ['#6f9161', '#82a06e'], count: 2 },
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

  it('keeps sheep, sails and trees at a readable miniature scale', () => {
    for (let variant = 0; variant < 3; variant++) {
      const pasture = createTerrainModel('pasture', variant);
      const bodies = paintedSolids(pasture, ['#ece6d2']);
      expect(bodies).toHaveLength(7);
      for (const body of bodies) {
        expect(diameter(body.points)).toBeGreaterThan(0.17);
        expect(diameter(body.points)).toBeLessThan(0.23);
      }
      pasture.dispose();

      const fields = createTerrainModel('fields', variant);
      for (const sail of paintedSolids(fields, ['#f1e6c8'])) expect(diameter(sail.points)).toBeCloseTo(Math.hypot(0.046, 0.16, 0.005), 5);
      expect(fields.boundingBox!.max.y).toBeGreaterThan(0.5);
      fields.dispose();

      const forest = createTerrainModel('forest', variant);
      const tiers = paintedSolids(forest, ['#2f5a45', '#3b6a4d', '#4b7b53', '#284f3f']);
      expect(Math.max(...tiers.map(tier => diameter(tier.points)))).toBeGreaterThan(0.2);
      expect(forest.boundingBox!.max.y).toBeGreaterThan(0.5);
      forest.dispose();
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

  it.each(terrains)('%s leaves shared placement lanes and the central token well clear', terrain => {
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
        tokenDistance = Math.min(tokenDistance, distanceToSegment(x, z, positions.getX(next), positions.getZ(next)));
        if (vertex % 3 === 0) {
          const ax = x;
          const az = z;
          const bx = positions.getX(vertex + 1);
          const bz = positions.getZ(vertex + 1);
          const cx = positions.getX(vertex + 2);
          const cz = positions.getZ(vertex + 2);
          const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
          const sides = [ax * bz - az * bx, bx * cz - bz * cx, cx * az - cz * ax];
          if (Math.abs(area) > 1e-12 && (sides.every(side => side >= 0) || sides.every(side => side <= 0))) tokenDistance = 0;
        }
      }
      expect(maxX, `${terrain} side boundary`).toBeLessThanOrEqual(Math.sqrt(3) * 0.86 / 2 + 0.00001);
      expect(maxDiagonal, `${terrain} sloping boundary`).toBeLessThanOrEqual(0.86001);
      expect(tokenDistance, `${terrain} complete triangle central clearance`).toBeGreaterThanOrEqual(0.29999);
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
