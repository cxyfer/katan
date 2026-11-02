import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Color, type BufferGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MAX_EFFECT_DURATION_MS } from '../src/board/animation.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { ARRIVAL_SHADOW_OPACITY, arrivalPose, arrivalShadow, RESTING_POSE } from '../src/board/three/arrival.ts';
import { harborPlacement } from '../src/board/harbor.ts';
import { fixedBoard } from '../src/test/fixtures.ts';
import { BOARD_MODEL_METRICS, geometryToWorld, sceneBounds } from '../src/board/three/bounds.ts';
import { HARBOR_ATLAS_CELLS, NUMBER_ATLAS_CELLS, createAtlasPlaneGeometry, normalizedAtlasCell } from '../src/board/three/atlas.ts';
import {
  createGabledRoofGeometry,
  createHexTileGeometry,
  createHexTileSurfaces,
  createTokenBodyGeometry,
  createUnitBoxGeometry,
} from '../src/board/three/model-geometry.ts';
import {
  BUILDING_ARRIVAL_TRANSFORM_MS,
  ROAD_ARRIVAL_TRANSFORM_MS,
  buildingParts,
  legalGhostSelection,
  numberTokens,
  roadInstances,
  terrainPieces,
  tileInstances,
} from '../src/board/three/model-specs.ts';
import { disposeWhenReleased, finiteTransform, instanceMatrix } from '../src/board/three/transforms.ts';
import { boardSceneResources } from '../src/board/three/resources.ts';
import { createRobberModel } from '../src/board/three/diorama-robber.ts';

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
    expect(resources.materials.tileSide).not.toBe(resources.materials.diorama);
    expect(resources.materials.tileSide.vertexColors).toBe(false);
    expect(resources.materials.diorama.vertexColors).toBe(true);
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

  it('drops arriving pieces from the sky, squashes on impact and settles exactly at rest', () => {
    const options = { height: 1.4, spin: Math.PI / 2 };
    expect(arrivalPose(0, options)).toEqual({ lift: 1.4, scaleY: 1, scaleXZ: 1, spin: Math.PI / 2 });
    expect(arrivalPose(1, options)).toEqual(RESTING_POSE);
    expect(arrivalPose(2, options)).toEqual(RESTING_POSE);
    const samples = Array.from({ length: 101 }, (_, step) => arrivalPose(step / 100, options));
    // 墜落段單調下降且加速；落地後只剩小彈跳，不會再回到高處。
    const fall = samples.slice(0, 52).map((pose) => pose.lift);
    expect(fall.every((lift, index) => index === 0 || lift < fall[index - 1]!)).toBe(true);
    expect(fall[0]! - fall[10]!).toBeLessThan(fall[41]! - fall[51]!);
    expect(Math.max(...samples.slice(53).map((pose) => pose.lift))).toBeLessThan(0.15);
    expect(Math.min(...samples.map((pose) => pose.scaleY))).toBeLessThan(0.8);
    expect(samples.every((pose) => pose.lift >= 0 && pose.scaleY > 0 && pose.scaleXZ >= 1)).toBe(true);
    expect(arrivalPose(0.6, { height: 1 }).spin).toBe(0);
  });

  it('grows and darkens the landing shadow as the piece nears the ground, then hands off to the resting piece', () => {
    const options = { height: 1.4 };
    const shadows = Array.from({ length: 53 }, (_, step) => arrivalShadow(step / 100, options));
    expect(shadows[0]!.scale).toBeCloseTo(0.4, 10);
    expect(shadows.every((shadow, index) => index === 0 ||
      (shadow.scale > shadows[index - 1]!.scale && shadow.opacity > shadows[index - 1]!.opacity))).toBe(true);
    expect(arrivalShadow(0.52, options)).toEqual({ scale: 1, opacity: ARRIVAL_SHADOW_OPACITY });
    expect(arrivalShadow(0.8, options).opacity).toBeLessThan(ARRIVAL_SHADOW_OPACITY / 2);
    expect(arrivalShadow(1, options).opacity).toBe(0);
  });

  it('V03 gives settlements and cities distinct closed wall and roof assemblies', () => {
    const geometry = buildGeometry('hex-r2', 100);
    const board = boardWith();
    const parts = buildingParts(geometry, board, players, []);
    const settlement = parts.filter((part) => part.vertex === 0);
    const city = parts.filter((part) => part.vertex === 1);
    expect(settlement.filter((part) => part.part === 'body')).toHaveLength(2);
    expect(city.filter((part) => part.part === 'body' || part.part === 'tower').length).toBeGreaterThan(2);
    expect(settlement.filter((part) => part.part === 'roof')).toHaveLength(1);
    expect(city.filter((part) => part.part === 'roof')).toHaveLength(2);
    expect(parts.every((part) => finiteTransform(part))).toBe(true);
    expect(parts.every((part) => part.durationMs === BUILDING_ARRIVAL_TRANSFORM_MS)).toBe(true);
    expect(BUILDING_ARRIVAL_TRANSFORM_MS).toBe(640);
    expect(BUILDING_ARRIVAL_TRANSFORM_MS).toBeLessThanOrEqual(MAX_EFFECT_DURATION_MS);

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
    const roads = roadInstances(geometry, board, players, []);
    expect(roads).toHaveLength(2);
    expect(roads.every((road) => road.durationMs === ROAD_ARRIVAL_TRANSFORM_MS)).toBe(true);
    expect(ROAD_ARRIVAL_TRANSFORM_MS).toBe(560);
    expect(ROAD_ARRIVAL_TRANSFORM_MS).toBeLessThanOrEqual(MAX_EFFECT_DURATION_MS);
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
    for (const token of tokens) {
      const hex = geometry.hexes[token.index]!;
      const center = geometryToWorld(geometry, hex.cx, hex.cy);
      expect(token.position).toEqual([center.x, 0, center.z]);
      expect(token.scale).toEqual([0.62, 1, 0.62]);
    }
    const body = createTokenBodyGeometry();
    const bodyBounds = expectFiniteBounds(body);
    expect(bodyBounds.max.x - bodyBounds.min.x).toBeGreaterThan(0.55);
    expect(bodyBounds.max.x).toBeLessThan(0.3);
    expect(bodyBounds.max.z).toBeLessThan(0.3);
    body.dispose();
    expect(tokens.every((token) => Object.hasOwn(NUMBER_ATLAS_CELLS, token.value))).toBe(true);
    expect(board.harbors.every((harbor) => harbor.type in HARBOR_ATLAS_CELLS &&
      Number.isFinite(harborPlacement(geometry, harbor.edge)!.rotationY))).toBe(true);
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
    const atlas = new DOMParser().parseFromString(source, 'image/svg+xml');
    expect(atlas.querySelector('parsererror')).toBeNull();
    expect(atlas.querySelector('#harbor-generic text')?.textContent).toBe('3:1');
    for (const [resource, name] of Object.entries({ lumber: 'WOOD', brick: 'BRICK', wool: 'WOOL', grain: 'GRAIN', ore: 'ORE' })) {
      const harbor = atlas.querySelector(`#harbor-${resource}`)!;
      expect(harbor.textContent).toContain('2:1');
      expect(harbor.textContent).toContain(name);
      expect(harbor.querySelector(`#icon-${resource}`)).not.toBeNull();
      expect(harbor.querySelector('rect')?.getAttribute('width')).toBe('240');
      expect(harbor.querySelector('rect')?.getAttribute('height')).toBe('240');
    }
    for (const number of Object.keys(NUMBER_ATLAS_CELLS)) {
      expect(atlas.querySelector(`#number-${number} text`)?.getAttribute('font-size')).toBe(number.length === 1 ? '112' : '100');
    }
    for (const number of [6, 8]) {
      expect(atlas.querySelector(`#number-${number} text`)?.getAttribute('fill')).toBe('#8f211c');
      expect(atlas.querySelector(`#number-${number} text:last-child`)?.textContent).toBe('•••••');
    }
  });

  it('V05 gives the enlarged robber a colored face, mask, hooded cloak, scarf, belt and loot within the fit envelope', () => {
    const model = createRobberModel();
    const bounds = expectFiniteBounds(model);
    expect(bounds.min.y).toBeGreaterThan(-1e-6);
    expect(bounds.max.y).toBeGreaterThan(0.88);
    expect(bounds.max.y).toBeLessThanOrEqual(BOARD_MODEL_METRICS.robberLocalHeight);
    expect(BOARD_MODEL_METRICS.robberOriginY + bounds.max.y).toBeLessThanOrEqual(BOARD_MODEL_METRICS.robberHeight);
    const positions = model.getAttribute('position');
    const colors = model.getAttribute('color');
    expect(colors.count).toBe(positions.count);
    expect(Array.from(colors.array).every(Number.isFinite)).toBe(true);
    expect(positions.count / 3).toBeLessThan(2_000);
    for (let index = 0; index < positions.count; index++) {
      expect(Math.hypot(positions.getX(index), positions.getZ(index))).toBeLessThan(0.3);
    }
    // Visible face, pale eyes, belt, scarf and loot sack must survive geometry baking.
    for (const [hex, minimumY] of [['#bd9977', 0.65], ['#ece2c6', 0.74], ['#855f3d', 0.35], ['#8a3a2e', 0.55], ['#a18a5d', 0.4]] as const) {
      const color = new Color(hex);
      expect(Array.from({ length: colors.count }, (_, index) => index).some((index) =>
        positions.getY(index) > minimumY &&
        Math.abs(colors.getX(index) - color.r) < 1e-6 &&
        Math.abs(colors.getY(index) - color.g) < 1e-6 &&
        Math.abs(colors.getZ(index) - color.b) < 1e-6)).toBe(true);
    }
    model.dispose();
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
      expect(bounds.min.y).toBeCloseTo(-BOARD_MODEL_METRICS.coastDepth, 10);
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
