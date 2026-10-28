import { describe, expect, it } from 'vitest';
import { boardViewport, parseViewBox } from '../src/board/viewport.ts';
import { buildGeometry, distance } from '../src/board/geometry.ts';
import { ambiguousWith } from '../src/board/targets.ts';

describe('SVG world / CSS projection (I01, I03, I05)', () => {
  it('round-trips both topologies at fit / zoom / pan, across aspect ratios and DPRs within one CSS px', () => {
    for (const topology of ['hex-r2', 'hex-r56']) {
      const geometry = buildGeometry(topology);
      for (const [width, height] of [[1366, 768], [800, 450], [844, 390], [768, 1024], [390, 844], [360, 640]]) {
        for (const zoom of [.7, 1, 3]) for (const dpr of [1, 2, 3]) {
          const viewport = boardViewport({ viewBox: parseViewBox(geometry.viewBox), rect: { left: 71, top: 38, width: width!, height: height! }, zoom, pan: { x: 63, y: -42 } })!;
          for (const point of geometry.vertices) {
            const screen = viewport.worldToScreen(point);
            const roundTrip = viewport.worldToScreen(viewport.screenToWorld(screen));
            expect(distance(screen, roundTrip)).toBeLessThanOrEqual(1);
            // DPR changes backing pixels, never input CSS pixels or topology IDs.
            expect(viewport.screenToWorld({ x: screen.x * dpr / dpr, y: screen.y * dpr / dpr }).x).toBeCloseTo(point.x, 8);
          }
        }
      }
    }
  });

  it('accounts for meet letterboxing, viewBox origins, pan and zoom', () => {
    const rect = { left: 10, top: 20, width: 600, height: 200 };
    const viewBox = { x: -100, y: -50, width: 200, height: 100 };
    const fit = boardViewport({ viewBox, rect })!;
    expect(fit.worldToScreen({ x: -100, y: -50 })).toEqual({ x: 110, y: 20 });
    expect(fit.worldToScreen({ x: 100, y: 50 })).toEqual({ x: 510, y: 220 });
    const moved = boardViewport({ viewBox, rect, zoom: 3, pan: { x: 10, y: -5 } })!;
    expect(moved.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 330, y: 110 });
    expect(moved.screenDeltaToPan({ x: 20, y: 10 })).toEqual({ x: 10, y: 5 });
    expect(boardViewport({ viewBox, rect: { ...rect, width: 0 } })).toBeNull();
  });

  it('supports nonuniform scaling, aligned meet and slice matrices', () => {
    const args = { viewBox: parseViewBox('0,0,100,100'), rect: { left: 0, top: 0, width: 300, height: 100 } };
    expect(boardViewport({ ...args, preserveAspectRatio: 'none' })!.worldToScreen({ x: 100, y: 100 })).toEqual({ x: 300, y: 100 });
    expect(boardViewport({ ...args, preserveAspectRatio: 'xMaxYMax meet' })!.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 200, y: 0 });
    expect(boardViewport({ ...args, preserveAspectRatio: 'xMidYMid slice' })!.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 0, y: -100 });
  });

  it('uses exactly 30 CSS px after letterboxing and zoom, independent of world units', () => {
    const args = { viewBox: parseViewBox('0 0 1000 1000'), rect: { left: 40, top: 20, width: 100, height: 400 } };
    const points = new Map([[3, { x: 0, y: 0 }], [9, { x: 100, y: 0 }]]);
    for (const [zoom, expected] of [[.7, [3, 9]], [1, [3, 9]], [3, null]] as const) {
      const projection = boardViewport({ ...args, zoom })!;
      const cssPoints = new Map([...points].map(([index, point]) => [index, projection.worldToScreen(point)]));
      expect(ambiguousWith(3, [3, 9], cssPoints, 30)).toEqual(expected);
    }
  });

  it('preserves SVG points while exposing the numeric corners of every hex', () => {
    for (const topology of ['hex-r2', 'hex-r56']) for (const hex of buildGeometry(topology).hexes) {
      expect(hex.corners).toHaveLength(6);
      expect(hex.points).toBe(hex.corners.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '));
    }
  });
});
