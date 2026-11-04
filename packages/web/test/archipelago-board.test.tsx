/** Generic boards: a sea frame with several islands renders from its topology alone. */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getTopology } from '@catan/rules';
import { coastLoops, insideLoop } from '../src/board/coastline.ts';
import { buildGeometry, isCoastEdge, landHexOfEdge } from '../src/board/geometry.ts';
import { harborPlacement } from '../src/board/harbor.ts';
import { createIslandPreviewBoard } from '../src/board/island-preview.ts';
import { fitOrthographicCamera } from '../src/board/camera-fit.ts';
import { sceneBounds } from '../src/board/three/bounds.ts';
import { numberTokens, tileInstances } from '../src/board/three/model-specs.ts';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { makeView } from '../src/test/fixtures.ts';

const board = createIslandPreviewBoard('sample-archipelago');
const geometry = buildGeometry('sample-archipelago', 100, board.terrain);
const landCount = board.terrain.filter((terrain) => terrain !== 'sea').length;

describe('archipelago board', () => {
  it('derives land from terrain and keeps base boards all land', () => {
    expect(geometry.hexes).toHaveLength(61);
    expect(geometry.land.filter(Boolean)).toHaveLength(landCount);
    for (const id of ['hex-r2', 'hex-r56']) {
      const base = buildGeometry(id);
      expect(base.land.every(Boolean)).toBe(true);
      // The shoreline of a land-only board is its topology boundary.
      const boundary = getTopology(id).edges.map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => edge.hexes.length === 1).map(({ index }) => index);
      expect(base.edges.filter((edge) => isCoastEdge(base, edge.index)).map((edge) => edge.index)).toEqual(boundary);
      expect(coastLoops(base.topology, base.land)).toEqual(coastLoops(base.topology));
    }
  });

  it('walks one shoreline loop per island around land only', () => {
    const loops = coastLoops(geometry.topology, geometry.land);
    expect(loops).toHaveLength(4);
    const topology = geometry.topology;
    topology.hexes.forEach((hex, index) => {
      const inside = loops.filter((loop) => insideLoop(loop.points, hex.x, hex.y)).length;
      expect(inside, `hex ${index}`).toBe(geometry.land[index] ? 1 : 0);
    });
  });

  it('points every harbour away from its land hex toward the sea', () => {
    for (const harbor of board.harbors) {
      expect(isCoastEdge(geometry, harbor.edge)).toBe(true);
      const land = landHexOfEdge(geometry, harbor.edge)!;
      expect(geometry.land[land]).toBe(true);
      const placement = harborPlacement(geometry, harbor.edge)!;
      const hex = geometry.hexes[land]!;
      const outward = (placement.midpoint.x - hex.cx / 100) * placement.normal.x + (placement.midpoint.z - hex.cy / 100) * placement.normal.z;
      expect(outward).toBeGreaterThan(0);
    }
  });

  it('raises tiles only for land and fits the whole sea frame in the camera', () => {
    const tiles = tileInstances(geometry, board);
    expect(tiles).toHaveLength(landCount);
    expect(tiles.every((tile) => tile.terrain !== 'sea')).toBe(true);
    expect(tiles.filter((tile) => tile.terrain === 'gold')).toHaveLength(2);
    expect(numberTokens(geometry, board)).toHaveLength(board.numbers.filter((value) => value !== null).length);
    const bounds = sceneBounds(geometry, board);
    for (const hex of geometry.hexes) {
      expect(hex.cx / 100).toBeGreaterThanOrEqual(bounds.min.x);
      expect(hex.cx / 100).toBeLessThanOrEqual(bounds.max.x);
      expect(hex.cy / 100).toBeGreaterThanOrEqual(bounds.min.z);
      expect(hex.cy / 100).toBeLessThanOrEqual(bounds.max.z);
    }
    const fit = fitOrthographicCamera(bounds, { left: 0, top: 0, width: 1200, height: 800 });
    expect([fit.frustum.left, fit.frustum.right, fit.frustum.top, fit.frustum.bottom].every(Number.isFinite)).toBe(true);
  });

  it('draws sea hexes as addressable water cells in the SVG board', () => {
    const [vx, vy, vw, vh] = geometry.viewBox.split(' ').map(Number) as [number, number, number, number];
    const { container } = render(<LocaleProvider locale="en">
      <SvgBoard svgRef={null} geometry={geometry} view={makeView({ board })} arrivals={[]}
        selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
        viewBoxCenter={{ x: vx + vw / 2, y: vy + vh / 2 }} nameResolver={(id) => id} />
    </LocaleProvider>);
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(61);
    expect(container.querySelectorAll('.board__tile-sea')).toHaveLength(61 - landCount);
    expect(container.querySelectorAll('.board__tile-top')).toHaveLength(landCount);
    expect(container.querySelectorAll('.board__shore > g')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(board.harbors.length);
  });

  it('places preview pieces on land only', () => {
    expect(board.buildings.filter(Boolean)).toHaveLength(8);
    board.buildings.forEach((piece, vertex) => {
      if (!piece) return;
      const hexes = geometry.topology.vertices[vertex]!.hexes;
      expect(hexes.filter((hex) => geometry.land[hex]).length).toBeGreaterThanOrEqual(2);
    });
    expect(new Set(board.buildings.flatMap((piece, vertex) => piece
      ? geometry.topology.vertices[vertex]!.hexes.map((hex) => board.islands[hex]).filter(Boolean) : [])).size).toBeGreaterThan(1);
  });
});
