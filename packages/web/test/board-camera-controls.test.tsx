import { act, renderHook } from '@testing-library/react';
import { Matrix4, OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { projectWorldPoint, targetsFromGeometry } from '../src/board/projection.ts';
import type { BoardViewportState, CssRect, ProjectionSnapshot, SceneBounds } from '../src/board/render-contract.ts';
import { sceneBounds } from '../src/board/three/bounds.ts';
import { applySceneCamera, fitSceneCamera } from '../src/board/three/camera.ts';
import { useBoardViewport } from '../src/board/useBoardViewport.ts';

function snapshot(bounds: ReturnType<typeof sceneBounds>, viewport: BoardViewportState): ProjectionSnapshot {
  const camera = new OrthographicCamera();
  applySceneCamera(camera, fitSceneCamera(bounds, viewport.rect, viewport.azimuthDeg, viewport.elevationDeg), viewport);
  return { viewProjection: new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray(),
    rect: viewport.rect, cameraZoom: camera.zoom, version: 1, clip: { near: -1, far: 1 } };
}

describe('rotatable orthographic board camera', () => {
  it('fits the complete island at every 30° stop, including portrait and the larger topology', () => {
    for (const topology of ['hex-r2', 'hex-r56']) {
      const bounds = sceneBounds(buildGeometry(topology));
      expect(bounds.fitPoints?.length).toBeGreaterThan(0);
      for (const [width, height] of [[1200, 700], [390, 700], [900, 1200]] as const) {
        const rect: CssRect = { left: 23, top: 57, width, height };
        for (let azimuthDeg = 20; azimuthDeg < 380; azimuthDeg += 30) {
          const viewport = { center: { x: (bounds.min.x + bounds.max.x) / 2,
            z: (bounds.min.z + bounds.max.z) / 2 }, zoom: 1, azimuthDeg, rect };
          const projection = snapshot(bounds, viewport);
          for (const point of bounds.fitPoints!) {
              const projected = projectWorldPoint({ matrix: projection.viewProjection, rect, point });
              expect(projected.visible).toBe(true);
              expect(projected.x).toBeGreaterThan(rect.left);
              expect(projected.x).toBeLessThan(rect.left + rect.width);
              expect(projected.y).toBeGreaterThan(rect.top);
              expect(projected.y).toBeLessThan(rect.top + rect.height);
          }
        }
      }
    }
  });

  it('fits actual envelope corners more tightly than empty rotated box corners without clipping models', () => {
    const bounds: SceneBounds = { min: { x: -4, y: -0.3, z: -4 }, max: { x: 4, y: 0.9, z: 4 },
      fitPoints: [-0.3, 0.9].flatMap((y) => [
        { x: -4, y, z: 0 }, { x: 4, y, z: 0 }, { x: 0, y, z: -4 }, { x: 0, y, z: 4 },
      ]) };
    const rect = { left: 20, top: 40, width: 1000, height: 700 };
    const tight = fitSceneCamera(bounds, rect, 45);
    const box = fitSceneCamera({ min: bounds.min, max: bounds.max }, rect, 45);
    expect(tight.frustum.right).toBeLessThan(box.frustum.right * 0.75);
    expect(tight.target).toEqual(box.target);
    for (let azimuthDeg = 0; azimuthDeg < 360; azimuthDeg += 15) {
      const projection = snapshot(bounds, { center: { x: 0, z: 0 }, zoom: 1, azimuthDeg, rect });
      for (const point of bounds.fitPoints!) {
        expect(projectWorldPoint({ matrix: projection.viewProjection, rect, point }).visible).toBe(true);
      }
    }
  });

  it('retains asymmetric envelope extrema about the unchanged target and validates supplied fit points', () => {
    const bounds: SceneBounds = { min: { x: -3, y: -0.3, z: -3 }, max: { x: 3, y: 1.5, z: 3 },
      fitPoints: [{ x: 3, y: 1.5, z: 0 }, { x: 0, y: 0, z: 3 }, { x: -1, y: -0.3, z: 0 }] };
    const rect = { left: 0, top: 0, width: 900, height: 700 };
    for (let azimuthDeg = 0; azimuthDeg < 360; azimuthDeg += 30) {
      const projection = snapshot(bounds, { center: { x: 0, z: 0 }, zoom: 1, azimuthDeg, rect });
      for (const point of bounds.fitPoints!) {
        expect(projectWorldPoint({ matrix: projection.viewProjection, rect, point }).visible).toBe(true);
      }
    }
    expect(() => fitSceneCamera({ ...bounds, fitPoints: [] }, rect)).toThrow(RangeError);
    expect(() => fitSceneCamera({ ...bounds, fitPoints: [{ x: 0, y: Number.NaN, z: 0 }] }, rect)).toThrow(RangeError);
  });

  it('keeps old callers at 20° and uses the requested rotated camera for real Three projection', () => {
    const bounds = sceneBounds(buildGeometry('hex-r2'));
    const rect = { left: 0, top: 0, width: 1000, height: 700 };
    expect(fitSceneCamera(bounds, rect).azimuthDeg).toBe(20);
    const fit = fitSceneCamera(bounds, rect, 110);
    const camera = new OrthographicCamera();
    applySceneCamera(camera, fit, { center: { x: fit.target.x, z: fit.target.z }, zoom: 1, rect, azimuthDeg: 110 });
    const direction = camera.position.clone().sub(new Vector3(fit.target.x, fit.target.y, fit.target.z));
    expect(Math.atan2(direction.x, direction.z) * 180 / Math.PI).toBeCloseTo(110, 8);
  });

  it('rotates with buttons/shortcuts, preserves projection-based pan and click suppression, and resets fit', () => {
    const geometry = buildGeometry('hex-r2');
    const bounds = sceneBounds(geometry);
    const rect = { left: 23, top: 57, width: 1100, height: 700 };
    const surface = document.createElement('div');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ ...rect, x: rect.left, y: rect.top,
      right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON() {} });
    const surfaceRef = { current: surface };
    const { result, rerender } = renderHook(({ projection }: { projection: ProjectionSnapshot | null }) =>
      useBoardViewport({ geometry, bounds, surfaceRef, renderer: 'r3f', projection }),
    { initialProps: { projection: null as ProjectionSnapshot | null } });
    act(() => { result.current.setZoom(2); result.current.rotate(90); result.current.setElevation(35); });
    expect(result.current.viewport.azimuthDeg).toBe(110);
    expect(result.current.viewport.elevationDeg).toBe(35);
    expect(result.current.cameraFit).toEqual(fitSceneCamera(bounds, rect, 110, 35));
    const before = snapshot(bounds, result.current.viewport);
    rerender({ projection: before });
    const target = targetsFromGeometry(geometry, 'hex', [0])[0]!;
    const start = projectWorldPoint({ matrix: before.viewProjection, rect, point: target.world });
    const event = { currentTarget: surface, target: surface, pointerId: 1, pointerType: 'mouse', button: 0,
      shiftKey: true, clientX: 500, clientY: 350, preventDefault: vi.fn() };
    act(() => result.current.surfaceProps.onPointerDown(event as never));
    act(() => result.current.surfaceProps.onPointerMove({ ...event, clientX: 520, clientY: 362 } as never));
    act(() => result.current.surfaceProps.onPointerUp({ ...event, clientX: 520, clientY: 362 } as never));
    const after = snapshot(bounds, result.current.viewport);
    rerender({ projection: after });
    const end = result.current.projectedTargets({ kind: 'hex', commandType: '', labelId: '', fromHints: false, targets: [0] })[0]!;
    expect(end.x - start.x).toBeCloseTo(20, 5);
    expect(end.y - start.y).toBeCloseTo(12, 5);
    expect(result.current.consumeSuppressedClick()).toBe(true);
    expect(result.current.consumeSuppressedClick()).toBe(false);
    act(() => result.current.surfaceProps.onKeyDown({ currentTarget: surface, target: surface, key: '[', preventDefault() {} } as never));
    expect(result.current.viewport.azimuthDeg).toBe(80);
    const nestedPreventDefault = vi.fn();
    act(() => result.current.surfaceProps.onKeyDown({ currentTarget: surface, target: document.createElement('button'),
      key: ']', preventDefault: nestedPreventDefault } as never));
    expect(result.current.viewport.azimuthDeg).toBe(80);
    expect(nestedPreventDefault).not.toHaveBeenCalled();
    expect(result.current.viewport.zoom).toBe(2);
    expect(result.current.viewport.elevationDeg).toBe(35);
    act(() => result.current.fit());
    expect(result.current.viewport).toMatchObject({ azimuthDeg: 20, elevationDeg: 50, zoom: 1,
      center: { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 } });
  });

  it('ignores rotation controls and shortcuts in SVG', () => {
    const geometry = buildGeometry('hex-r2');
    const surfaceRef = { current: document.createElement('div') };
    const { result } = renderHook(() => useBoardViewport({ geometry, surfaceRef, renderer: 'svg' }));
    act(() => result.current.rotate(30));
    act(() => result.current.setElevation(25));
    const preventDefault = vi.fn();
    act(() => result.current.surfaceProps.onKeyDown({ target: surfaceRef.current, currentTarget: surfaceRef.current,
      key: ']', preventDefault } as never));
    expect(result.current.viewport.azimuthDeg).toBe(20);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('changes the real Three camera elevation, retains full fit, and restores desktop/portrait angles', () => {
    for (const [width, height, defaultAngle] of [[1100, 700, 50], [390, 700, 60]] as const) {
      const geometry = buildGeometry('hex-r2');
      const bounds = sceneBounds(geometry);
      const rect = { left: 0, top: 0, width, height };
      const surface = document.createElement('div');
      vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ ...rect, x: 0, y: 0,
        right: width, bottom: height, toJSON() {} });
      const { result, unmount } = renderHook(() => useBoardViewport({ geometry, bounds,
        surfaceRef: { current: surface }, renderer: 'r3f' }));
      expect(result.current.viewport.elevationDeg).toBe(defaultAngle);
      const initial = snapshot(bounds, result.current.viewport);
      act(() => result.current.setElevation(25));
      const tilted = snapshot(bounds, result.current.viewport);
      expect(tilted.viewProjection).not.toEqual(initial.viewProjection);
      expect(result.current.cameraFit).toEqual(fitSceneCamera(bounds, rect, 20, 25));
      for (const elevationDeg of [25, 80]) {
        act(() => result.current.setElevation(elevationDeg));
        const fit = result.current.cameraFit!;
        const camera = new OrthographicCamera();
        applySceneCamera(camera, fit, result.current.viewport);
        const offset = camera.position.clone().sub(new Vector3(fit.target.x, fit.target.y, fit.target.z));
        expect(Math.asin(offset.y / offset.length()) * 180 / Math.PI).toBeCloseTo(elevationDeg, 8);
        const projection = snapshot(bounds, result.current.viewport);
        for (const point of bounds.fitPoints!) {
          expect(projectWorldPoint({ matrix: projection.viewProjection, rect, point }).visible).toBe(true);
        }
      }
      act(() => { result.current.setZoom(2); result.current.rotate(30); });
      expect(result.current.viewport.elevationDeg).toBe(80);
      act(() => result.current.setElevation(900));
      expect(result.current.viewport.elevationDeg).toBe(80);
      act(() => result.current.setElevation(0));
      expect(result.current.viewport.elevationDeg).toBe(25);
      act(() => result.current.surfaceProps.onKeyDown({ target: surface, currentTarget: surface,
        key: 'Home', preventDefault() {} } as never));
      expect(result.current.viewport).toMatchObject({ elevationDeg: defaultAngle, azimuthDeg: 20, zoom: 1 });
      unmount();
    }
  });

  it('keeps arrow pan aligned with the screen after the camera rotates to the far side', () => {
    const geometry = buildGeometry('hex-r2');
    const bounds = sceneBounds(geometry);
    const rect = { left: 0, top: 0, width: 1100, height: 700 };
    const surface = document.createElement('div');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ ...rect, x: 0, y: 0,
      right: rect.width, bottom: rect.height, toJSON() {} });
    const { result, rerender } = renderHook(({ projection }: { projection: ProjectionSnapshot | null }) =>
      useBoardViewport({ geometry, bounds, surfaceRef: { current: surface }, renderer: 'r3f', projection }),
    { initialProps: { projection: null as ProjectionSnapshot | null } });
    act(() => { result.current.setZoom(2); result.current.rotate(180); });
    const point = { x: 0, y: 0, z: 0 };
    let projection = snapshot(bounds, result.current.viewport);
    rerender({ projection });
    const before = projectWorldPoint({ matrix: projection.viewProjection, rect, point });
    act(() => result.current.surfaceProps.onKeyDown({ target: surface, currentTarget: surface,
      key: 'ArrowRight', preventDefault() {} } as never));
    projection = snapshot(bounds, result.current.viewport);
    rerender({ projection });
    const right = projectWorldPoint({ matrix: projection.viewProjection, rect, point });
    expect(right.x - before.x).toBeCloseTo(-rect.width * 0.08, 5);
    expect(right.y).toBeCloseTo(before.y, 5);
    act(() => result.current.surfaceProps.onKeyDown({ target: surface, currentTarget: surface,
      key: 'ArrowUp', preventDefault() {} } as never));
    projection = snapshot(bounds, result.current.viewport);
    const up = projectWorldPoint({ matrix: projection.viewProjection, rect, point });
    expect(up.x).toBeCloseTo(right.x, 5);
    expect(up.y - right.y).toBeCloseTo(rect.height * 0.08, 5);
  });
});
