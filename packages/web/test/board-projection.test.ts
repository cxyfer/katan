import { describe, expect, it } from 'vitest';
import { fitOrthographicCamera } from '../src/board/camera-fit.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import {
  geometryPointToWorld,
  projectSvgTargets,
  projectWorldPoint,
  projectWorldTarget,
  svgPanForCenter,
  targetsFromGeometry,
} from '../src/board/projection.ts';
import type { CssRect, ProjectionSnapshot, SceneBounds, WorldPoint } from '../src/board/render-contract.ts';

const rect: CssRect = { left: 10, top: 20, width: 200, height: 100 };

function matrix(values: readonly number[]): readonly number[] {
  expect(values).toHaveLength(16);
  return values;
}

function projectSnapshot(values = matrix([
  0.5, 0, 0, 0,
  0, 0.25, 0, 0,
  0, 0, 0.5, 0,
  0, 0, 0, 1,
])): ProjectionSnapshot {
  return {
    viewProjection: values,
    rect,
    version: 1,
    clip: { near: -1, far: 1 },
  };
}

function dot(a: WorldPoint, b: WorldPoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function subtract(a: WorldPoint, b: WorldPoint): WorldPoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: WorldPoint, b: WorldPoint): WorldPoint {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(value: WorldPoint): WorldPoint {
  const length = Math.hypot(value.x, value.y, value.z);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

describe('numeric camera projection', () => {
  it('maps clip space to global CSS pixels at rect offset and leaves DPR out of the contract', () => {
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 3 });
    const anchor = projectWorldPoint({
      matrix: matrix([
        0.5, 0, 0, 0,
        0, 0.25, 0, 0,
        0, 0, 0.5, 0,
        0, 0, 0, 1,
      ]),
      point: { x: 1, y: 1, z: 0 },
      rect,
    });
    expect(anchor).toEqual({ x: 160, y: 57.5, visible: true });

    const resized = projectWorldPoint({
      matrix: matrix([
        0.5, 0, 0, 0,
        0, 0.25, 0, 0,
        0, 0, 0.5, 0,
        0, 0, 0, 1,
      ]),
      point: { x: 1, y: 1, z: 0 },
      rect: { left: 30, top: 40, width: 400, height: 200 },
    });
    expect(resized).toEqual({ x: 330, y: 115, visible: true });
    expect(Number.isNaN(resized.x) || Number.isNaN(resized.y)).toBe(false);
  });

  it('uses w and the complete z/x/y clip bounds instead of only screen coordinates', () => {
    const identity = matrix([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    expect(projectWorldPoint({ matrix: identity, point: { x: 0, y: 0, z: 1.2 }, rect }))
      .toMatchObject({ visible: false });
    expect(projectWorldPoint({ matrix: identity, point: { x: 1.2, y: 0, z: 0 }, rect }))
      .toMatchObject({ visible: false });
    expect(projectWorldPoint({ matrix: identity, point: { x: 0, y: -1.2, z: 0 }, rect }))
      .toMatchObject({ visible: false });

    const behind = matrix([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, -1,
    ]);
    const behindPoint = projectWorldPoint({ matrix: behind, point: { x: 0, y: 0, z: 1 }, rect });
    expect(behindPoint.visible).toBe(false);
    expect(behindPoint.x).toBeNaN();

    expect(projectWorldPoint({
      matrix: identity,
      point: { x: 0, y: 0, z: -0.95 },
      rect,
      clip: { near: -0.9, far: 1 },
    }).visible).toBe(false);
  });

  it('returns inert finite output for zero rects and malformed matrices', () => {
    const identity = matrix([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    expect(projectWorldPoint({ matrix: identity, point: { x: 0, y: 0, z: 0 }, rect: { left: 0, top: 0, width: 0, height: 10 } }))
      .toEqual({ x: NaN, y: NaN, visible: false });
    expect(projectWorldPoint({ matrix: [1, 2], point: { x: 0, y: 0, z: 0 }, rect }))
      .toEqual({ x: NaN, y: NaN, visible: false });
  });

  it('keeps edge midpoints and both endpoints in the edge-local direction', () => {
    const geometry = buildGeometry('hex-r2', 100);
    const edge = geometry.edges[0]!;
    const target = targetsFromGeometry(geometry, 'edge', [edge.index])[0]!;
    expect(target.world).toEqual({ x: (edge.x1 + edge.x2) / 200, y: 0, z: (edge.y1 + edge.y2) / 200 });
    expect(target.endpoints).toEqual([
      geometryPointToWorld(geometry, { x: edge.x1, y: edge.y1 }),
      geometryPointToWorld(geometry, { x: edge.x2, y: edge.y2 }),
    ]);

    const projected = projectWorldTarget(target, projectSnapshot());
    expect(projected.endpoints).toHaveLength(2);
    expect(projected.x).toBeCloseTo((projected.endpoints![0].x + projected.endpoints![1].x) / 2, 0);
    expect(Math.hypot(
      projected.endpoints![1].x - projected.endpoints![0].x,
      projected.endpoints![1].y - projected.endpoints![0].y,
    )).toBeGreaterThan(0);
  });

  it('gives SVG targets the same shape and clips letterboxed/offscreen anchors', () => {
    const geometry = buildGeometry('hex-r2', 100);
    const first = geometry.vertices[0]!;
    const targets = projectSvgTargets({
      geometry,
      kind: 'vertex',
      indices: [first.index],
      rect,
      center: { x: 0, z: 0 },
      zoom: 1,
    });
    expect(targets[0]).toMatchObject({ kind: 'vertex', index: first.index });
    expect(targets[0]!.x).toBeGreaterThanOrEqual(rect.left);
    expect(targets[0]!.x).toBeLessThanOrEqual(rect.left + rect.width);
    expect(targets[0]!.visible).toBe(true);

    const offscreen = projectSvgTargets({
      geometry,
      kind: 'vertex',
      indices: [first.index],
      rect,
      center: { x: -100, z: 0 },
      zoom: 3,
    });
    expect(offscreen[0]!.visible).toBe(false);

    expect(projectSvgTargets({
      geometry,
      kind: 'vertex',
      indices: [first.index],
      rect: { left: 0, top: 0, width: 0, height: 0 },
      center: { x: 0, z: 0 },
      zoom: 1,
    })).toEqual([]);
  });

  it('centers nonzero hex-r56 bounds with viewBox-relative SVG pan', () => {
    const geometry = buildGeometry('hex-r56', 100);
    const viewBox = geometry.viewBox.trim().split(/\s+/).map(Number);
    const viewBoxCenter = { x: (viewBox[0]! + viewBox[2]! / 2) / geometry.scale, z: (viewBox[1]! + viewBox[3]! / 2) / geometry.scale };
    const offCenterHexes = geometry.hexes.filter((hex) => Math.abs(hex.cx) >= 50 || Math.abs(hex.cy) >= 50);
    const centerHex = offCenterHexes.reduce((best, hex) =>
      Math.hypot(hex.cx - viewBoxCenter.x * geometry.scale, hex.cy - viewBoxCenter.z * geometry.scale) <
      Math.hypot(best.cx - viewBoxCenter.x * geometry.scale, best.cy - viewBoxCenter.z * geometry.scale) ? hex : best);
    const center = { x: centerHex.cx / geometry.scale, z: centerHex.cy / geometry.scale };
    expect(center.x).not.toBeCloseTo(0, 3);
    const targets = projectSvgTargets({
      geometry,
      kind: 'hex',
      indices: [centerHex.index],
      rect: { left: 10, top: 20, width: 600, height: 400 },
      center,
      zoom: 1.5,
    });
    expect(targets[0]!.visible).toBe(true);
    expect(targets[0]!.x).toBeCloseTo(310, 5);
    expect(targets[0]!.y).toBeCloseTo(220, 5);
    expect(svgPanForCenter(geometry, center, 1.5)).toEqual({
      x: (viewBox[0]! + viewBox[2]! / 2 - center.x * geometry.scale) * 1.5,
      y: (viewBox[1]! + viewBox[3]! / 2 - center.z * geometry.scale) * 1.5,
    });
  });
});

describe('orthographic scene fit', () => {
  const sceneBounds: SceneBounds = {
    min: { x: -3.2, y: -0.2, z: -2.7 },
    max: { x: 3.4, y: 0.8, z: 2.9 },
  };

  it('fits all complete-scene corners for desktop and portrait elevations', () => {
    for (const elevationDeg of [50, 60]) {
      const fit = fitOrthographicCamera(sceneBounds, { left: 40, top: 20, width: 800, height: 500 }, { elevationDeg });
      expect(fit.elevationDeg).toBe(elevationDeg);
      expect(fit.azimuthDeg).toBe(20);
      expect(fit.zoom).toBe(1);
      const forward = normalize(subtract(fit.target, fit.position));
      const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
      const up = normalize(cross(right, forward));
      for (const x of [sceneBounds.min.x, sceneBounds.max.x]) {
        for (const y of [sceneBounds.min.y, sceneBounds.max.y]) {
          for (const z of [sceneBounds.min.z, sceneBounds.max.z]) {
            const relative = subtract({ x, y, z }, fit.target);
            expect(Math.abs(dot(relative, right))).toBeLessThanOrEqual(fit.frustum.right + 1e-8);
            expect(Math.abs(dot(relative, up))).toBeLessThanOrEqual(fit.frustum.top + 1e-8);
          }
        }
      }
    }
  });

  it('applies the >=1.08 safety buffer and a usable orthographic depth range', () => {
    const tight = fitOrthographicCamera(sceneBounds, { left: 0, top: 0, width: 800, height: 500 }, { margin: 0 });
    const buffered = fitOrthographicCamera(sceneBounds, { left: 0, top: 0, width: 800, height: 500 }, { margin: 0.08 });
    expect(buffered.frustum.top / tight.frustum.top).toBeGreaterThanOrEqual(1.08);
    expect(buffered.frustum.right / buffered.frustum.top).toBeCloseTo(800 / 500, 10);
    expect(buffered.frustum.near).toBeGreaterThan(0);
    expect(buffered.frustum.far).toBeGreaterThan(buffered.frustum.near);
  });

  it('rejects invalid bounds and zero-size viewport instead of producing NaNs', () => {
    expect(() => fitOrthographicCamera(
      { min: { x: 1, y: 0, z: 0 }, max: { x: 0, y: 1, z: 1 } },
      { left: 0, top: 0, width: 10, height: 10 },
    )).toThrow(RangeError);
    expect(() => fitOrthographicCamera(sceneBounds, { left: 0, top: 0, width: 0, height: 10 }))
      .toThrow(RangeError);
  });
});
