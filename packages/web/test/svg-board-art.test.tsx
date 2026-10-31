import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { buildGeometry } from '../src/board/geometry.ts';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { fixedBoard, makeView } from '../src/test/fixtures.ts';

const geometry = buildGeometry('hex-r2');
const [vx, vy, vw, vh] = geometry.viewBox.split(' ').map(Number) as [number, number, number, number];

function board() {
  return <SvgBoard svgRef={null} geometry={geometry} view={makeView({ board: fixedBoard() })} active={null}
    selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
    viewBoxCenter={{ x: vx + vw / 2, y: vy + vh / 2 }} nameResolver={(id) => id} />;
}

function translation(element: Element): { x: number; y: number } {
  const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(element.getAttribute('transform') ?? '');
  if (!match) throw new Error('missing translate');
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe('SVG board art', () => {
  it('keeps ids unique across two boards and resolves every paint reference inside its own board', () => {
    const { container } = render(<LocaleProvider locale="en">{board()}{board()}</LocaleProvider>);
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const svg of container.querySelectorAll('svg[data-testid="board-svg"]')) {
      const references = [...svg.querySelectorAll('[fill^="url("], [stroke^="url("]')]
        .flatMap((node) => [node.getAttribute('fill'), node.getAttribute('stroke')])
        .filter((value): value is string => !!value?.startsWith('url('));
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        const id = reference.slice(5, -1);
        expect(svg.querySelector(`[id="${id}"]`), reference).not.toBeNull();
      }
    }
  });

  it('draws one emblem per tile and places every harbour badge at sea but inside the fitted view box', () => {
    const { container } = render(<LocaleProvider locale="en">{board()}</LocaleProvider>);
    expect(container.querySelectorAll('.board__terrain-art')).toHaveLength(geometry.hexes.length);
    const harbors = fixedBoard().harbors;
    expect(harbors.length).toBeGreaterThan(0);
    for (const harbor of harbors) {
      const group = container.querySelector(`[data-testid="harbor-${harbor.edge}"]`)!;
      const badge = [...group.querySelectorAll('g[transform]')].find((node) => node.querySelector('circle[r="21"]'))!;
      const { x, y } = translation(badge);
      const land = geometry.hexes[geometry.topology.edges[harbor.edge]!.hexes[0]!]!;
      // 徽章中心在陸地六角形之外（大於頂點半徑），整顆徽章仍在 viewBox 之內。
      expect(Math.hypot(x - land.cx, y - land.cy)).toBeGreaterThan(geometry.scale);
      expect(x - 22).toBeGreaterThanOrEqual(vx);
      expect(x + 22).toBeLessThanOrEqual(vx + vw);
      expect(y - 22).toBeGreaterThanOrEqual(vy);
      expect(y + 22).toBeLessThanOrEqual(vy + vh);
    }
  });
});
