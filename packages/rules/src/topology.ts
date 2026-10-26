/**
 * Board topology for hex-grid CATAN-style boards.
 *
 * The topology is pure geometry: hexes, their shared vertices (intersections)
 * and edges (paths). Terrain, numbers, harbors and island membership belong to
 * a `BoardLayout` (scenario instance data) so that expansions can reuse the
 * same generator with different radii / shapes.
 *
 * Vertex and edge identity is derived deterministically from rounded geometry,
 * so regenerating the topology for the same id always yields the same indices.
 */

export interface HexCoord {
  q: number;
  r: number;
}

/** Axial neighbour directions (pointy-top). */
export const NEIGHBOR_DIRS: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export interface VertexInfo {
  /** Hex indices meeting at this intersection (2 on the coast, 3 inland). */
  hexes: number[];
  /** Edge indices touching this intersection. */
  edges: number[];
  x: number;
  y: number;
}

export interface EdgeInfo {
  /** Hex indices sharing this edge (1 on the coast, 2 inland). */
  hexes: number[];
  vertices: [number, number];
  x: number;
  y: number;
}

export interface BoardTopology {
  id: string;
  radius: number;
  hexes: { q: number; r: number; x: number; y: number }[];
  vertices: VertexInfo[];
  edges: EdgeInfo[];
  /** Coastal (single-hex) edges ordered by angle around the board centre. */
  coastalEdges: number[];
  /** Coastal edges that carry a harbor token, ordered clockwise. */
  harborSlots: number[];
}

const HEX_SIZE = 1;
const ROUND = 1e6;

function key(x: number, y: number): string {
  return `${Math.round(x * ROUND)},${Math.round(y * ROUND)}`;
}

function round(v: number): number {
  return Math.round(v * ROUND) / ROUND;
}

/** Exact (unrounded) hex centre; rounding happens only for exported values. */
export function hexCenter(coord: HexCoord, size = HEX_SIZE): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (coord.q + coord.r / 2),
    y: size * 1.5 * coord.r,
  };
}

const CORNER_ANGLES = [30, 90, 150, 210, 270, 330].map((d) => (d * Math.PI) / 180);

