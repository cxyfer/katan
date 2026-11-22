/** The Four Islands（S2）的前端：兩張沒有主島的圖在 SVG 與幾何層正確呈現，說明面板有特殊規則。 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { actionHints, createGame, getTopology, projectGame, seededRng, type GameView } from '@katan/rules';
import { buildGeometry } from '../src/board/geometry.ts';
import { coastLoops } from '../src/board/coastline.ts';
import { seafarersView } from '../src/board/seafarers.ts';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION, initialTableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeSnapshot } from '../src/test/fixtures.ts';

const COLORS = ['red', 'blue', 'orange', 'white'] as const;

function fourIslandsView(count: 3 | 4, edit: (state: ReturnType<typeof createGame>) => void = () => undefined): GameView {
  const state = createGame({
    profileId: 'sf-four-islands-2025',
    players: ['p1', 'p2', 'p3', 'p4'].slice(0, count).map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(4),
  });
  edit(state);
  return projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
}

describe.each([[3, 'sf-four-islands-3', 20], [4, 'sf-four-islands-4', 23]] as const)('Four Islands %i players', (count, topologyId, landHexes) => {
  it('geometry and the SVG board draw the whole map: four islands, nine harbors, pirate on the frame', () => {
    const view = fourIslandsView(count);
    expect(view.board.topologyId).toBe(topologyId);
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    expect(geometry.land.filter(Boolean)).toHaveLength(landHexes);
    // 沒有主島：島編號只有 2–5（layout 不外送，這裡以投影的海陸分佈與 topology 檢查格數）。
    expect(getTopology(topologyId).hexes).toHaveLength(35);
    const { container } = render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
      arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(view.board.terrain.length);
    expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(9);
    // 海盜在框上：畫在框邊的標記，不在任何海格上。
    expect(view.board.pirate).toBeNull();
    expect(container.querySelector('[data-testid="pirate-frame"]')).not.toBeNull();
  });

  it('the shoreline is one loop around the 35-hex frame (3D coast input)', () => {
    const topology = getTopology(topologyId);
    const loops = coastLoops(topology);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.points).toHaveLength(42);
  });
});

describe('Four Islands view and help', () => {
  it('exposes home islands through the typed seafarers view once setup recorded them', () => {
    const none = fourIslandsView(4);
    expect(seafarersView(none)!.home).toBeNull();
    const done = fourIslandsView(4, (state) => {
      state.moduleState = { seafarers: { window: state.windowId, built: [], moved: false, islands: {}, claims: [], home: { p1: [2, 5], p2: [3] } } };
    });
    expect(seafarersView(done)!.home).toEqual({ p1: [2, 5], p2: [3] });
  });

  function helpFor(profileId: string, locale: 'en' | 'zh-Hant') {
    const state = createGame({
      profileId,
      players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })),
      setupMode: 'fixed',
      rng: seededRng(4),
    });
    const view = projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
    const controller = { state: { ...initialTableState(locale, 'Alex'), game: makeSnapshot(view) } } as unknown as TableController;
    render(<LocaleProvider locale={locale}><HelpPanel controller={controller} /></LocaleProvider>);
    return screen.getByTestId('help-seafarers');
  }

  it('shows the Four Islands special rules in both locales, with the 13-point target', () => {
    const english = helpFor('sf-four-islands-2025', 'en');
    expect(english.textContent).toContain('The Four Islands');
    expect(english.textContent).toContain('home islands');
    expect(english.textContent).toContain('13 points');
    expect(english.textContent).not.toContain('Start on the main island');
    expect(english.textContent).not.toContain('small island');
  });

  it('keeps the New Shores help (main island, 14 points) for New Shores', () => {
    const shores = helpFor('sf-new-shores-2025', 'en');
    expect(shores.textContent).toContain('Start on the main island');
    expect(shores.querySelector('[data-testid="help-four-islands-setup"]')).toBeNull();
  });

  it('shows the Traditional Chinese Four Islands rules', () => {
    const chinese = helpFor('sf-four-islands-2025', 'zh-Hant');
    expect(chinese.textContent).toContain('四島群島特殊規則');
    expect(chinese.textContent).toContain('出發島');
    expect(chinese.textContent).toContain('13 分');
    expect(chinese.textContent).not.toContain('從主島開始');
  });
});
