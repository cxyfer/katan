/**
 * Sea level of the 3D board, shared by the renderer (the water plane) and the
 * target projection (sea hexes and sea paths are picked at the water surface,
 * not at tile height). Kept free of three.js so the SVG path can import it.
 */

import type { BoardGeometry } from './geometry.ts';

/** The water plane height; the beach dips just below it so the waterline is clean. */
export const SEA_LEVEL = -0.285;

/** World height of a target: land targets sit on the tiles, sea targets on the water. */
export function targetHeight(geometry: Pick<BoardGeometry, 'topology' | 'land'>, kind: 'vertex' | 'edge' | 'hex', index: number): number {
  const hexes = kind === 'hex'
    ? [index]
    : kind === 'edge'
      ? geometry.topology.edges[index]?.hexes ?? []
      : geometry.topology.vertices[index]?.hexes ?? [];
  return hexes.some((hex) => geometry.land[hex] !== false) ? 0 : SEA_LEVEL;
}
