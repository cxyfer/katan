/**
 * Board geometry derived from the rules package's own topology.
 *
 * The client never re-derives vertex/edge identity: it asks `getTopology()` for
 * the exact same indices the engine uses, then only projects those points into
 * SVG space. That is what keeps a click on "path 41" meaning edge 41 on the
 * server.
 */

import { getTopology, type BoardTopology } from '@catan/rules';

export const BASE_TOPOLOGY_ID = 'hex-r2';

/** The topology radius-2 board: 19 hexes, 54 vertices, 72 edges. */
export const BASE_BOARD_COUNTS = { hexes: 19, vertices: 54, edges: 72 } as const;

export interface Point {
  x: number;
  y: number;
}

export interface VertexGeometry extends Point {
  index: number;
  /** Polygon `points` attribute for the six corners of the parent hexes. */
}

export interface EdgeGeometry {
  index: number;
  a: number;
  b: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface HexGeometry {
  index: number;
  cx: number;
  cy: number;
  corners: Point[];
  points: string;
}

export interface BoardGeometry {
  topologyId: string;
  topology: BoardTopology;
  scale: number;
  width: number;
  height: number;
  viewBox: string;
  hexes: HexGeometry[];
  vertices: VertexGeometry[];
  edges: EdgeGeometry[];
}

const CORNER_ANGLES = [30, 90, 150, 210, 270, 330].map((degrees) => (degrees * Math.PI) / 180);
const PADDING = 0.35;

function hexCorners(cx: number, cy: number, scale: number): Point[] {
  return CORNER_ANGLES.map((angle) => ({
    x: (cx + Math.cos(angle)) * scale,
    y: (cy + Math.sin(angle)) * scale,
  }));
}

/**
 * Projects a topology into SVG user units. All output coordinates are already
 * scaled, so a consumer can render directly inside `viewBox`.
 */
export function buildGeometry(topologyId: string, scale = 100): BoardGeometry {
  const topology = getTopology(topologyId);
  const hexes: HexGeometry[] = topology.hexes.map((hex, index) => {
    const corners = hexCorners(hex.x, hex.y, scale);
    return {
      index,
      cx: hex.x * scale,
      cy: hex.y * scale,
      corners,
      points: corners.map((corner) => `${corner.x.toFixed(2)},${corner.y.toFixed(2)}`).join(' '),
    };
  });

  const vertices: VertexGeometry[] = topology.vertices.map((vertex, index) => ({
    index,
    x: vertex.x * scale,
    y: vertex.y * scale,
  }));

  const edges: EdgeGeometry[] = topology.edges.map((edge, index) => {
    const [a, b] = edge.vertices;
    const from = vertices[a]!;
    const to = vertices[b]!;
    return { index, a, b, x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  const pad = PADDING * scale;
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;

  return {
    topologyId: topology.id,
    topology,
    scale,
    width,
    height,
    viewBox: `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`,
    hexes,
    vertices,
    edges,
  };
}

/** Distance between two projected points; used for ambiguity detection. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Adjacent vertices (sharing one edge) — useful for textual board references. */
export function adjacentVertices(topology: BoardTopology, vertex: number): number[] {
  const out = new Set<number>();
  for (const edge of topology.vertices[vertex]?.edges ?? []) {
    for (const other of topology.edges[edge]?.vertices ?? []) {
      if (other !== vertex) out.add(other);
    }
  }
  return [...out].sort((a, b) => a - b);
}
