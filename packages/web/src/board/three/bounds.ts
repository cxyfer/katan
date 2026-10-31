import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from '../geometry.ts';
import type { SceneBounds, WorldPoint } from '../render-contract.ts';
import { HARBOR_STRUCTURE } from '../harbor.ts';

/** Model dimensions are expressed in topology units where one hex radius is 1. */
export const BOARD_MODEL_METRICS = Object.freeze({
  tileRadius: 1,
  // Extrusion depth 0.18 plus one 0.008 bevel on each side.
  tileSideHeight: 0.196,
  coastDepth: 0.34,
  tileGap: 0.012,
  roadHalfWidth: 0.075,
  terrainHeight: 0.86,
  buildingHeight: 0.81,
  robberOriginY: 0.01,
  robberLocalHeight: 0.92,
  robberHeight: 0.93,
  badgeHeight: 0.06,
});

export interface BoardPlanePoint {
  x: number;
  z: number;
}

/** Convert the SVG-scaled geometry into renderer world units. */
export function geometryToWorld(geometry: BoardGeometry, x: number, y: number): BoardPlanePoint {
  if (!Number.isFinite(geometry.scale) || geometry.scale <= 0) {
    throw new RangeError('Board geometry scale must be positive and finite');
  }
  return { x: x / geometry.scale, z: y / geometry.scale };
}

function includePoint(bounds: SceneBounds, point: WorldPoint): void {
  bounds.min.x = Math.min(bounds.min.x, point.x);
  bounds.min.y = Math.min(bounds.min.y, point.y);
  bounds.min.z = Math.min(bounds.min.z, point.z);
  bounds.max.x = Math.max(bounds.max.x, point.x);
  bounds.max.y = Math.max(bounds.max.y, point.y);
  bounds.max.z = Math.max(bounds.max.z, point.z);
}

/**
 * Complete conservative model bounds for camera fitting.
 *
 * The horizontal extent comes from all shared topology points. Harbors are
 * included with a conservative plaque radius. The vertical extent includes
 * every procedural model family, including the tile side and the tallest roof
 * or robber, even when a particular sparse board does not currently use it.
 */
export function sceneBounds(geometry: BoardGeometry, _board?: PublicBoardView): SceneBounds {
  const fitPoints: WorldPoint[] = [];
  const bounds: SceneBounds = {
    min: { x: Infinity, y: -BOARD_MODEL_METRICS.coastDepth, z: Infinity },
    max: { x: -Infinity, y: Math.max(
      BOARD_MODEL_METRICS.terrainHeight,
      BOARD_MODEL_METRICS.buildingHeight,
      BOARD_MODEL_METRICS.robberHeight,
      BOARD_MODEL_METRICS.badgeHeight,
    ), z: -Infinity },
  };

  for (const hex of geometry.hexes) {
    for (const corner of hex.corners) {
      const point = geometryToWorld(geometry, corner.x, corner.y);
      includePoint(bounds, { x: point.x, y: 0, z: point.z });
      for (const y of [-BOARD_MODEL_METRICS.coastDepth, Math.max(BOARD_MODEL_METRICS.terrainHeight, BOARD_MODEL_METRICS.robberHeight)]) {
        fitPoints.push({ ...point, y });
      }
    }
  }

  for (const vertex of geometry.vertices) {
    const point = geometryToWorld(geometry, vertex.x, vertex.y);
    includePoint(bounds, {
      x: point.x,
      y: 0,
      z: point.z,
    });
    // A rotated city footprint fits inside this square around its vertex.
    for (const dx of [-0.31, 0.31]) for (const dz of [-0.31, 0.31]) {
      for (const y of [-BOARD_MODEL_METRICS.coastDepth, BOARD_MODEL_METRICS.buildingHeight]) {
        const corner = { x: point.x + dx, y, z: point.z + dz };
        fitPoints.push(corner);
        includePoint(bounds, corner);
      }
    }
  }

  // Roads overhang a shared endpoint by at most half a road width. Apply the
  // padding once after the full topology scan rather than once per vertex.
  bounds.min.x -= BOARD_MODEL_METRICS.roadHalfWidth;
  bounds.max.x += BOARD_MODEL_METRICS.roadHalfWidth;
  bounds.min.z -= BOARD_MODEL_METRICS.roadHalfWidth;
  bounds.max.z += BOARD_MODEL_METRICS.roadHalfWidth;

  // Fit actual coastal models instead of the SVG viewBox's label padding.
  // A pier is .85 long seaward, with .43 reserved on either side of its axis.
  for (const edge of geometry.edges) {
    const topologyEdge = geometry.topology.edges[edge.index];
    if (!topologyEdge || topologyEdge.hexes.length !== 1) continue;
    const hex = geometry.hexes[topologyEdge.hexes[0]!]!;
    const a = geometryToWorld(geometry, edge.x1, edge.y1);
    const b = geometryToWorld(geometry, edge.x2, edge.y2);
    const center = geometryToWorld(geometry, hex.cx, hex.cy);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const sign = (mx - center.x) * dz + (mz - center.z) * -dx > 0 ? 1 : -1;
    for (const side of [-1, 1]) for (const outward of [0, HARBOR_STRUCTURE.fitOffset]) {
      for (const y of [-BOARD_MODEL_METRICS.coastDepth, 0.55]) {
        const corner = {
          x: mx + dz / length * sign * outward + dx / length * side * HARBOR_STRUCTURE.fitHalfDiagonal,
          y,
          z: mz - dx / length * sign * outward + dz / length * side * HARBOR_STRUCTURE.fitHalfDiagonal,
        };
        fitPoints.push(corner);
        includePoint(bounds, corner);
      }
    }
  }

  if (![bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)) {
    return { min: { x: -1, y: -BOARD_MODEL_METRICS.tileSideHeight, z: -1 }, max: { x: 1, y: 1, z: 1 } };
  }
  return { ...bounds, fitPoints };
}

export function boundsCenter(bounds: SceneBounds): BoardPlanePoint {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}
