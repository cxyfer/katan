import { act, renderHook } from '@testing-library/react';
import { Matrix4, OrthographicCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { projectWorldPoint } from '../src/board/projection.ts';
import type { ProjectionSnapshot, RendererMode } from '../src/board/render-contract.ts';
import { sceneBounds } from '../src/board/three/bounds.ts';
import { applySceneCamera, fitSceneCamera } from '../src/board/three/camera.ts';
import { useBoardViewport } from '../src/board/useBoardViewport.ts';

function setup(renderer: RendererMode = 'r3f') {
  const geometry = buildGeometry('hex-r2');
  const bounds = sceneBounds(geometry);
  const rect = { left: 0, top: 0, width: 1100, height: 700 };
  const surface = document.createElement('div');
  const capture = vi.fn();
  const release = vi.fn();
  Object.assign(surface, { setPointerCapture: capture, releasePointerCapture: release });
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ ...rect, x: 0, y: 0,
    right: rect.width, bottom: rect.height, toJSON() {} });
  const surfaceRef = { current: surface };
  const hook = renderHook(({ projection }: { projection: ProjectionSnapshot | null }) =>
    useBoardViewport({ geometry, bounds, surfaceRef, renderer, projection }),
  { initialProps: { projection: null as ProjectionSnapshot | null } });
  function project() {
    const viewport = hook.result.current.viewport;
    const camera = new OrthographicCamera();
    applySceneCamera(camera, fitSceneCamera(bounds, rect, viewport.azimuthDeg, viewport.elevationDeg), viewport);
    const projection: ProjectionSnapshot = {
      viewProjection: new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray(),
      rect, cameraZoom: camera.zoom, clip: { near: -1, far: 1 }, version: 1,
    };
    hook.rerender({ projection });
    return projection;
  }
  function pointer(type: 'Down' | 'Move' | 'Up' | 'Cancel', x: number, y: number,
    options: { pointerType?: string; pointerId?: number; button?: number; buttons?: number; shiftKey?: boolean } = {}) {
    act(() => hook.result.current.surfaceProps[`onPointer${type}`]({
      currentTarget: surface, target: surface, pointerId: 1, pointerType: 'mouse', button: 0,
      clientX: x, clientY: y, preventDefault: vi.fn(), ...options,
    } as never));
  }
  return { ...hook, surface, geometry, rect, capture, release, project, pointer };
}

