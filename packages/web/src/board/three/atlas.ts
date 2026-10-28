import { PlaneGeometry } from 'three';

export const BOARD_ATLAS_URL = new URL('../../assets/board3d/board-atlas.svg', import.meta.url).href;

export interface AtlasCell {
  readonly column: number;
  readonly row: number;
}

export const ATLAS_SIZE = 4;

export const NUMBER_ATLAS_CELLS: Readonly<Record<number, AtlasCell>> = Object.freeze({
  2: { column: 0, row: 0 },
  3: { column: 1, row: 0 },
  4: { column: 2, row: 0 },
  5: { column: 3, row: 0 },
  6: { column: 0, row: 1 },
  8: { column: 1, row: 1 },
  9: { column: 2, row: 1 },
  10: { column: 3, row: 1 },
  11: { column: 0, row: 2 },
  12: { column: 1, row: 2 },
});

export const HARBOR_ATLAS_CELLS: Readonly<Record<string, AtlasCell>> = Object.freeze({
  generic: { column: 2, row: 2 },
  lumber: { column: 3, row: 2 },
  brick: { column: 0, row: 3 },
  wool: { column: 1, row: 3 },
  grain: { column: 2, row: 3 },
  ore: { column: 3, row: 3 },
});

export function normalizedAtlasCell(cell: AtlasCell): { u0: number; u1: number; v0: number; v1: number } {
  if (!Number.isInteger(cell.column) || !Number.isInteger(cell.row) ||
      cell.column < 0 || cell.row < 0 || cell.column >= ATLAS_SIZE || cell.row >= ATLAS_SIZE) {
    throw new RangeError('Atlas cell is outside the declared grid');
  }
  const size = 1 / ATLAS_SIZE;
  const x0 = cell.column * size;
  const y0 = cell.row * size;
  return {
    u0: x0,
    u1: x0 + size,
    v0: 1 - y0 - size,
    v1: 1 - y0,
  };
}

/** One shared-size plane geometry with atlas UVs; instances can reuse it. */
export function createAtlasPlaneGeometry(cell: AtlasCell): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1);
  const uv = geometry.getAttribute('uv');
  const rect = normalizedAtlasCell(cell);
  const uSpan = rect.u1 - rect.u0;
  const vSpan = rect.v1 - rect.v0;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, rect.u0 + uv.getX(index) * uSpan, rect.v0 + uv.getY(index) * vSpan);
  }
  uv.needsUpdate = true;
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function harborAtlasKey(type: string): keyof typeof HARBOR_ATLAS_CELLS {
  return Object.hasOwn(HARBOR_ATLAS_CELLS, type) ? type : 'generic';
}
