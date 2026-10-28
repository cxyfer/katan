import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from '../geometry.ts';
import type { SceneBounds, WorldPoint } from '../render-contract.ts';

/** Model dimensions are expressed in topology units where one hex radius is 1. */
export const BOARD_MODEL_METRICS = Object.freeze({
  tileRadius: 1,
  // Extrusion depth 0.18 plus one 0.008 bevel on each side.
  tileSideHeight: 0.196,
  tileGap: 0.012,
  roadHalfWidth: 0.05,
  terrainHeight: 0.34,
  buildingHeight: 0.31,
  robberOriginY: 0.01,
  robberLocalHeight: 0.565,
  // Hood cone translated to 0.455 with a 0.11 half-height, plus the group Y.
  robberHeight: 0.575,
  badgeHeight: 0.06,
  harborOffset: 0.38,
  harborHalfDiagonal: 0.31,
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
  const bounds: SceneBounds = {
    min: { x: Infinity, y: -BOARD_MODEL_METRICS.tileSideHeight, z: Infinity },
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
    }
  }

  for (const vertex of geometry.vertices) {
    const point = geometryToWorld(geometry, vertex.x, vertex.y);
    includePoint(bounds, {
      x: point.x,
      y: 0,
      z: point.z,
    });
  }

  // Roads overhang a shared endpoint by at most half a road width. Apply the
  // padding once after the full topology scan rather than once per vertex.
  bounds.min.x -= BOARD_MODEL_METRICS.roadHalfWidth;
  bounds.max.x += BOARD_MODEL_METRICS.roadHalfWidth;
  bounds.min.z -= BOARD_MODEL_METRICS.roadHalfWidth;
  bounds.max.z += BOARD_MODEL_METRICS.roadHalfWidth;

  // Harbors may extend beyond the topology. Their exact in-plane angle is not
  // needed for fitting, so reserve the plaque half diagonal around each edge
  // midpoint. This remains complete if art direction changes the long axis.
  const [viewX, viewY, viewWidth, viewHeight] = geometry.viewBox.trim().split(/[\s,]+/).map(Number);
  const width = viewWidth! / geometry.scale;
  const height = viewHeight! / geometry.scale;
  if (Number.isFinite(width) && Number.isFinite(height)) {
    const edgeExtension = Math.max(BOARD_MODEL_METRICS.harborOffset, BOARD_MODEL_METRICS.harborHalfDiagonal);
    const left = viewX! / geometry.scale;
    const top = viewY! / geometry.scale;
    bounds.min.x = Math.min(bounds.min.x, left - edgeExtension);
    bounds.max.x = Math.max(bounds.max.x, left + width + edgeExtension);
    bounds.min.z = Math.min(bounds.min.z, top - edgeExtension);
    bounds.max.z = Math.max(bounds.max.z, top + height + edgeExtension);
  }

  if (![bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)) {
    return { min: { x: -1, y: -BOARD_MODEL_METRICS.tileSideHeight, z: -1 }, max: { x: 1, y: 1, z: 1 } };
  }
  return bounds;
}

export function boundsCenter(bounds: SceneBounds): BoardPlanePoint {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}
