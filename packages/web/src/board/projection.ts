import type { BoardGeometry, Point } from './geometry.ts';
import type {
  CssRect,
  ProjectedAnchor,
  ProjectedTarget,
  ProjectionSnapshot,
  WorldPoint,
} from './render-contract.ts';
import type { TargetKind } from './targets.ts';
import { boardViewport, parseViewBox } from './viewport.ts';
import { targetHeight } from './sea.ts';

export interface ProjectionTarget {
  kind: TargetKind;
  index: number;
  world: WorldPoint;
  endpoints?: readonly [WorldPoint, WorldPoint];
}

export interface ProjectWorldPointOptions {
  matrix: readonly number[];
  point: WorldPoint;
  rect: CssRect;
  clip?: { near: number; far: number };
}

export interface ProjectSvgTargetsOptions {
  geometry: BoardGeometry;
  kind: TargetKind;
  indices: readonly number[];
  rect: CssRect;
  center: { x: number; z: number };
  zoom: number;
}

export function svgPanForCenter(
  geometry: BoardGeometry,
  center: { x: number; z: number },
  zoom: number,
): Point {
  const viewBox = parseViewBox(geometry.viewBox);
  // SvgBoard applies translate(viewBoxCenter + pan) * scale(zoom) *
  // translate(-viewBoxCenter). Keep exact centering even for nonzero topology centers.
  return {
    x: (viewBox.x + viewBox.width / 2 - center.x * geometry.scale) * zoom,
    y: (viewBox.y + viewBox.height / 2 - center.z * geometry.scale) * zoom,
  };
}

const DEFAULT_CLIP = { near: -1, far: 1 } as const;

function finiteRect(rect: CssRect): boolean {
  return Number.isFinite(rect.left) && Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width > 0 && rect.height > 0;
}

function insideRect(point: Point, rect: CssRect): boolean {
  return point.x >= rect.left && point.x <= rect.left + rect.width &&
    point.y >= rect.top && point.y <= rect.top + rect.height;
}

/** Converts SVG user-space geometry into the board plane used by the 3D scene. */
export function geometryPointToWorld(geometry: BoardGeometry, point: Point): WorldPoint {
  const scale = geometry.scale > 0 && Number.isFinite(geometry.scale) ? geometry.scale : 1;
  return { x: point.x / scale, y: 0, z: point.y / scale };
}

/**
 * Projects one world-space point with a column-major view-projection matrix.
 * The camera convention is positive `w`; points behind the camera or outside
 * the clip/NDC bounds remain non-interactive even if their x/y arithmetic
 * happens to land on screen.
 */
export function projectWorldPoint({
  matrix,
  point,
  rect,
  clip = DEFAULT_CLIP,
}: ProjectWorldPointOptions): ProjectedAnchor {
  if (matrix.length !== 16 || !finiteRect(rect) || !Number.isFinite(clip.near) ||
      !Number.isFinite(clip.far) || clip.near >= clip.far ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
    return { x: Number.NaN, y: Number.NaN, visible: false };
  }

  const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15] = matrix;
  if (![...matrix].every(Number.isFinite)) {
    return { x: Number.NaN, y: Number.NaN, visible: false };
  }

  const clipX = m0! * point.x + m4! * point.y + m8! * point.z + m12!;
  const clipY = m1! * point.x + m5! * point.y + m9! * point.z + m13!;
  const clipZ = m2! * point.x + m6! * point.y + m10! * point.z + m14!;
  const clipW = m3! * point.x + m7! * point.y + m11! * point.z + m15!;
  if (![clipX, clipY, clipZ, clipW].every(Number.isFinite) || clipW <= 0) {
    return { x: Number.NaN, y: Number.NaN, visible: false };
  }

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  const ndcZ = clipZ / clipW;
  const x = rect.left + (ndcX + 1) * 0.5 * rect.width;
  const y = rect.top + (1 - ndcY) * 0.5 * rect.height;
  const visible = [ndcX, ndcY, ndcZ].every(Number.isFinite) &&
    ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1 &&
    ndcZ >= clip.near && ndcZ <= clip.far;
  return { x, y, visible };
}