describe('single-owner 3D orbit gestures', () => {
  it('rotates and tilts a held left drag without panning, suppressing only its synthetic click', () => {
    const { result, project, pointer, capture, release } = setup();
    act(() => result.current.setZoom(2));
    const initial = project();
    const center = { ...result.current.viewport.center };
    pointer('Down', 100, 100);
    pointer('Move', 103, 102);
    expect(capture).not.toHaveBeenCalled();
    expect(result.current.viewport).toMatchObject({ azimuthDeg: 20, elevationDeg: 50, center });
    pointer('Move', 120, 116);
    expect(capture).toHaveBeenCalledWith(1);
    expect(result.current.viewport).toMatchObject({ azimuthDeg: 13, elevationDeg: 54, zoom: 2, center });
    expect(project().viewProjection).not.toEqual(initial.viewProjection);
    pointer('Up', 120, 116);
    expect(release).toHaveBeenCalledWith(1);
    expect(result.current.gestureActive).toBe(false);
    expect(result.current.consumeSuppressedClick()).toBe(true);
    expect(result.current.consumeSuppressedClick()).toBe(false);
    pointer('Down', 120, 116);
    pointer('Up', 120, 116);
    expect(result.current.consumeSuppressedClick()).toBe(false);
  });

  it.each([{ shiftKey: true, button: 0 }, { shiftKey: false, button: 2 }])(
    'pans using Shift-left or right drag while retaining camera orientation (%j)', (options) => {
      const { result, project, pointer, rect, surface } = setup();
      act(() => { result.current.setZoom(2); result.current.rotate(90); result.current.setElevation(35); });
      const initial = project();
      const point = { x: 0, y: 0, z: 0 };
      const before = projectWorldPoint({ matrix: initial.viewProjection, rect, point });
      pointer('Down', 100, 100, options);
      pointer('Move', 120, 112, options);
      pointer('Up', 120, 112, options);
      const after = projectWorldPoint({ matrix: project().viewProjection, rect, point });
      expect(after.x - before.x).toBeCloseTo(20, 5);
      expect(after.y - before.y).toBeCloseTo(12, 5);
      expect(result.current.viewport).toMatchObject({ azimuthDeg: 110, elevationDeg: 35, zoom: 2 });
      expect(result.current.consumeSuppressedClick()).toBe(true);
      const preventDefault = vi.fn();
      act(() => result.current.surfaceProps.onContextMenu({ currentTarget: surface, preventDefault } as never));
      expect(preventDefault).toHaveBeenCalledOnce();
    },
  );

  it('preserves the SVG left-drag pan and native context menu', () => {
    const { result, pointer, surface } = setup('svg');
    act(() => result.current.setZoom(2));
    const center = { ...result.current.viewport.center };
    pointer('Down', 100, 100);
    pointer('Move', 120, 112);
    pointer('Up', 120, 112);
    expect(result.current.viewport.center).not.toEqual(center);
    expect(result.current.viewport).toMatchObject({ azimuthDeg: 20, elevationDeg: 50 });
    pointer('Down', 100, 100, { button: 2 });
    expect(result.current.gestureActive).toBe(false);
    const preventDefault = vi.fn();
    act(() => result.current.surfaceProps.onContextMenu({ currentTarget: surface, preventDefault } as never));
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('rebases touch orbit to pinch/pan and back without losing view angle or causing a jump', () => {
    const { result, project, pointer, surface } = setup();
    act(() => result.current.setZoom(2));
    project();
    const touch1 = { pointerType: 'touch', pointerId: 1 };
    const touch2 = { pointerType: 'touch', pointerId: 2 };
    pointer('Down', 100, 100, touch1);
    pointer('Move', 120, 112, touch1);
    expect(result.current.viewport).toMatchObject({ azimuthDeg: 13, elevationDeg: 53 });
    const orbitCenter = { ...result.current.viewport.center };
    project();
    pointer('Down', 200, 112, touch2);
    pointer('Move', 240, 112, touch2);
    expect(result.current.viewport).toMatchObject({ azimuthDeg: 13, elevationDeg: 53, zoom: 3 });
    const pinched = { ...result.current.viewport, center: { ...result.current.viewport.center } };
    expect(pinched.center).not.toEqual(orbitCenter);
    pointer('Up', 240, 112, touch2);
    act(() => result.current.surfaceProps.onLostPointerCapture({ pointerId: 2, target: surface, currentTarget: surface } as never));
    expect(result.current.gestureActive).toBe(true);
    pointer('Move', 120, 112, touch1);
    expect(result.current.viewport).toEqual(pinched);
    pointer('Move', 124, 116, touch1);
    expect(result.current.viewport.azimuthDeg).toBeCloseTo(11.6, 8);
    expect(result.current.viewport.elevationDeg).toBe(54);
    expect(result.current.viewport.center).toEqual(pinched.center);
    expect(result.current.viewport.zoom).toBe(3);
    pointer('Up', 124, 116, touch1);
    expect(result.current.gestureActive).toBe(false);
    expect(result.current.consumeSuppressedClick()).toBe(true);
  });

  it.each(['cancel', 'capture', 'blur'] as const)('cleans an orbit on %s and accepts a following tap', (exit) => {
    const { result, pointer, surface, release } = setup();
    pointer('Down', 100, 100);
    pointer('Move', 130, 120);
    if (exit === 'cancel') pointer('Cancel', 130, 120);
    else if (exit === 'capture') act(() => result.current.surfaceProps.onLostPointerCapture({
      pointerId: 1, target: surface, currentTarget: surface } as never));
    else act(() => result.current.surfaceProps.onBlur({ currentTarget: surface, relatedTarget: null } as never));
    expect(result.current.gestureActive).toBe(false);
    expect(release).toHaveBeenCalledWith(1);
    expect(result.current.consumeSuppressedClick()).toBe(true);
    const view = result.current.viewport;
    pointer('Move', 300, 400);
    expect(result.current.viewport).toEqual(view);
    pointer('Down', 100, 100);
    pointer('Up', 100, 100);
    expect(result.current.consumeSuppressedClick()).toBe(false);
  });

  it('wraps azimuth, clamps both tilt limits, and keeps zoom unchanged during orbit', () => {
    const { result, pointer } = setup();
    pointer('Down', 100, 100);
    pointer('Move', 2100, 1100);
    expect(result.current.viewport).toMatchObject({ azimuthDeg: 40, elevationDeg: 80, zoom: 1 });
    pointer('Move', -1900, -900);
    expect(result.current.viewport).toMatchObject({ azimuthDeg: 0, elevationDeg: 25, zoom: 1 });
    pointer('Up', -1900, -900);
  });

  it.each([1, 2])('keeps pinch translation at 20 CSS px with source camera zoom %s, without a projection-update jump', (sourceZoom) => {
    const { result, project, pointer, rect } = setup();
    act(() => { result.current.setZoom(sourceZoom); result.current.setElevation(35); result.current.rotate(90); });
    const initial = project();
    // The UI can already request zoom 2 while the latest published matrix is
    // still zoom 1. Its metadata, rather than viewRef, must set the conversion.
    act(() => result.current.setZoom(2));
    const fit = result.current.cameraFit!;
    const point = { ...fit.target };
    const before = projectWorldPoint({ matrix: initial.viewProjection, rect, point });
    const touch1 = { pointerType: 'touch', pointerId: 1 };
    const touch2 = { pointerType: 'touch', pointerId: 2 };
    pointer('Down', 100, 350, touch1);
    pointer('Down', 180, 350, touch2);
    pointer('Move', 220, 350, touch2);
    expect(result.current.viewport.zoom).toBe(3);
    const firstProjection = project();
    const after = projectWorldPoint({ matrix: firstProjection.viewProjection, rect, point });
    expect(after.x - before.x).toBeCloseTo(20, 5);
    expect(after.y - before.y).toBeCloseTo(0, 5);
    const firstCenter = { ...result.current.viewport.center };
    // Publishing the zoom-3 projection cannot change the already active pinch's
    // coordinate basis when the same pointer positions arrive again.
    pointer('Move', 220, 350, touch2);
    expect(result.current.viewport.center).toEqual(firstCenter);
    const repeated = projectWorldPoint({ matrix: project().viewProjection, rect, point });
    expect(repeated.x).toBeCloseTo(after.x, 8);
    expect(repeated.y).toBeCloseTo(after.y, 8);
    pointer('Up', 220, 350, touch2);
    pointer('Up', 100, 350, touch1);
  });

  it.each(['pointerup', 'pointercancel'])('ends a pre-capture edge gesture on an outside %s', (type) => {
    const { result, pointer, capture } = setup();
    const initial = result.current.viewport;
    pointer('Down', 2, 100, { buttons: 1 });
    pointer('Move', -2, 100, { buttons: 1 });
    expect(capture).not.toHaveBeenCalled();
    expect(result.current.gestureActive).toBe(true);
    const outside = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(outside, { pointerId: { value: 1 }, pointerType: { value: 'mouse' },
      buttons: { value: 0 }, clientX: { value: -2 }, clientY: { value: 100 } });
    act(() => window.dispatchEvent(outside));
    expect(result.current.gestureActive).toBe(false);
    pointer('Move', 100, 130, { buttons: 0 });
    expect(result.current.viewport).toEqual(initial);
    pointer('Down', 100, 100, { buttons: 1 });
    pointer('Up', 100, 100, { buttons: 0 });
    expect(result.current.consumeSuppressedClick()).toBe(false);
  });

  it.each([false, true])('cleans a missed mouseup on buttons=0 hover after capture=%s', (crossThreshold) => {
    const { result, pointer, capture } = setup();
    pointer('Down', 2, 100, { buttons: 1 });
    pointer('Move', crossThreshold ? 30 : -2, 100, { buttons: 1 });
    expect(capture.mock.calls.length > 0).toBe(crossThreshold);
    const beforeHover = result.current.viewport;
    pointer('Move', 100, 160, { buttons: 0 });
    expect(result.current.gestureActive).toBe(false);
    expect(result.current.viewport).toEqual(beforeHover);
    pointer('Move', 200, 200, { buttons: 0 });
    expect(result.current.viewport).toEqual(beforeHover);
    pointer('Down', 100, 100, { buttons: 1 });
    pointer('Up', 100, 100, { buttons: 0 });
    expect(result.current.consumeSuppressedClick()).toBe(false);
  });
});
