import type { BoardGeometry } from './geometry.ts';
import type { WorldPoint } from './render-contract.ts';
import { geometryToWorld } from './three/bounds.ts';

/**
 * One shared description of the diorama harbour and its hover footprint.
 * The 3D model, the label instance and the inspection layer all read these
 * values so a port cannot drift away from the area that can be hovered.
 */
export const HARBOR_STRUCTURE = Object.freeze({
  /** Distance from the coastal edge to the pier centre in world units. */
  pierOffset: 0.38,
  /** Deck height of the dock model. */
  deckHeight: 0.045,
  /** Harbour plaque: outward distance and height. */
  labelOffset: 0.285,
  labelHeight: 0.205,
  /** Hover footprint: the pier plus the moored boat on its seaward side. */
  hitStart: 0,
  hitEnd: 0.84,
  hitDockHalfWidth: 0.36,
  hitBoatHalfWidth: 0.44,
  hitBoatStart: 0.42,
  hitHeight: 0.22,
});

export interface HarborPlacement {
  midpoint: WorldPoint;
  /** Unit normal pointing away from the adjacent land hex. */
  normal: { x: number; z: number };
  /** Unit tangent along the coastal edge; positive is the boat's local +X side. */
  tangent: { x: number; z: number };
  /** Local +Z points outward, matching the diorama instance convention. */
  rotationY: number;
}

/**
 * Places a harbour from its public coastal edge. The edge has one adjacent
 * land hex; outward is away from that hex's centre.
 */
export function harborPlacement(geometry: BoardGeometry, edgeIndex: number): HarborPlacement | null {
  const edge = geometry.edges[edgeIndex];
  const topologyEdge = geometry.topology.edges[edgeIndex];
  if (!edge || !topologyEdge) return null;
  const a = geometryToWorld(geometry, edge.x1, edge.y1);
  const b = geometryToWorld(geometry, edge.x2, edge.y2);
  const midpoint = { x: (a.x + b.x) / 2, y: 0, z: (a.z + b.z) / 2 };
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  let normalX = dz / length;
  let normalZ = -dx / length;
  const adjacentHex = topologyEdge.hexes[0];
  const hex = adjacentHex === undefined ? null : geometry.hexes[adjacentHex];
  if (hex) {
    const center = geometryToWorld(geometry, hex.cx, hex.cy);
    if ((midpoint.x - center.x) * normalX + (midpoint.z - center.z) * normalZ < 0) {
      normalX *= -1;
      normalZ *= -1;
    }
  }
  return {
    midpoint,
    normal: { x: normalX, z: normalZ },
    tangent: { x: normalZ, z: -normalX },
    rotationY: Math.atan2(normalX, normalZ),
  };
}

/** World position of the hoverable plaque. */
export function harborLabelPoint(placement: HarborPlacement): WorldPoint {
  return {
    x: placement.midpoint.x + placement.normal.x * HARBOR_STRUCTURE.labelOffset,
    y: HARBOR_STRUCTURE.labelHeight,
    z: placement.midpoint.z + placement.normal.z * HARBOR_STRUCTURE.labelOffset,
  };
}

/**
 * A flat footprint over the whole pier and its seaward boat at plaque height.
 * Projecting it gives the 3D view one hit region that matches the visible
 * harbour instead of a small square around the plaque. The boat sits on the
 * local +X side of the pier, so only the seaward half widens to cover it.
 */
export function harborHitOutline(geometry: BoardGeometry, edgeIndex: number): WorldPoint[] | null {
  const placement = harborPlacement(geometry, edgeIndex);
  if (!placement) return null;
  const { midpoint, normal, tangent } = placement;
  const point = (outward: number, side: number): WorldPoint => ({
    x: midpoint.x + normal.x * outward + tangent.x * side,
    y: HARBOR_STRUCTURE.hitHeight,
    z: midpoint.z + normal.z * outward + tangent.z * side,
  });
  return [
    point(HARBOR_STRUCTURE.hitStart, -HARBOR_STRUCTURE.hitDockHalfWidth),
    point(HARBOR_STRUCTURE.hitEnd, -HARBOR_STRUCTURE.hitDockHalfWidth),
    point(HARBOR_STRUCTURE.hitEnd, HARBOR_STRUCTURE.hitBoatHalfWidth),
    point(HARBOR_STRUCTURE.hitBoatStart, HARBOR_STRUCTURE.hitBoatHalfWidth),
    point(HARBOR_STRUCTURE.hitStart, HARBOR_STRUCTURE.hitDockHalfWidth),
  ];
}
