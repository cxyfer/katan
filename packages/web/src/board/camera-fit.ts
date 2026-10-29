import type { CssRect, SceneBounds, WorldPoint } from './render-contract.ts';

export interface CameraFitOptions {
  bounds: SceneBounds;
  rect: CssRect;
  elevationDeg?: number;
  azimuthDeg?: number;
  /** Fractional safety margin around the complete scene bounds. */
  margin?: number;
}

export interface OrthographicFrustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

export interface OrthographicCameraFit {
  position: WorldPoint;
  target: WorldPoint;
  up: readonly [number, number, number];
  frustum: OrthographicFrustum;
  /** BoardViewportState's fit-relative zoom. The camera's base fit is 1. */
  zoom: 1;
  elevationDeg: number;
  azimuthDeg: number;
}

function subtract(a: WorldPoint, b: WorldPoint): WorldPoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: WorldPoint, b: WorldPoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
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
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new RangeError('camera direction must have non-zero length');
  }
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function finiteBounds(bounds: SceneBounds): boolean {
  return [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]
    .every(Number.isFinite) &&
    bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z;
}

/**
 * Fits the complete model envelope (or all eight bounds corners) into an orthographic
 * camera. Desktop callers use the default 50 degree elevation; a narrow
 * portrait caller passes 60 degrees. The initial azimuth is 20 degrees.
 */
export function fitOrthographicCamera(
  bounds: SceneBounds,
  viewport: CssRect,
  {
    elevationDeg = 50,
    azimuthDeg = 20,
    margin = 0.08,
  }: Omit<CameraFitOptions, 'bounds' | 'rect'> = {},
): OrthographicCameraFit {
  if (!finiteBounds(bounds)) throw new RangeError('scene bounds must be finite and ordered');
  if (bounds.fitPoints && (bounds.fitPoints.length === 0 || bounds.fitPoints.some((point) =>
    ![point.x, point.y, point.z].every(Number.isFinite)))) {
    throw new RangeError('scene fit points must be nonempty and finite');
  }
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new RangeError('camera fit requires a positive CSS rect');
  }
  if (![elevationDeg, azimuthDeg, margin].every(Number.isFinite) || elevationDeg < 0 ||
      elevationDeg >= 90 || margin < 0) {
    throw new RangeError('invalid camera fit parameters');
  }

  const target = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  const elevation = elevationDeg * Math.PI / 180;
  const azimuth = azimuthDeg * Math.PI / 180;
  const fromTarget = normalize({
    x: Math.sin(azimuth) * Math.cos(elevation),
    y: Math.sin(elevation),
    z: Math.cos(azimuth) * Math.cos(elevation),
  });
  const forward = { x: -fromTarget.x, y: -fromTarget.y, z: -fromTarget.z };
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const cameraUp = normalize(cross(right, forward));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxForward = 0;
  const points = bounds.fitPoints ?? [bounds.min.x, bounds.max.x].flatMap((x) =>
    [bounds.min.y, bounds.max.y].flatMap((y) => [bounds.min.z, bounds.max.z].map((z) => ({ x, y, z }))));
  for (const point of points) {
    const relative = subtract(point, target);
    const projectedX = dot(relative, right);
    const projectedY = dot(relative, cameraUp);
    minX = Math.min(minX, projectedX);
    maxX = Math.max(maxX, projectedX);
    minY = Math.min(minY, projectedY);
    maxY = Math.max(maxY, projectedY);
    maxForward = Math.max(maxForward, Math.abs(dot(relative, forward)));
  }

  const aspect = viewport.width / viewport.height;
  // The target stays at the bounds center; an asymmetric envelope must reserve
  // its furthest extent on each axis instead of half its min/max span.
  const halfHeight = Math.max(Math.abs(minY), Math.abs(maxY),
    Math.abs(minX) / aspect, Math.abs(maxX) / aspect) * (1 + margin);
  const halfWidth = halfHeight * aspect;
  const radius = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) / 2;
  const distance = Math.max(radius * 3, 1);
  const visibleDepth = maxForward + Math.max(radius * 0.5, 1);
  const near = Math.max(distance - visibleDepth, 0.01);
  const far = distance + visibleDepth;

  return {
    position: {
      x: target.x + fromTarget.x * distance,
      y: target.y + fromTarget.y * distance,
      z: target.z + fromTarget.z * distance,
    },
    target,
    up: [0, 1, 0],
    frustum: {
      left: -halfWidth,
      right: halfWidth,
      top: halfHeight,
      bottom: -halfHeight,
      near,
      far,
    },
    zoom: 1,
    elevationDeg,
    azimuthDeg,
  };
}
