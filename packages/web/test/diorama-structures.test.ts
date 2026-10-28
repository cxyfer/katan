import { Color, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { fixedBoard } from '../src/test/fixtures.ts';
import { geometryToWorld } from '../src/board/three/bounds.ts';
import {
  createHarborModel,
  createRoadModel,
  createSettlementModel,
  dioramaHarborInstances,
  harborLabelInstances,
} from '../src/board/three/diorama-structures.ts';
import { finiteTransform, instanceMatrix } from '../src/board/three/transforms.ts';

function validateModel(model: BufferGeometry) {
  const positions = model.getAttribute('position');
  const colors = model.getAttribute('color');
  const normals = model.getAttribute('normal');
  expect(positions.count).toBeGreaterThan(200);
  expect(colors.count).toBe(positions.count);
  expect(normals.count).toBe(positions.count);
  for (const attribute of [positions, colors, normals]) {
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  }
  expect(model.groups).toHaveLength(0);
  model.computeBoundingBox();
  expect(model.boundingBox!.isEmpty()).toBe(false);

  // Position-welded triangle edges must close even though parts have split normals.
  const edges = new Map<string, number>();
  const key = (index: number) => [positions.getX(index), positions.getY(index), positions.getZ(index)]
    .map((value) => Math.round(value * 1e6)).join(',');
  for (let index = 0; index < positions.count; index += 3) {
    const triangle = [key(index), key(index + 1), key(index + 2)];
    for (let side = 0; side < 3; side++) {
      const a = triangle[side]!;
      const b = triangle[(side + 1) % 3]!;
      if (a === b) continue;
      const edge = [a, b].sort().join(':');
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every((count) => count % 2 === 0)).toBe(true);
  return model.boundingBox!;
}

function coloredVerticesAbove(model: BufferGeometry, color: string, height: number): number {
  const expected = new Color(color);
  const positions = model.getAttribute('position');
  const colors = model.getAttribute('color');
  let count = 0;
  for (let index = 0; index < positions.count; index++) {
    if (positions.getY(index) < height) continue;
    if (Math.abs(colors.getX(index) - expected.r) < 1e-6 &&
        Math.abs(colors.getY(index) - expected.g) < 1e-6 &&
        Math.abs(colors.getZ(index) - expected.b) < 1e-6) count++;
  }
  return count;
}

describe('baked architectural miniatures', () => {
  it('settlements have closed cream walls, player-colored pitched roofs and a tall chimney', () => {
    const model = createSettlementModel('#c0392b', false, 0);
    const bounds = validateModel(model);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(0.29);
    expect(bounds.max.z - bounds.min.z).toBeLessThan(0.26);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
    expect(bounds.max.y).toBeGreaterThan(0.4);
    expect(bounds.max.y).toBeLessThan(0.45);
    expect(coloredVerticesAbove(model, '#c0392b', 0.29)).toBeGreaterThan(0);
    expect(coloredVerticesAbove(model, '#f4dfb5', 0.12)).toBeGreaterThan(10);
    expect(coloredVerticesAbove(model, '#263b3d', 0.12)).toBeGreaterThan(10);
    model.dispose();
  });

  it('cities use a wider courtyard and a distinct keep above the houses', () => {
    const settlement = createSettlementModel('#2c6fb5', false, 2);
    const city = createSettlementModel('#2c6fb5', true, 2);
    const bounds = validateModel(city);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(0.43);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(0.39);
    expect(bounds.max.y).toBeGreaterThan(0.52);
    expect(bounds.max.y).toBeLessThan(0.58);
    expect(city.getAttribute('position').count).toBeGreaterThan(settlement.getAttribute('position').count * 1.6);
    expect(coloredVerticesAbove(city, '#c2c4ae', 0.4)).toBeGreaterThan(0);
    expect(coloredVerticesAbove(city, '#2c6fb5', 0.48)).toBeGreaterThan(0);
    settlement.dispose();
    city.dispose();
  });

  it('bakes deterministic complete pieces with geometric seat cues independent of tint', () => {
    for (const city of [false, true]) {
      const first = createSettlementModel('#ffffff', city, 0);
      const repeated = createSettlementModel('#ffffff', city, 0);
      const sixth = createSettlementModel('#ffffff', city, 5);
      expect(repeated.getAttribute('position').array).toEqual(first.getAttribute('position').array);
      expect(repeated.getAttribute('color').array).toEqual(first.getAttribute('color').array);
      expect(sixth.getAttribute('position').count).toBeGreaterThan(first.getAttribute('position').count);
      for (const model of [first, repeated, sixth]) model.dispose();
    }
  });

  it('roads remain one unit along +X and fit the topology lane with raised seat marks', () => {
    const first = createRoadModel('#d97b1f', 0);
    const sixth = createRoadModel('#d97b1f', 5);
    const bounds = validateModel(first);
    expect(bounds.min.x).toBeCloseTo(-0.5, 6);
    expect(bounds.max.x).toBeCloseTo(0.5, 6);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.085, 6);
    expect(bounds.max.y).toBeCloseTo(0.045, 6);
    expect(sixth.getAttribute('position').count).toBeGreaterThan(first.getAttribute('position').count);
    first.dispose();
    sixth.dispose();
  });

  it('harbors include a closed shallow hull, pier pilings, deck cargo and a cream sail', () => {
    const model = createHarborModel();
    const bounds = validateModel(model);
    expect(model.getAttribute('position').count / 3).toBeLessThanOrEqual(1_000);
    expect(bounds.max.z).toBeLessThanOrEqual(0.85);
    expect(bounds.min.z).toBeGreaterThanOrEqual(0);
    expect(bounds.min.y).toBeLessThan(-0.31);
    expect(bounds.max.y).toBeGreaterThan(0.2);
    expect(bounds.max.y).toBeLessThanOrEqual(0.55);
    expect(coloredVerticesAbove(model, '#f8ebc8', 0.15)).toBeGreaterThan(0);
    expect(coloredVerticesAbove(model, '#c49659', 0.15)).toBeGreaterThan(0);
    const positions = model.getAttribute('position');
    const colors = model.getAttribute('color');
    const hull = new Color('#276d7b');
    const hullY = Array.from({ length: positions.count }, (_, index) => index)
      .filter((index) => Math.abs(colors.getX(index) - hull.r) < 1e-6 &&
        Math.abs(colors.getY(index) - hull.g) < 1e-6 && Math.abs(colors.getZ(index) - hull.b) < 1e-6)
      .map((index) => positions.getY(index));
    // The actual ocean plane must intersect the hull, rather than sit below it.
    expect(Math.min(...hullY)).toBeLessThan(-0.285);
    expect(Math.max(...hullY)).toBeGreaterThan(-0.285);
    expect(Math.max(...hullY)).toBeLessThan(-0.24);
    expect(coloredVerticesAbove(model, '#eed9ab', 0.15)).toBeGreaterThan(0);
    model.dispose();
  });

  it.each(['hex-r2', 'hex-r56'])('keeps every %s coastal edge identity and places boats seaward', (topologyId) => {
    const geometry = buildGeometry(topologyId);
    const coastal = geometry.topology.edges.flatMap((edge, index) => edge.hexes.length === 1 ? [index] : []);
    const board = { ...fixedBoard(), topologyId, harbors: coastal.map((edge) => ({ edge, type: 'generic' as const })) };
    const harbors = dioramaHarborInstances(geometry, board);
    const labels = harborLabelInstances(geometry, board);
    expect(harbors.map((harbor) => harbor.edge)).toEqual(coastal);
    expect(harbors.every(finiteTransform)).toBe(true);
    for (const harbor of harbors) {
      const edge = geometry.edges[harbor.edge]!;
      const midpoint = geometryToWorld(geometry, (edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2);
      const hex = geometry.hexes[geometry.topology.edges[harbor.edge]!.hexes[0]!]!;
      const center = geometryToWorld(geometry, hex.cx, hex.cy);
      expect(harbor.position).toEqual([midpoint.x, 0, midpoint.z]);
      const boat = new Vector3(0.32, 0.022, 0.63).applyMatrix4(instanceMatrix(harbor));
      const dot = (boat.x - midpoint.x) * (midpoint.x - center.x) + (boat.z - midpoint.z) * (midpoint.z - center.z);
      expect(dot).toBeGreaterThan(0.5);
      const label = labels.find((candidate) => candidate.edge === harbor.edge)!;
      expect(finiteTransform(label)).toBe(true);
      const localLabel = new Vector3(...label.position).applyMatrix4(instanceMatrix(harbor).invert());
      expect(localLabel.x).toBeCloseTo(0, 6);
      expect(localLabel.y).toBeCloseTo(0.156, 6);
      expect(localLabel.z).toBeCloseTo(0.22, 6);
    }
  });
});
