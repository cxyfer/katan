/**
 * River course for the Rivers of Catan tiles, in topology units (hex radius
 * 1). The water enters each hex at one bridge site and leaves at the next,
 * bowing sideways so it never covers the hex's number token; it springs
 * inside the first hex and ends at the mouth on the coast.
 */

import type { BoardTopology } from '@catan/rules';

export interface Point2 { x: number; y: number }
export interface CubicSegment { from: Point2; c1: Point2; c2: Point2; to: Point2 }

const BOW = 0.62;

export function riverCourse(topology: BoardTopology, path: { hexes: number[]; sites: number[] }): CubicSegment[] {
  const mid = (edge: number): Point2 => ({ x: topology.edges[edge]!.x, y: topology.edges[edge]!.y });
  const segments: CubicSegment[] = [];
  let from: Point2 | null = null;
  path.sites.forEach((site, index) => {
    const hex = topology.hexes[path.hexes[index]!]!;
    const centre = { x: hex.x, y: hex.y };
    const to = mid(site);
    const dx = to.x - centre.x;
    const dy = to.y - centre.y;
    const length = Math.hypot(dx, dy) || 1;
    // Sideways from the hex centre, on the side away from the number token
    // (drawn below the centre), so the water never covers the numbers.
    let n = { x: -dy / length, y: dx / length };
    if (n.y > 1e-6 || (Math.abs(n.y) <= 1e-6 && n.x < 0)) n = { x: -n.x, y: -n.y };
    // The spring sits beside the token, upstream of the first crossing.
    const start = from ?? { x: centre.x + n.x * 0.5 - (dx / length) * 0.35, y: centre.y + n.y * 0.5 - (dy / length) * 0.35 };
    const c1 = { x: (start.x + centre.x) / 2 + n.x * BOW, y: (start.y + centre.y) / 2 + n.y * BOW };
    const c2 = { x: (to.x + centre.x) / 2 + n.x * BOW, y: (to.y + centre.y) / 2 + n.y * BOW };
    segments.push({ from: start, c1, c2, to });
    from = to;
  });
  return segments;
}

/** Points along a cubic segment (inclusive of both ends). */
export function cubicPoints(segment: CubicSegment, steps: number): Point2[] {
  const out: Point2[] = [];
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const u = 1 - t;
    out.push({
      x: u ** 3 * segment.from.x + 3 * u * u * t * segment.c1.x + 3 * u * t * t * segment.c2.x + t ** 3 * segment.to.x,
      y: u ** 3 * segment.from.y + 3 * u * u * t * segment.c1.y + 3 * u * t * t * segment.c2.y + t ** 3 * segment.to.y,
    });
  }
  return out;
}
