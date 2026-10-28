import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, type BufferGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { fixedBoard } from '../src/test/fixtures.ts';
import { BOARD_MODEL_METRICS, geometryToWorld, sceneBounds } from '../src/board/three/bounds.ts';
import { HARBOR_ATLAS_CELLS, NUMBER_ATLAS_CELLS, createAtlasPlaneGeometry, normalizedAtlasCell } from '../src/board/three/atlas.ts';
import {
  createGabledRoofGeometry,
  createHexTileGeometry,
  createHexTileSurfaces,
  createRobberCloakGeometry,
  createRobberHeadGeometry,
  createRobberHoodGeometry,
  createUnitBoxGeometry,
} from '../src/board/three/model-geometry.ts';
import {
  BUILDING_ARRIVAL_TRANSFORM_MS,
  ROAD_ARRIVAL_TRANSFORM_MS,
  buildingParts,
  harborInstances,
  legalGhostSelection,
  numberTokens,
  roadInstances,
  terrainPieces,
  tileInstances,
} from '../src/board/three/model-specs.ts';
import { disposeWhenReleased, finiteTransform, instanceMatrix } from '../src/board/three/transforms.ts';
import { boardSceneResources } from '../src/board/three/resources.ts';

function boardWith(cityAt = 1) {
  const source = fixedBoard();
  const buildings = source.buildings.slice();
  buildings[0] = { player: 'p1', city: false };
  buildings[cityAt] = { player: 'p2', city: true };
  const roads = source.roads.slice();
  roads[0] = { player: 'p1', ship: false };
  roads[1] = { player: 'p2', ship: false };
  return { ...source, buildings, roads };
}

const players = [
  { id: 'p1', seat: 0, color: 'red' as const },
  { id: 'p2', seat: 1, color: 'blue' as const },
];

function expectFiniteBounds(geometry: BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  expect([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)).toBe(true);
  return box;
}

function transformedBounds(
  part: { position: readonly [number, number, number]; rotationY: number; scale: readonly [number, number, number] },
  geometry: BufferGeometry,
): Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone().applyMatrix4(instanceMatrix(part));
}

