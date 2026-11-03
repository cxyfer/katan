import { landHexOfEdge, type BoardGeometry } from './geometry.ts';
import type { WorldPoint } from './render-contract.ts';
import { geometryPointToWorld } from './projection.ts';

/**
 * One shared description of the diorama harbour and its hover footprint.
 * The 3D model, the label instance and the inspection layer all read these
 * values so a port cannot drift away from the area that can be hovered.
 */
export const HARBOR_STRUCTURE = Object.freeze({
  /** Conservative camera-fit envelope beyond the pier and boat. */
  fitOffset: 0.85,
  fitHalfDiagonal: 0.43,
  /** Harbour plaque: outward distance and height. */
  labelOffset: 0.285,
  labelHeight: 0.205,
  /** Visible boat/sail point used to verify the footprint in a browser. */
  probeSide: 0.32,
  probeOutward: 0.63,
  probeHeight: -0.27,
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
 * land hex (its other side is sea or off the board); outward is away from
 * that hex's centre.
 */
export function harborPlacement(geometry: BoardGeometry, edgeIndex: number): HarborPlacement | null {
  const edge = geometry.edges[edgeIndex];
  const topologyEdge = geometry.topology.edges[edgeIndex];
  if (!edge || !topologyEdge) return null;
  const a = geometryPointToWorld(geometry, { x: edge.x1, y: edge.y1 });
  const b = geometryPointToWorld(geometry, { x: edge.x2, y: edge.y2 });
  const midpoint = geometryPointToWorld(geometry,
    { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 });
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  let normalX = dz / length;
  let normalZ = -dx / length;
  // Outward points away from the land hex, toward the sea (or off the board).
  const adjacentHex = landHexOfEdge(geometry, edgeIndex);
  const hex = adjacentHex === undefined ? null : geometry.hexes[adjacentHex];
  if (hex) {
    const center = geometryPointToWorld(geometry, { x: hex.cx, y: hex.cy });
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
 * Visible pier and boat corners at their actual model heights. Projecting the
 * complete set and taking its screen hull covers the structure under any
 * camera elevation without leaving the boat below a flat plaque-height plane.
 * Local side/outward coordinates follow the diorama instance.
 */
const HARBOR_HIT_POINTS: readonly (readonly [side: number, outward: number, height: number])[] = [
  // Dressed-stone abutment at the shore, from its footing to its caps.
  [-0.25, 0.0, -0.21], [0.25, 0.0, -0.21],
  [-0.25, 0.091, -0.21], [0.25, 0.091, -0.21],
  [-0.25, 0.0, -0.002], [0.25, 0.0, -0.002],
  [-0.25, 0.091, -0.002], [0.25, 0.091, -0.002],
  // Low shore walkway deck corners.
  [-0.216, 0.0015, 0.0875], [0.216, 0.0015, 0.0875],
  [-0.216, 0.5985, 0.0875], [0.216, 0.5985, 0.0875],
  // Raised, framed sign deck corners, at both its underside and frame top.
  [-0.362, 0.068, 0.19], [0.362, 0.068, 0.19],
  [-0.362, 0.502, 0.19], [0.362, 0.502, 0.19],
  [-0.362, 0.068, 0.209], [0.362, 0.068, 0.209],
  [-0.362, 0.502, 0.209], [0.362, 0.502, 0.209],
  // Pier frame at the shore and at the seaward end, from the bracing feet to the deck.
  [-0.23, 0.0, 0.0], [0.23, 0.0, 0.0],
  [-0.223, 0.027, 0.144], [0.223, 0.027, 0.144],
  [-0.23, 0.605, -0.21], [0.23, 0.605, -0.21],
  [-0.23, 0.605, 0.19], [0.23, 0.605, 0.19],
  // Lantern on the seaward piling.
  [-0.216, 0.534, 0.323], [-0.174, 0.534, 0.323],
  [-0.216, 0.576, 0.323], [-0.174, 0.576, 0.323],
  // Harbour plaque corners.
  [-0.34, 0.09, 0.205], [0.34, 0.09, 0.205],
  [-0.34, 0.48, 0.205], [0.34, 0.48, 0.205],
  // Boat hull and gunwale corners at their visible rim heights and at the ocean clip.
  [0.228, 0.455, -0.245], [0.412, 0.455, -0.245],
  [0.228, 0.825, -0.245], [0.412, 0.825, -0.245],
  [0.228, 0.455, -0.285], [0.412, 0.455, -0.285],
  [0.228, 0.825, -0.285], [0.412, 0.825, -0.285],
  // Mast head, pennant, sail foot and forestay.
  [0.32, 0.51, 0.188], [0.32, 0.74, 0.188],
  [0.308, 0.618, 0.223], [0.332, 0.618, 0.223],
  [0.308, 0.642, 0.223], [0.332, 0.642, 0.223],
  [0.32, 0.63, 0.223], [0.32, 0.692, 0.219], [0.32, 0.805, 0.06],
];

/** World corners whose screen hull covers the rendered pier and boat. */
export function harborHitPoints(geometry: BoardGeometry, edgeIndex: number): WorldPoint[] | null {
  const placement = harborPlacement(geometry, edgeIndex);
  if (!placement) return null;
  const { midpoint, normal, tangent } = placement;
  return HARBOR_HIT_POINTS.map(([side, outward, height]) => ({
    x: midpoint.x + normal.x * outward + tangent.x * side,
    y: height,
    z: midpoint.z + normal.z * outward + tangent.z * side,
  }));
}

/** A visible point on the boat hull, independent of the hit hull. */
export function harborProbePoint(geometry: BoardGeometry, edgeIndex: number): WorldPoint | null {
  const placement = harborPlacement(geometry, edgeIndex);
  if (!placement) return null;
  const { midpoint, normal, tangent } = placement;
  return {
    x: midpoint.x + normal.x * HARBOR_STRUCTURE.probeOutward + tangent.x * HARBOR_STRUCTURE.probeSide,
    y: HARBOR_STRUCTURE.probeHeight,
    z: midpoint.z + normal.z * HARBOR_STRUCTURE.probeOutward + tangent.z * HARBOR_STRUCTURE.probeSide,
  };
}

/** Andrew monotone-chain hull for the projected hit corners. */
export function screenConvexHull(points: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const unique = [...new Map(finite.map((point) => [`${point.x.toFixed(3)},${point.y.toFixed(3)}`, point])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;
  const cross = (origin: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower: { x: number; y: number }[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: { x: number; y: number }[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
