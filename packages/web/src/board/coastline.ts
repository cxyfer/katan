/**
 * Island outline shared by the SVG and 3D boards.
 *
 * The coast is derived from the rules topology alone: every edge that touches a
 * single land hex is on the shoreline. Edges are chained into closed loops, and
 * each loop can be offset outward (sand, surf, shallow water) and rounded with
 * Chaikin smoothing. Everything is pure and expressed in topology units, where
 * one hex radius is 1.
 */

import type { BoardTopology } from '@catan/rules';
import type { Point } from './geometry.ts';

export interface CoastLoop {
  /** Shoreline corners in walking order, counter-clockwise in topology space. */
  points: Point[];
  /** Per-corner miter vectors: `point + miter * d` lies `d` outside both edges. */
  miters: Point[];
}

function normalize(x: number, y: number): Point {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/**
 * Walk every shoreline edge into closed loops; an archipelago yields several.
 * A shoreline edge has exactly one land hex. Without a land mask every hex is
 * land, so the shoreline is the topology's own boundary (the base islands).
 */
export function coastLoops(topology: BoardTopology, land?: readonly boolean[]): CoastLoop[] {
  const isLand = (hex: number) => land?.[hex] ?? true;
  const boundary = topology.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.hexes.filter(isLand).length === 1);
  const byVertex = new Map<number, number[]>();
  for (const { edge, index } of boundary) {
    for (const vertex of edge.vertices) {
      const list = byVertex.get(vertex) ?? [];
      list.push(index);
      byVertex.set(vertex, list);
    }
  }
  const visited = new Set<number>();
  const loops: CoastLoop[] = [];
  for (const { index: first } of boundary) {
    if (visited.has(first)) continue;
    const order: number[] = [];
    let edgeIndex = first;
    let vertex = topology.edges[first]!.vertices[0];
    while (!visited.has(edgeIndex)) {
      visited.add(edgeIndex);
      order.push(vertex);
      const [a, b] = topology.edges[edgeIndex]!.vertices;
      vertex = vertex === a ? b : a;
      const next = (byVertex.get(vertex) ?? []).find((candidate) => !visited.has(candidate));
      if (next === undefined) break;
      edgeIndex = next;
    }
    if (order.length < 3) continue;
    let points = order.map((id) => ({ x: topology.vertices[id]!.x, y: topology.vertices[id]!.y }));
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const q = points[(i + 1) % points.length]!;
      area += p.x * q.y - q.x * p.y;
    }
    if (area < 0) points = points.reverse();
    loops.push({ points, miters: loopMiters(points) });
  }
  return loops;
}

/** Outward miters for a counter-clockwise loop. */
function loopMiters(points: readonly Point[]): Point[] {
  const count = points.length;
  const normals = points.map((point, index) => {
    const next = points[(index + 1) % count]!;
    // A counter-clockwise loop has its outside on the right of each edge.
    return normalize(next.y - point.y, -(next.x - point.x));
  });
  return points.map((_, index) => {
    const before = normals[(index - 1 + count) % count]!;
    const after = normals[index]!;
    const bisector = normalize(before.x + after.x, before.y + after.y);
    const cosine = Math.max(0.35, bisector.x * after.x + bisector.y * after.y);
    return { x: bisector.x / cosine, y: bisector.y / cosine };
  });
}

/** Offset every corner by `distance` (negative moves inland). */
export function offsetLoop(loop: CoastLoop, distance: number): Point[] {
  return loop.points.map((point, index) => ({
    x: point.x + loop.miters[index]!.x * distance,
    y: point.y + loop.miters[index]!.y * distance,
  }));
}

/** Chaikin corner cutting; each pass doubles the point count. */
export function smoothLoop(points: readonly Point[], passes = 2): Point[] {
  let current = points.slice();
  for (let pass = 0; pass < passes; pass++) {
    const next: Point[] = [];
    for (let index = 0; index < current.length; index++) {
      const a = current[index]!;
      const b = current[(index + 1) % current.length]!;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    current = next;
  }
  return current;
}

/** Closed SVG path through the given points, scaled into SVG user units. */
export function loopPath(points: readonly Point[], scale = 1): string {
  if (!points.length) return '';
  return points.map((point, index) => `${index ? 'L' : 'M'}${(point.x * scale).toFixed(1)} ${(point.y * scale).toFixed(1)}`).join('') + 'Z';
}

/** Even-odd containment test. */
export function insideLoop(points: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Unsigned distance from a point to a closed polyline. */
export function distanceToLoop(points: readonly Point[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}