describe('modeled board pieces', () => {
  it('V01 builds a closed beveled hex volume with the tile top at Y=0', () => {
    const tile = createHexTileGeometry();
    const box = expectFiniteBounds(tile);
    expect(box.min.y).toBeCloseTo(-(BOARD_MODEL_METRICS.tileSideHeight), 2);
    expect(box.max.y).toBeCloseTo(0, 2);
    expect(box.max.x - box.min.x).toBeGreaterThan(1.65);
    expect(box.max.z - box.min.z).toBeGreaterThan(1.9);
    expect(tile.groups.length).toBeGreaterThanOrEqual(2);
    expect(tile.getAttribute('position').count).toBeGreaterThan(30);

    const surfaces = createHexTileSurfaces();
    const cap = expectFiniteBounds(surfaces.cap);
    const wall = expectFiniteBounds(surfaces.wall);
    expect(cap.isEmpty()).toBe(false);
    expect(wall.isEmpty()).toBe(false);
    expect(surfaces.cap.groups).toHaveLength(0);
    expect(surfaces.wall.groups).toHaveLength(0);
    expect(surfaces.cap.getAttribute('position').count).toBe(tile.groups[0]!.count);
    expect(surfaces.wall.getAttribute('position').count).toBe(tile.groups[1]!.count);

    const resources = boardSceneResources();
    expect(resources.geometries.tileCap).not.toBe(resources.geometries.tileWall);
    expect(resources.materials.tileSide).not.toBe(resources.materials.tileTop.forest);
    expect(Object.values(resources.materials.tileTop)).not.toContain(resources.materials.tileSide);
    surfaces.cap.dispose();
    surfaces.wall.dispose();
    tile.dispose();
  });

  it('V02 derives deterministic terrain volumes and keeps them off every topology point', () => {
    const geometry = buildGeometry('hex-r2', 100);
    const board = fixedBoard();
    const first = terrainPieces(geometry, board);
    const second = terrainPieces(geometry, board);
    expect(second).toEqual(first);
    expect(first.some((piece) => piece.kind === 'trunk')).toBe(true);
    expect(first.some((piece) => piece.kind === 'canopy')).toBe(true);
    expect(first.some((piece) => piece.kind === 'mountain')).toBe(true);
    expect(first.every(finiteTransform)).toBe(true);
    expect(first.every((piece) => piece.position[1] < BOARD_MODEL_METRICS.terrainHeight)).toBe(true);
  });

  it('V03 gives settlements and cities distinct closed wall and roof assemblies', () => {
    const geometry = buildGeometry('hex-r2', 100);
    const board = boardWith();
    const parts = buildingParts(geometry, board, players, null);
    const settlement = parts.filter((part) => part.vertex === 0);
    const city = parts.filter((part) => part.vertex === 1);
    expect(settlement.filter((part) => part.part === 'body')).toHaveLength(2);
    expect(city.filter((part) => part.part === 'body' || part.part === 'tower').length).toBeGreaterThan(2);
    expect(settlement.filter((part) => part.part === 'roof')).toHaveLength(1);
    expect(city.filter((part) => part.part === 'roof')).toHaveLength(2);
    expect(parts.every((part) => finiteTransform(part))).toBe(true);
    expect(parts.every((part) => part.durationMs === BUILDING_ARRIVAL_TRANSFORM_MS)).toBe(true);
    expect(BUILDING_ARRIVAL_TRANSFORM_MS).toBe(290);

    const roof = createGabledRoofGeometry();
    const wall = createUnitBoxGeometry();
    const box = expectFiniteBounds(roof);
    expect(roof.getIndex()?.count).toBe(24);
    expect(box.max.y).toBe(1);
    expect(box.min.y).toBe(0);

    for (const roofPart of parts.filter((part) => part.part === 'roof')) {
      const supports = parts.filter((part) =>
        part.vertex === roofPart.vertex &&
        (part.part === 'body' || part.part === 'tower') &&
        Math.abs(part.position[0] - roofPart.position[0]) < 1e-10 &&
        Math.abs(part.position[2] - roofPart.position[2]) < 1e-10);
      const supportTop = Math.max(...supports.map((part) => transformedBounds(part, wall).max.y));
      expect(transformedBounds(roofPart, roof).min.y).toBeCloseTo(supportTop, 10);
    }
    roof.dispose();
    wall.dispose();
  });

  it('V04/V05 locates roads on the shared IDs and uses the local atlas for number and harbor labels', () => {
    const geometry = buildGeometry('hex-r2', 100);
    const board = boardWith();
    const roads = roadInstances(geometry, board, players, null);
    expect(roads).toHaveLength(2);
    expect(roads.every((road) => road.durationMs === ROAD_ARRIVAL_TRANSFORM_MS)).toBe(true);
    expect(ROAD_ARRIVAL_TRANSFORM_MS).toBe(240);
    for (const road of roads) {
      const edge = geometry.edges[road.index]!;
      const expected = geometryToWorld(geometry, (edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2);
      expect(road.position[0]).toBeCloseTo(expected.x, 10);
      expect(road.position[2]).toBeCloseTo(expected.z, 10);
      expect(Math.cos(road.rotationY)).toBeCloseTo((edge.x2 - edge.x1) / Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1), 10);
      expect(road.length).toBeGreaterThan(0);
      expect(finiteTransform(road)).toBe(true);
    }

    const tokens = numberTokens(geometry, board);
    expect(tokens.length).toBe(board.numbers.filter((value) => value !== null).length);
    expect(tokens.every((token) => token.position[1] === 0)).toBe(true);
    expect(tokens.every((token) => Object.hasOwn(NUMBER_ATLAS_CELLS, token.value))).toBe(true);
    expect(harborInstances(geometry, board).every((harbor) => harbor.type in HARBOR_ATLAS_CELLS)).toBe(true);
    for (const [value, cell] of Object.entries(NUMBER_ATLAS_CELLS)) {
      expect(value).toMatch(/^(2|3|4|5|6|8|9|10|11|12)$/);
      const uv = normalizedAtlasCell(cell);
      expect(uv.u0).toBeGreaterThanOrEqual(0);
      expect(uv.u1).toBeLessThanOrEqual(1);
      expect(uv.v0).toBeGreaterThanOrEqual(0);
      expect(uv.v1).toBeLessThanOrEqual(1);
      const geometry = createAtlasPlaneGeometry(cell);
      expect(geometry.getAttribute('uv').count).toBe(4);
      geometry.dispose();
    }

    const source = readFileSync(resolve(process.cwd(), 'src/assets/board3d/board-atlas.svg'), 'utf8');
    expect(source).toContain('3:1');
    for (const letter of ['L', 'B', 'W', 'G', 'O']) expect(source).toContain(`2:1 ${letter}`);
  });

  it('V05 models a hooded robber with real depth outside the number badge footprint', () => {
    const pieces = [createRobberCloakGeometry(), createRobberHeadGeometry(), createRobberHoodGeometry()];
    const boxes = pieces.map(expectFiniteBounds);
    expect(boxes[0]!.max.y - boxes[0]!.min.y).toBeGreaterThan(0.35);
    expect(boxes[1]!.max.y - boxes[1]!.min.y).toBeGreaterThan(0.15);
    expect(boxes[2]!.max.y - boxes[2]!.min.y).toBeGreaterThan(0.15);
    expect(boxes[2]!.max.y).toBeCloseTo(BOARD_MODEL_METRICS.robberLocalHeight, 5);
    expect(BOARD_MODEL_METRICS.robberOriginY + boxes[2]!.max.y).toBeCloseTo(BOARD_MODEL_METRICS.robberHeight, 5);
    for (const geometry of pieces) geometry.dispose();
  });

  it('V06 supplies complete finite bounds for both supported topologies', () => {
    const fixed = fixedBoard();
    const bounds2 = sceneBounds(buildGeometry('hex-r2', 100), fixed);
    const board56 = {
      ...fixed,
      topologyId: 'hex-r56',
      terrain: Array.from({ length: 30 }, (_, index) => index % 2 ? 'forest' : 'mountains'),
      numbers: Array.from({ length: 30 }, (_, index) => index === 7 ? null : 2 + index % 7),
    };
    const bounds56 = sceneBounds(buildGeometry('hex-r56', 100), board56);
    for (const bounds of [bounds2, bounds56]) {
      expect([bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)).toBe(true);
      expect(bounds.min.y).toBeCloseTo(-BOARD_MODEL_METRICS.tileSideHeight, 10);
      expect(bounds.max.y).toBeGreaterThanOrEqual(BOARD_MODEL_METRICS.robberHeight);
      expect(bounds.max.x - bounds.min.x).toBeLessThan(17);
      expect(bounds.max.z - bounds.min.z).toBeLessThan(16);
    }
    expect(bounds56.max.x - bounds56.min.x).toBeGreaterThan(bounds2.max.x - bounds2.min.x);

    const tile = tileInstances(buildGeometry('hex-r2', 100), fixed);
    expect(tile).toHaveLength(19);
    expect(tile.every(finiteTransform)).toBe(true);
  });

  it('only exposes a ghost for a still-legal selection and marks it non-depth-writing', () => {
    const intent = {
      kind: 'edge' as const,
      commandType: 'build.road',
      labelId: 'play.build.road',
      targets: [2, 3],
      fromHints: true,
    };
    expect(legalGhostSelection(intent, { kind: 'edge', index: 2, playerId: 'p1' }))
      .toEqual({ kind: 'edge', index: 2, playerId: 'p1' });
    expect(legalGhostSelection(intent, { kind: 'edge', index: 1, playerId: 'p1' })).toBeNull();
    expect(legalGhostSelection(intent, { kind: 'vertex', index: 2, playerId: 'p1' })).toBeNull();

    const resources = boardSceneResources();
    for (const material of Object.values(resources.materials.ghost)) {
      expect(material.depthWrite).toBe(false);
      expect(material.transparent).toBe(true);
    }
  });

  it('defers shared-resource disposal across StrictMode-style release/acquire cycles', async () => {
    const resources = boardSceneResources();
    resources.acquire();
    resources.release();
    resources.acquire();
    await Promise.resolve();
    expect(resources.disposed()).toBe(false);
    resources.release();
    await Promise.resolve();
    expect(resources.disposed()).toBe(true);
  });

  it('disposes InstancedMesh-owned buffers only after a release survives replacement or unmount', async () => {
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    let current: typeof first | null = first;
    disposeWhenReleased(first, () => current !== first);
    current = first;
    await Promise.resolve();
    expect(first.dispose).not.toHaveBeenCalled();

    disposeWhenReleased(first, () => current !== first);
    current = second;
    await Promise.resolve();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
  });
});
