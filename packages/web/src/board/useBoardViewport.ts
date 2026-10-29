import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
  type WheelEventHandler,
} from 'react';
import { fitOrthographicCamera, type OrthographicCameraFit } from './camera-fit.ts';
import type { BoardGeometry } from './geometry.ts';
import type { BoardIntent } from './intent.ts';
import {
  projectSvgTargets,
  projectWorldPoint,
  projectWorldTarget,
  svgPanForCenter,
  targetsFromGeometry,
} from './projection.ts';
import type {
  BoardViewportState,
  CssRect,
  ProjectedTarget,
  ProjectedAnchor,
  WorldPoint,
  ProjectionSnapshot,
  RendererMode,
  SceneBounds,
} from './render-contract.ts';
import { boardViewport, parseViewBox } from './viewport.ts';
import { CAMERA_AZIMUTH_DEG, cameraElevation } from './three/camera.ts';

export const MIN_BOARD_ZOOM = 0.7;
export const MAX_BOARD_ZOOM = 3;
export const MIN_CAMERA_ELEVATION = 25;
export const MAX_CAMERA_ELEVATION = 80;
export const DRAG_SUPPRESSION_PX = 6;
export const ORBIT_AZIMUTH_DEG_PER_PX = 0.35;
export const ORBIT_ELEVATION_DEG_PER_PX = 0.25;