/** Builds the standard hexagonal board of the given radius (2 => 19 hexes). */
export function buildTopology(radius: number, id = `hex-r${radius}`): BoardTopology {
  const coords: HexCoord[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius) coords.push({ q, r });
    }
  }
  coords.sort((a, b) => (a.r - b.r) || (a.q - b.q));

  // Corner positions must be derived from exact centres: rounding the centre
  // first would push shared corners onto different quantisation buckets.
  const exactCentres = coords.map((c) => hexCenter(c));
  const hexes = coords.map((c, index) => ({
    ...c,
    x: round(exactCentres[index]!.x),
    y: round(exactCentres[index]!.y),
  }));

  // Collect corner positions per hex, dedupe globally.
  const vertexByKey = new Map<string, number>();
  const vertexPos: { x: number; y: number }[] = [];
  const hexCorners: number[][] = [];
  for (const centre of exactCentres) {
    const corners: number[] = [];
    for (const angle of CORNER_ANGLES) {
      const x = centre.x + HEX_SIZE * Math.cos(angle);
      const y = centre.y + HEX_SIZE * Math.sin(angle);
      const k = key(x, y);
      let index = vertexByKey.get(k);
      if (index === undefined) {
        index = vertexPos.length;
        vertexByKey.set(k, index);
        vertexPos.push({ x: round(x), y: round(y) });
      }
      corners.push(index);
    }
    hexCorners.push(corners);
  }

  // Edges: consecutive corners of each hex, deduped by sorted vertex pair.
  const edgeByKey = new Map<string, number>();
  const edgeVerts: [number, number][] = [];
  const hexEdges: number[][] = [];
  for (let h = 0; h < hexes.length; h++) {
    const corners = hexCorners[h]!;
    const list: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = corners[k]!;
      const b = corners[(k + 1) % 6]!;
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      let index = edgeByKey.get(ek);
      if (index === undefined) {
        index = edgeVerts.length;
        edgeByKey.set(ek, index);
        edgeVerts.push(a < b ? [a, b] : [b, a]);
      }
      list.push(index);
    }
    hexEdges.push(list);
  }

  const edgeHexes: number[][] = edgeVerts.map(() => []);
  for (let h = 0; h < hexes.length; h++) {
    for (const e of hexEdges[h]!) edgeHexes[e]!.push(h);
  }

  const vertexHexes: number[][] = vertexPos.map(() => []);
  const vertexEdges: number[][] = vertexPos.map(() => []);
  for (let h = 0; h < hexes.length; h++) {
    for (const v of hexCorners[h]!) if (!vertexHexes[v]!.includes(h)) vertexHexes[v]!.push(h);
  }
  for (let e = 0; e < edgeVerts.length; e++) {
    for (const v of edgeVerts[e]!) vertexEdges[v]!.push(e);
  }

  const vertices: VertexInfo[] = vertexPos.map((p, i) => ({
    hexes: vertexHexes[i]!.slice().sort((a, b) => a - b),
    edges: vertexEdges[i]!.slice().sort((a, b) => a - b),
    x: p.x,
    y: p.y,
  }));

  const edges: EdgeInfo[] = edgeVerts.map((v, i) => {
    const a = vertexPos[v[0]]!;
    const b = vertexPos[v[1]]!;
    return {
      hexes: edgeHexes[i]!.slice().sort((x, y) => x - y),
      vertices: v,
      x: round((a.x + b.x) / 2),
      y: round((a.y + b.y) / 2),
    };
  });

  const coastalEdges = edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.hexes.length === 1)
    .sort((p, q) => Math.atan2(p.e.y, p.e.x) - Math.atan2(q.e.y, q.e.x))
    .map(({ i }) => i);

  return {
    id,
    radius,
    hexes,
    vertices,
    edges,
    coastalEdges,
    harborSlots: pickHarborSlots(coastalEdges),
  };
}

/**
 * Selects 9 roughly evenly spaced harbor positions out of the coastal edges.
 * The physical board marks fixed harbor positions on its frame; this maps them
 * onto the nearest coastal edge with the same spacing pattern (see
 * docs/FIDELITY.md — positions still require physical-board verification).
 */
function pickHarborSlots(coastalEdges: number[]): number[] {
  const total = coastalEdges.length;
  const count = 9;
  if (total < count) return coastalEdges.slice();
  const slots: number[] = [];
  const spacing = [3, 4, 3, 3, 4, 3, 3, 4, 3];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    slots.push(coastalEdges[cursor % total]!);
    cursor += spacing[i % spacing.length]!;
  }
  return slots;
}

/** Hex indices adjacent to the given hex (sharing an edge). */
export function hexNeighbors(topo: BoardTopology, hex: number): number[] {
  const out: number[] = [];
  for (const e of topo.hexes[hex] ? edgeIndicesOfHex(topo, hex) : []) {
    for (const h of topo.edges[e]!.hexes) if (h !== hex) out.push(h);
  }
  return out.sort((a, b) => a - b);
}

const hexEdgeCache = new WeakMap<BoardTopology, number[][]>();

function edgeIndicesOfHex(topo: BoardTopology, hex: number): number[] {
  let cache = hexEdgeCache.get(topo);
  if (!cache) {
    cache = topo.hexes.map(() => []);
    topo.edges.forEach((e, i) => {
      for (const h of e.hexes) cache![h]!.push(i);
    });
    hexEdgeCache.set(topo, cache);
  }
  return cache[hex]!;
}

export function edgesOfHex(topo: BoardTopology, hex: number): number[] {
  return edgeIndicesOfHex(topo, hex).slice();
}

export function verticesOfHex(topo: BoardTopology, hex: number): number[] {
  const out = new Set<number>();
  for (const e of edgeIndicesOfHex(topo, hex)) {
    const [a, b] = topo.edges[e]!.vertices;
    out.add(a);
    out.add(b);
  }
  return [...out].sort((a, b) => a - b);
}
