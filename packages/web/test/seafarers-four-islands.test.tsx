/** The Four Islands（S2）的前端：兩張沒有主島的圖在 SVG 與幾何層正確呈現，說明面板有特殊規則。 */

import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { actionHints, createGame, getTopology, projectGame, seededRng, type GameView } from '@katan/rules';
import { vi } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { coastLoops } from '../src/board/coastline.ts';
import { seafarersView } from '../src/board/seafarers.ts';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { makeEvent } from '../src/test/fixtures.ts';
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

  it('the coastline (as SVG and 3D call it, with the land mask) is one loop per island', () => {
    const view = fourIslandsView(count);
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const loops = coastLoops(geometry.topology, geometry.land);
    expect(loops).toHaveLength(4);
    // 每環至少繞一座島的外緣（最小的島 4 格 = 14 條海岸邊），總邊數不超過全部陸地的外緣。
    for (const loop of loops) expect(loop.points.length).toBeGreaterThanOrEqual(10);
    expect(loops.reduce((sum, loop) => sum + loop.points.length, 0)).toBeLessThanOrEqual(landHexes * 6);
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
    expect(english.textContent).not.toMatch(/gold/i);
  });

  it('keeps the New Shores help (main island, 14 points) for New Shores', () => {
    const shores = helpFor('sf-new-shores-2025', 'en');
    expect(shores.textContent).toContain('Start on the main island');
    expect(shores.textContent).toMatch(/gold/i);
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

describe('Four Islands wording (no "small island")', () => {
  const names = (id: string) => id.toUpperCase();
  const bonus = makeEvent(5, 'island.bonus', { playerId: 'p1', island: 3, vertex: 2, points: 2 });

  it('island bonus events say a new island in four islands and keep the small island text elsewhere', () => {
    expect(translateEvent('en', bonus, names, { scenario: 'four-islands' }).text).toBe('P1 settled a new island: +2 victory points.');
    expect(translateEvent('zh-Hant', bonus, names, { scenario: 'four-islands' }).text).toBe('P1 登上一座新島嶼：額外 +2 勝利分。');
    expect(translateEvent('en', bonus, names, { scenario: 'new-shores' }).text).toContain('small island');
    expect(translateEvent('zh-Hant', bonus, names).text).toContain('小島');
  });

  function panelFor(profileId: string, locale: 'en' | 'zh-Hant') {
    cleanup();
    const state = createGame({
      profileId,
      players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })),
      setupMode: 'fixed',
      rng: seededRng(4),
    });
    state.moduleState = { seafarers: { window: state.windowId, built: [], moved: false, islands: { p1: [3, 5], p2: [], p3: [] }, claims: [] } };
    state.players[0]!.bonusPoints = 4;
    const view = projectGame(state, 'p2', { hints: actionHints(state, 'p2') });
    const controller = { state: { ...initialTableState(locale, 'Alex'), game: makeSnapshot(view) }, dispatch: vi.fn(), actions: {} } as unknown as TableController;
    render(<LocaleProvider locale={locale}><PlayersPanel controller={controller} /></LocaleProvider>);
    const mark = screen.getByTestId('players-islands-0');
    // 島號也要以可見文字呈現（觸控裝置沒有 title／aria-label）。
    const visible = mark.textContent!;
    if (profileId === 'sf-four-islands-2025') expect(visible).toContain(locale === 'en' ? 'islands 3, 5' : '島 3, 5');
    else expect(visible).not.toMatch(/island|島/i); // New Shores 維持原本的可見輸出（只有 title／aria-label）
    return mark.getAttribute('aria-label')!;
  }

  it('the player panel lists the counted islands, in both locales, with no "small" in four islands', () => {
    expect(panelFor('sf-four-islands-2025', 'en')).toBe('Island bonus · 2 new island(s), +4 (islands 3, 5): 4');
    expect(panelFor('sf-four-islands-2025', 'zh-Hant')).toBe('島嶼獎勵 · 2 座新島嶼，+4 (島 3, 5): 4');
  });

  it('uses the singular for one island', () => {
    cleanup();
    const state = createGame({ profileId: 'sf-four-islands-2025', players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })), setupMode: 'fixed', rng: seededRng(4) });
    state.moduleState = { seafarers: { window: state.windowId, built: [], moved: false, islands: { p1: [3], p2: [], p3: [] }, claims: [] } };
    state.players[0]!.bonusPoints = 2;
    const view = projectGame(state, 'p2', { hints: actionHints(state, 'p2') });
    const controller = { state: { ...initialTableState('en', 'Alex'), game: makeSnapshot(view) }, dispatch: vi.fn(), actions: {} } as unknown as TableController;
    render(<LocaleProvider locale="en"><PlayersPanel controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('players-islands-0').textContent).toContain('island 3');
    expect(screen.getByTestId('players-islands-0').textContent).not.toContain('islands');
  });

  it('New Shores keeps its wording and also lists the islands', () => {
    expect(panelFor('sf-new-shores-2025', 'en')).toBe('Island bonus · 2 small island(s), +4 (islands 3, 5): 4');
  });
});