export type ViewportSurface = Element & {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

export interface BoardGestureProps {
  onPointerDown: PointerEventHandler<Element>;
  onPointerMove: PointerEventHandler<Element>;
  onPointerUp: PointerEventHandler<Element>;
  onPointerCancel: PointerEventHandler<Element>;
  onLostPointerCapture: PointerEventHandler<Element>;
  onBlur: FocusEventHandler<Element>;
  onWheel: WheelEventHandler<Element>;
  onKeyDown: KeyboardEventHandler<Element>;
  onContextMenu: MouseEventHandler<Element>;
  style: CSSProperties;
  'aria-busy': boolean;
  'data-gesture-active': 'true' | 'false';
}

export interface UseBoardViewportOptions {
  geometry: BoardGeometry;
  surfaceRef: RefObject<ViewportSurface | null>;
  /** B's complete scene bounds. When omitted, a conservative board-only bound is used. */
  bounds?: SceneBounds | null;
  projection?: ProjectionSnapshot | null;
  renderer?: RendererMode;
  initialZoom?: number;
  sceneKey?: string;
  camera?: { elevationDeg?: number; azimuthDeg?: number; margin?: number };
}

export interface BoardViewportControls {
  viewport: BoardViewportState;
  pan: { x: number; y: number };
  cameraFit: OrthographicCameraFit | null;
  setZoom: (value: number) => void;
  rotate: (deltaDeg: number) => void;
  setElevation: (value: number) => void;
  fit: () => void;
  focus: (point: WorldPoint) => void;
  projectPoint: (point: WorldPoint) => ProjectedAnchor;
  measure: () => void;
  gestureActive: boolean;
  surfaceProps: BoardGestureProps;
  consumeSuppressedClick: () => boolean;
  projectedTargets: (intent: BoardIntent | null) => ProjectedTarget[];
}

interface ViewState {
  center: { x: number; z: number };
  zoom: number;
  azimuthDeg: number;
  elevationDeg: number | null;
}

interface Point {
  x: number;
  y: number;
}

interface GestureState {
  pointers: Map<number, Point>;
  startCenter: { x: number; z: number };
  startZoom: number;
  startProjection: ProjectionSnapshot | null;
  startAzimuth: number;
  startElevation: number;
  mode: 'orbit' | 'pan';
  startCentroid: Point;
  startDistance: number;
  primaryStart: Point;
  moved: boolean;
  pinching: boolean;
  captured: Set<number>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteRect(rect: CssRect): boolean {
  return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0;
}

function centroid(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  return points.reduce(
    (out, point) => ({ x: out.x + point.x / points.length, y: out.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
}

function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Conservative fallback bounds for geometry-only callers; B's scene bounds stay authoritative. */
export function geometryBounds(geometry: BoardGeometry): SceneBounds {
  const viewBox = parseViewBox(geometry.viewBox);
  const scale = geometry.scale > 0 && Number.isFinite(geometry.scale) ? geometry.scale : 1;
  return {
    min: { x: viewBox.x / scale, y: -0.2, z: viewBox.y / scale },
    max: { x: (viewBox.x + viewBox.width) / scale, y: 0.6, z: (viewBox.y + viewBox.height) / scale },
  };
}

function boundsKey(bounds: SceneBounds): string {
  return [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]
    .map((value) => value.toFixed(6)).join(':');
}

function centerOf(bounds: SceneBounds): { x: number; z: number } {
  return { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
}

/** One gesture owner shared by the SVG and 3D surfaces. */
export function useBoardViewport({
  geometry,
  surfaceRef,
  bounds = null,
  projection = null,
  renderer = 'auto',
  initialZoom = 1,
  sceneKey,
  camera = {},
}: UseBoardViewportOptions): BoardViewportControls {
  const effectiveBounds = useMemo(() => bounds ?? geometryBounds(geometry), [bounds, geometry]);
  const fittedCenter = useMemo(() => centerOf(effectiveBounds), [effectiveBounds]);
  const requestedInitialZoom = clamp(Number.isFinite(initialZoom) ? initialZoom : 1, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
  const [view, setView] = useState<ViewState>(() => ({ center: fittedCenter, zoom: requestedInitialZoom,
    azimuthDeg: camera.azimuthDeg ?? CAMERA_AZIMUTH_DEG, elevationDeg: camera.elevationDeg ?? null }));
  const [rect, setRect] = useState<CssRect>({ left: 0, top: 0, width: 0, height: 0 });
  const [gestureActive, setGestureActive] = useState(false);
  const viewRef = useRef(view);
  const gestureRef = useRef<GestureState | null>(null);
  const inspectionCenterRef = useRef<{ x: number; z: number } | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetKeyRef = useRef(`${sceneKey ?? geometry.topologyId}:${boundsKey(effectiveBounds)}`);
  const currentResetKey = `${sceneKey ?? geometry.topologyId}:${boundsKey(effectiveBounds)}`;
  const measureRef = useRef<() => void>(() => undefined);
  viewRef.current = view;

  const clampCenter = useCallback((center: { x: number; z: number }, zoom: number) => {
    const movement = Math.max(1 - 1 / clamp(zoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM), 0);
    const halfX = (effectiveBounds.max.x - effectiveBounds.min.x) / 2;
    const halfZ = (effectiveBounds.max.z - effectiveBounds.min.z) / 2;
    const inspected = inspectionCenterRef.current;
    return {
      x: clamp(center.x, Math.min(fittedCenter.x - halfX * movement, inspected?.x ?? Infinity),
        Math.max(fittedCenter.x + halfX * movement, inspected?.x ?? -Infinity)),
      z: clamp(center.z, Math.min(fittedCenter.z - halfZ * movement, inspected?.z ?? Infinity),
        Math.max(fittedCenter.z + halfZ * movement, inspected?.z ?? -Infinity)),
    };
  }, [effectiveBounds, fittedCenter]);

  const applyView = useCallback((next: Omit<ViewState, 'azimuthDeg' | 'elevationDeg'> & {
    azimuthDeg?: number; elevationDeg?: number | null;
  }) => {
    const zoom = clamp(next.zoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
    if (zoom <= 1) inspectionCenterRef.current = null;
    const azimuthDeg = next.azimuthDeg ?? viewRef.current.azimuthDeg;
    const elevationDeg = next.elevationDeg === undefined ? viewRef.current.elevationDeg : next.elevationDeg;
    const value = { zoom, center: clampCenter(next.center, zoom), azimuthDeg: ((azimuthDeg % 360) + 360) % 360, elevationDeg };
    viewRef.current = value;
    setView(value);
  }, [clampCenter]);

  const setZoom = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const current = viewRef.current;
    applyView({ center: current.center, zoom: value });
  }, [applyView]);

  const rotate = useCallback((deltaDeg: number) => {
    if (renderer === 'svg' || !Number.isFinite(deltaDeg) || gestureRef.current) return;
    const current = viewRef.current;
    applyView({ ...current, azimuthDeg: current.azimuthDeg + deltaDeg });
  }, [applyView, renderer]);

  const setElevation = useCallback((value: number) => {
    if (renderer === 'svg' || !Number.isFinite(value) || gestureRef.current) return;
    const current = viewRef.current;
    applyView({ ...current, elevationDeg: clamp(value, MIN_CAMERA_ELEVATION, MAX_CAMERA_ELEVATION) });
  }, [applyView, renderer]);

  // Inspection may center coastal pieces beyond the normal pan envelope.
  // This is an immediate camera update, including when reduced motion is set.
  const focus = useCallback((point: WorldPoint) => {
    if (![point.x, point.y, point.z].every(Number.isFinite) || gestureRef.current) return;
    const value = { ...viewRef.current, zoom: Math.max(2.2, viewRef.current.zoom),
      center: { x: clamp(point.x, effectiveBounds.min.x, effectiveBounds.max.x),
        z: clamp(point.z, effectiveBounds.min.z, effectiveBounds.max.z) } };
    inspectionCenterRef.current = value.center;
    viewRef.current = value;
    setView(value);
  }, [effectiveBounds]);

  const fit = useCallback(() => {
    measureRef.current();
    applyView({ center: fittedCenter, zoom: 1, azimuthDeg: CAMERA_AZIMUTH_DEG, elevationDeg: null });
  }, [applyView, fittedCenter]);

  const measure = useCallback(() => {
    const node = surfaceRef.current;
    if (!node) {
      setRect((current) =>
        current.left === 0 && current.top === 0 && current.width === 0 && current.height === 0
          ? current
          : { left: 0, top: 0, width: 0, height: 0 });
      return;
    }
    const next = node.getBoundingClientRect();
    const measured = { left: next.left, top: next.top, width: next.width, height: next.height };
    if (![measured.left, measured.top, measured.width, measured.height].every(Number.isFinite) ||
        measured.width < 0 || measured.height < 0) {
      setRect((current) =>
        current.left === 0 && current.top === 0 && current.width === 0 && current.height === 0
          ? current
          : { left: 0, top: 0, width: 0, height: 0 });
      return;
    }
    setRect((current) =>
      current.left === measured.left && current.top === measured.top &&
      current.width === measured.width && current.height === measured.height ? current : measured);
  }, [surfaceRef]);
  measureRef.current = measure;

  useLayoutEffect(() => {
    measure();
    const onLayoutChange = () => measure();
    globalThis.addEventListener('resize', onLayoutChange);
    // Scroll events do not bubble, so capture catches page/ancestor/HUD scrolling.
    globalThis.addEventListener('scroll', onLayoutChange, true);

    const node = surfaceRef.current;
    const layoutRoot = node?.closest<HTMLElement>('[data-board-stage], [data-testid="game-stage"]') ??
      node?.parentElement ?? null;
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(onLayoutChange)
      : null;
    if (node && resizeObserver) {
      resizeObserver.observe(node);
      // Size-only observation misses ancestor reflow that moves the surface.
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        resizeObserver.observe(ancestor);
        if (ancestor === layoutRoot || ancestor === document.body) break;
      }
    }

    const mutationObserver = layoutRoot && typeof MutationObserver === 'function'
      ? new MutationObserver(onLayoutChange)
      : null;
    mutationObserver?.observe(layoutRoot!, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'open', 'hidden'],
    });

    const visualViewport = globalThis.visualViewport;
    visualViewport?.addEventListener('resize', onLayoutChange, { passive: true });
    visualViewport?.addEventListener('scroll', onLayoutChange, { passive: true });
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) measure();
    }).catch(() => undefined);
    return () => {
      active = false;
      globalThis.removeEventListener('resize', onLayoutChange);
      globalThis.removeEventListener('scroll', onLayoutChange, true);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      visualViewport?.removeEventListener('resize', onLayoutChange);
      visualViewport?.removeEventListener('scroll', onLayoutChange);
    };
  }, [currentResetKey, measure, surfaceRef]);

  useEffect(() => {
    if (resetKeyRef.current === currentResetKey) return;
    resetKeyRef.current = currentResetKey;
    inspectionCenterRef.current = null;
    applyView({ center: fittedCenter, zoom: requestedInitialZoom, azimuthDeg: CAMERA_AZIMUTH_DEG, elevationDeg: null });
  }, [applyView, currentResetKey, fittedCenter, requestedInitialZoom]);

  const screenDeltaToWorld = useCallback((
    delta: Point,
    zoom: number,
    around: { x: number; z: number },
    snapshot: ProjectionSnapshot | null = projection,
  ): Point => {
    if (renderer !== 'svg' && snapshot) {
      const epsilon = 0.005;
      const basePoint = { x: around.x, y: 0, z: around.z };
      const base = projectWorldPoint({ matrix: snapshot.viewProjection, point: basePoint, rect: snapshot.rect, clip: snapshot.clip });
      const plusX = projectWorldPoint({
        matrix: snapshot.viewProjection,
        point: { x: around.x + epsilon, y: 0, z: around.z },
        rect: snapshot.rect,
        clip: snapshot.clip,
      });
      const plusZ = projectWorldPoint({
        matrix: snapshot.viewProjection,
        point: { x: around.x, y: 0, z: around.z + epsilon },
        rect: snapshot.rect,
        clip: snapshot.clip,
      });
      if (base.visible && plusX.visible && plusZ.visible) {
        const a = (plusX.x - base.x) / epsilon;
        const b = (plusX.y - base.y) / epsilon;
        const c = (plusZ.x - base.x) / epsilon;
        const d = (plusZ.y - base.y) / epsilon;
        const determinant = a * d - c * b;
        if (Number.isFinite(determinant) && Math.abs(determinant) > 1e-8) {
          // A pinch changes zoom while using its frozen starting matrix. Scale
          // from that matrix's real camera zoom, not possibly pending view state.
          const zoomScale = snapshot.cameraZoom !== undefined && Number.isFinite(snapshot.cameraZoom) && snapshot.cameraZoom > 0
            ? snapshot.cameraZoom / clamp(zoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM) : 1;
          const worldX = (delta.x * d - c * delta.y) / determinant * zoomScale;
          const worldZ = (a * delta.y - b * delta.x) / determinant * zoomScale;
          if (Number.isFinite(worldX) && Number.isFinite(worldZ)) {
            return { x: worldX, y: worldZ };
          }
        }
      }
    }
    const viewport = boardViewport({
      viewBox: parseViewBox(geometry.viewBox),
      rect,
      zoom,
      pan: { x: 0, y: 0 },
    });
    if (!viewport) return { x: 0, y: 0 };
    const svgDelta = viewport.screenDeltaToPan(delta);
    return { x: svgDelta.x / geometry.scale / zoom, y: svgDelta.y / geometry.scale / zoom };
  }, [geometry, projection, rect, renderer]);

  const startGesture = useCallback((pointerId: number, point: Point, mode: GestureState['mode']) => {
    const current = viewRef.current;
    gestureRef.current = {
      pointers: new Map([[pointerId, point]]),
      startCenter: current.center,
      startZoom: current.zoom,
      startProjection: projection,
      startAzimuth: current.azimuthDeg,
      startElevation: current.elevationDeg ?? cameraElevation(rect),
      mode,
      startCentroid: point,
      startDistance: 0,
      primaryStart: point,
      moved: false,
      pinching: false,
      captured: new Set(),
    };
    setGestureActive(true);
  }, [projection, rect]);

  const armClickSuppression = useCallback(() => {
    if (suppressTimerRef.current !== null) clearTimeout(suppressTimerRef.current);
    suppressClickRef.current = true;
    // A pointer gesture's synthetic click is dispatched in the same task. Any
    // later deliberate tap must not inherit suppression if no click arrived.
    suppressTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, 0);
  }, []);

  const rebasePinch = useCallback((gesture: GestureState) => {
    const current = viewRef.current;
    const points = [...gesture.pointers.values()];
    if (points[0]) gesture.primaryStart = points[0];
    gesture.startCenter = current.center;
    gesture.startZoom = current.zoom;
    gesture.startProjection = projection;
    gesture.startAzimuth = current.azimuthDeg;
    gesture.startElevation = current.elevationDeg ?? cameraElevation(rect);
    gesture.startCentroid = centroid(points);
    gesture.startDistance = points.length > 1 ? pointerDistance(points[0]!, points[1]!) : 0;
    gesture.moved = true;
    gesture.pinching = points.length > 1;
    suppressClickRef.current = true;
  }, [projection, rect]);

  const capture = useCallback((event: { currentTarget: ViewportSurface; pointerId: number; preventDefault: () => void }, gesture: GestureState) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      gesture.captured.add(event.pointerId);
    } catch {
      // Capture can fail if the pointer already ended; cancellation cleanup remains valid.
    }
    event.preventDefault();
  }, []);

  const finishGesture = useCallback((suppressNextClick: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    // Clear ownership before releasing capture because some browsers dispatch
    // lostpointercapture synchronously from releasePointerCapture().
    gestureRef.current = null;
    for (const pointerId of gesture.captured) {
      try {
        surfaceRef.current?.releasePointerCapture?.(pointerId);
      } catch {
        // The browser may have released capture already.
      }
    }
    gesture.pointers.clear();
    gesture.captured.clear();
    if (suppressNextClick) armClickSuppression();
    setGestureActive(false);
  }, [armClickSuppression, surfaceRef]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    if (suppressTimerRef.current !== null) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
    return true;
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<Element>) => {
    if (event.pointerType === 'mouse' && event.button !== 0 &&
        (renderer === 'svg' || event.button !== 2)) return;
    // A fresh user gesture always starts with clean click suppression. The
    // click belonging to the previous gesture, when present, arrives before it.
    suppressClickRef.current = false;
    if (suppressTimerRef.current !== null) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
    const point = { x: event.clientX, y: event.clientY };
    const gesture = gestureRef.current;
    if (!gesture) {
      const mode = renderer === 'svg' || event.shiftKey || event.button === 2 ? 'pan' : 'orbit';
      startGesture(event.pointerId, point, mode);
      return;
    }
    gesture.pointers.set(event.pointerId, point);
    if (gesture.pointers.size > 1) {
      rebasePinch(gesture);
      for (const pointerId of gesture.pointers.keys()) {
        try {
          (event.currentTarget as ViewportSurface).setPointerCapture?.(pointerId);
          gesture.captured.add(pointerId);
        } catch {
          // The browser will still report cancel/lost capture when needed.
        }
      }
    }
  }, [rebasePinch, renderer, startGesture]);

  const onPointerMove = useCallback((event: React.PointerEvent<Element>) => {
    const gesture = gestureRef.current;
    if (!gesture?.pointers.has(event.pointerId)) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      finishGesture(gesture.moved || gesture.pinching);
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    gesture.pointers.set(event.pointerId, point);
    const points = [...gesture.pointers.values()];

    if (points.length > 1) {
      if (!gesture.moved) rebasePinch(gesture);
      capture(event, gesture);
      const currentCentroid = centroid(points);
      const distance = pointerDistance(points[0]!, points[1]!);
      const nextZoom = gesture.startDistance > 0
        ? gesture.startZoom * distance / gesture.startDistance
        : gesture.startZoom;
      const delta = screenDeltaToWorld({
        x: currentCentroid.x - gesture.startCentroid.x,
        y: currentCentroid.y - gesture.startCentroid.y,
      }, nextZoom, gesture.startCenter, gesture.startProjection);
      applyView({
        zoom: nextZoom,
        center: { x: gesture.startCenter.x - delta.x, z: gesture.startCenter.z - delta.y },
      });
      return;
    }

    const drag = { x: point.x - gesture.primaryStart.x, y: point.y - gesture.primaryStart.y };
    if (!gesture.moved && Math.hypot(drag.x, drag.y) < DRAG_SUPPRESSION_PX) return;
    gesture.moved = true;
    capture(event, gesture);
    if (gesture.mode === 'orbit') {
      applyView({
        zoom: gesture.startZoom,
        center: gesture.startCenter,
        azimuthDeg: gesture.startAzimuth - drag.x * ORBIT_AZIMUTH_DEG_PER_PX,
        elevationDeg: clamp(gesture.startElevation + drag.y * ORBIT_ELEVATION_DEG_PER_PX,
          MIN_CAMERA_ELEVATION, MAX_CAMERA_ELEVATION),
      });
      return;
    }
    const delta = screenDeltaToWorld(drag, gesture.startZoom, gesture.startCenter, gesture.startProjection);
    applyView({
      zoom: gesture.startZoom,
      center: { x: gesture.startCenter.x - delta.x, z: gesture.startCenter.z - delta.y },
    });
  }, [applyView, capture, finishGesture, rebasePinch, screenDeltaToWorld]);

  const endPointer = useCallback((pointerId: number) => {
    const gesture = gestureRef.current;
    if (!gesture?.pointers.has(pointerId)) return;
    gesture.pointers.delete(pointerId);
    if (gesture.pointers.size > 0) {
      // The lifted pointer implicitly loses capture after pointerup. It must
      // not cancel the remaining finger's freshly rebased orbit gesture.
      gesture.captured.delete(pointerId);
      rebasePinch(gesture);
      return;
    }
    finishGesture(gesture.moved || gesture.pinching);
  }, [finishGesture, rebasePinch]);

  const onPointerUp = useCallback((event: React.PointerEvent<Element>) => endPointer(event.pointerId), [endPointer]);

  const cancelGesture = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    finishGesture(true);
  }, [finishGesture]);

  useEffect(() => {
    if (!gestureActive) return;
    // Before the drag threshold there is deliberately no capture, so an up
    // outside the board still needs to release the pending gesture owner.
    const onWindowPointerUp = (event: PointerEvent) => endPointer(event.pointerId);
    const onWindowPointerCancel = (event: PointerEvent) => {
      if (gestureRef.current?.pointers.has(event.pointerId)) cancelGesture();
    };
    globalThis.addEventListener('pointerup', onWindowPointerUp);
    globalThis.addEventListener('pointercancel', onWindowPointerCancel);
    return () => {
      globalThis.removeEventListener('pointerup', onWindowPointerUp);
      globalThis.removeEventListener('pointercancel', onWindowPointerCancel);
    };
  }, [cancelGesture, endPointer, gestureActive]);

  const onLostPointerCapture = useCallback((event: React.PointerEvent<Element>) => {
    // A touch target's implicit capture loss bubbles here when ownership moves
    // to this surface. Only losing the surface's own capture cancels a gesture.
    if (event.target !== event.currentTarget) return;
    const gesture = gestureRef.current;
    if (gesture?.captured.has(event.pointerId)) cancelGesture();
  }, [cancelGesture]);

  const onBlur = useCallback((event: React.FocusEvent<Element>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    if (gestureRef.current) cancelGesture();
  }, [cancelGesture]);

  const onWheel = useCallback((event: React.WheelEvent<Element>) => {
    event.preventDefault();
    const current = viewRef.current;
    setZoom(current.zoom * (event.deltaY < 0 ? 1.12 : 0.89));
  }, [setZoom]);

  const onContextMenu = useCallback((event: React.MouseEvent<Element>) => {
    if (renderer !== 'svg') event.preventDefault();
  }, [renderer]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<Element>) => {
    if (event.target !== event.currentTarget) return;
    const current = viewRef.current;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(current.zoom * 1.25);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setZoom(current.zoom / 1.25);
    } else if (event.key === '0' || event.key === 'Home') {
      event.preventDefault();
      fit();
    } else if (renderer !== 'svg' && (event.key === '[' || event.key === ']')) {
      event.preventDefault();
      rotate(event.key === '[' ? -30 : 30);
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const stepX = (effectiveBounds.max.x - effectiveBounds.min.x) * 0.08 / current.zoom;
      const stepZ = (effectiveBounds.max.z - effectiveBounds.min.z) * 0.08 / current.zoom;
      const directionX = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const directionY = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      const delta = renderer !== 'svg' && projection
        ? screenDeltaToWorld({ x: directionX * rect.width * 0.08, y: directionY * rect.height * 0.08 }, current.zoom, current.center)
        : { x: directionX * stepX, y: directionY * stepZ };
      applyView({
        zoom: current.zoom,
        center: {
          x: current.center.x + delta.x,
          z: current.center.z + delta.y,
        },
      });
    }
  }, [applyView, effectiveBounds, fit, projection, rect, renderer, rotate, screenDeltaToWorld, setZoom]);

  useEffect(() => () => {
    gestureRef.current?.pointers.clear();
    gestureRef.current = null;
    if (suppressTimerRef.current !== null) clearTimeout(suppressTimerRef.current);
  }, []);

  const projectPoint = useCallback((point: WorldPoint): ProjectedAnchor => {
    if (!finiteRect(rect)) return { x: NaN, y: NaN, visible: false };
    if (renderer !== 'svg') {
      if (!projection || ['left', 'top', 'width', 'height'].some((key) =>
        Math.abs(projection.rect[key as keyof CssRect] - rect[key as keyof CssRect]) >= 0.5)) {
        return { x: NaN, y: NaN, visible: false };
      }
      return projectWorldPoint({ matrix: projection.viewProjection, point, rect, clip: projection.clip });
    }
    const svg = boardViewport({ viewBox: parseViewBox(geometry.viewBox), rect,
      zoom: view.zoom, pan: svgPanForCenter(geometry, view.center, view.zoom) });
    const projected = svg!.worldToScreen({ x: point.x * geometry.scale, y: point.z * geometry.scale });
    return { ...projected, visible: projected.x >= rect.left && projected.x <= rect.left + rect.width &&
      projected.y >= rect.top && projected.y <= rect.top + rect.height };
  }, [geometry, projection, rect, renderer, view]);

  const projectedTargets = useCallback((intent: BoardIntent | null): ProjectedTarget[] => {
    if (!intent || !finiteRect(rect)) return [];
    if (renderer !== 'svg' && projection) {
      const snapshotRect = projection.rect;
      const sameSurface = finiteRect(snapshotRect) &&
        Math.abs(snapshotRect.left - rect.left) < 0.5 &&
        Math.abs(snapshotRect.top - rect.top) < 0.5 &&
        Math.abs(snapshotRect.width - rect.width) < 0.5 &&
        Math.abs(snapshotRect.height - rect.height) < 0.5;
      // Never expose anchors from a resize-stale matrix/rect pair.
      if (!sameSurface) return [];
      return targetsFromGeometry(geometry, intent.kind, intent.targets)
        .map((target) => projectWorldTarget(target, projection));
    }
    return projectSvgTargets({
      geometry,
      kind: intent.kind,
      indices: intent.targets,
      rect,
      center: view.center,
      zoom: view.zoom,
    });
  }, [geometry, projection, rect, renderer, view]);

  const elevationDeg = view.elevationDeg ?? cameraElevation(rect);
  const viewport = useMemo<BoardViewportState>(() => ({
    center: view.center,
    zoom: view.zoom,
    azimuthDeg: view.azimuthDeg,
    elevationDeg,
    // A hidden/zero-sized surface is authoritative and invalidates stale targets.
    rect,
  }), [elevationDeg, rect, view]);

  const cameraFit = useMemo(() => {
    if (!finiteRect(rect)) return null;
    return fitOrthographicCamera(effectiveBounds, rect, {
      margin: 0.08, ...camera, azimuthDeg: view.azimuthDeg, elevationDeg,
    });
  }, [camera, effectiveBounds, elevationDeg, rect, view.azimuthDeg]);

  const surfaceProps: BoardGestureProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancelGesture,
    onLostPointerCapture,
    onBlur,
    onWheel,
    onKeyDown,
    onContextMenu,
    style: { touchAction: 'none', position: 'relative' },
    'aria-busy': gestureActive,
    'data-gesture-active': gestureActive ? 'true' : 'false',
  };

  return {
    viewport,
    pan: svgPanForCenter(geometry, view.center, view.zoom),
    cameraFit,
    setZoom,
    rotate,
    setElevation,
    fit,
    focus,
    projectPoint,
    measure,
    gestureActive,
    surfaceProps,
    consumeSuppressedClick,
    projectedTargets,
  };
}