/** Projects a target anchor and, for roads, both world-space endpoints. */
export function projectWorldTarget(
  target: ProjectionTarget,
  projection: ProjectionSnapshot,
): ProjectedTarget {
  const options = {
    matrix: projection.viewProjection,
    rect: projection.rect,
    clip: projection.clip,
  };
  const anchor = projectWorldPoint({ ...options, point: target.world });
  const endpoints = target.endpoints?.map((point) =>
    projectWorldPoint({ ...options, point })) as [ProjectedAnchor, ProjectedAnchor] | undefined;
  return {
    ...anchor,
    kind: target.kind,
    index: target.index,
    ...(endpoints ? { endpoints } : {}),
  };
}

/** Builds renderer-neutral world targets from the already-authoritative geometry IDs. */
export function targetsFromGeometry(
  geometry: BoardGeometry,
  kind: TargetKind,
  indices: readonly number[],
): ProjectionTarget[] {
  const out: ProjectionTarget[] = [];
  // Sea targets (pirate hexes, ship paths out at sea) sit on the water plane.
  const lift = (point: WorldPoint, height: number): WorldPoint => (height === 0 ? point : { ...point, y: height });
  for (const index of indices) {
    if (kind === 'vertex') {
      const vertex = geometry.vertices[index];
      if (vertex) out.push({ kind, index, world: lift(geometryPointToWorld(geometry, vertex), targetHeight(geometry, kind, index)) });
    } else if (kind === 'edge') {
      const edge = geometry.edges[index];
      if (edge) {
        const height = targetHeight(geometry, kind, index);
        out.push({
          kind,
          index,
          world: lift(geometryPointToWorld(geometry, { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 }), height),
          endpoints: [
            lift(geometryPointToWorld(geometry, { x: edge.x1, y: edge.y1 }), height),
            lift(geometryPointToWorld(geometry, { x: edge.x2, y: edge.y2 }), height),
          ],
        });
      }
    } else {
      const hex = geometry.hexes[index];
      if (hex) out.push({ kind, index, world: lift(geometryPointToWorld(geometry, { x: hex.cx, y: hex.cy }), targetHeight(geometry, kind, index)) });
    }
  }
  return out;
}

/** Uses the existing SVG viewBox transform while preserving the 3D target shape. */
export function projectSvgTargets({
  geometry,
  kind,
  indices,
  rect,
  center,
  zoom,
}: ProjectSvgTargetsOptions): ProjectedTarget[] {
  if (!finiteRect(rect) || !Number.isFinite(zoom) || zoom <= 0 ||
      !Number.isFinite(center.x) || !Number.isFinite(center.z)) return [];
  const viewport = boardViewport({
    viewBox: parseViewBox(geometry.viewBox),
    rect,
    zoom,
    pan: svgPanForCenter(geometry, center, zoom),
  });
  if (!viewport) return [];

  const anchor = (point: Point): ProjectedAnchor => {
    const projected = viewport.worldToScreen(point);
    return {
      x: projected.x,
      y: projected.y,
      visible: Number.isFinite(projected.x) && Number.isFinite(projected.y) && insideRect(projected, rect),
    };
  };

  return targetsFromGeometry(geometry, kind, indices).map((target) => {
    const point = { x: target.world.x * geometry.scale, y: target.world.z * geometry.scale };
    const projected = anchor(point);
    const endpoints = target.endpoints?.map((world) =>
      anchor({ x: world.x * geometry.scale, y: world.z * geometry.scale })) as
      [ProjectedAnchor, ProjectedAnchor] | undefined;
    return {
      ...projected,
      kind,
      index: target.index,
      ...(endpoints ? { endpoints } : {}),
    };
  });
}
