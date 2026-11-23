/** Through the Desert（S4）的前端：兩張外框不同的圖在 SVG 與幾何層正確呈現，說明面板有特殊規則與金礦說明。 */

import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, getTopology, projectGame, seededRng, type GameView } from '@katan/rules';
import { buildGeometry } from '../src/board/geometry.ts';
import { coastLoops } from '../src/board/coastline.ts';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { islandWording } from '../src/i18n/islandWording.ts';
import { EMPTY_SELECTION, initialTableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

const COLORS = ['red', 'blue', 'orange', 'white'] as const;
const PROFILE = 'sf-through-the-desert-2025';

function desertView(count: 3 | 4): GameView {
  const state = createGame({
    profileId: PROFILE,
    players: ['p1', 'p2', 'p3', 'p4'].slice(0, count).map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(4),
  });
  return projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
}

describe.each([[3, 'sf-through-the-desert-3', 35, 25, 8], [4, 'sf-through-the-desert-4', 42, 30, 9]] as const)(
  'Through the Desert %i players',
  (count, topologyId, hexes, landHexes, harbors) => {
    it('geometry and the SVG board draw the whole map: desert and gold as land, every harbor, pirate on the frame', () => {
      const view = desertView(count);
      expect(view.board.topologyId).toBe(topologyId);
      expect(getTopology(topologyId).hexes).toHaveLength(hexes);
      const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
      expect(geometry.land.filter(Boolean)).toHaveLength(landHexes);
      expect(view.board.terrain.filter((tile) => tile === 'desert')).toHaveLength(3);
      expect(view.board.terrain.filter((tile) => tile === 'gold')).toHaveLength(2);
      expect(view.board.terrain[view.board.robber]).toBe('desert');
      const { container } = render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
        arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
        viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
      expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(view.board.terrain.length);
      expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(harbors);
      expect(view.board.pirate).toBeNull();
      expect(container.querySelector('[data-testid="pirate-frame"]')).not.toBeNull();
      cleanup();
    });

    it('the coastline (as SVG and 3D call it, with the land mask): the main island and the strip are one landmass, plus three small islands', () => {
      const view = desertView(count);
      const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
      const loops = coastLoops(geometry.topology, geometry.land);
      // 主島與被沙漠隔出的陸地帶以沙漠相連成一塊陸地（一環），再加三座小島。
      expect(loops).toHaveLength(4);
      for (const loop of loops) expect(loop.points.length).toBeGreaterThanOrEqual(6);
      expect(loops.reduce((sum, loop) => sum + loop.points.length, 0)).toBeLessThanOrEqual(landHexes * 6);
    });
  },
);

describe('Through the Desert help', () => {
  function helpFor(profileId: string, locale: 'en' | 'zh-Hant') {
    cleanup();
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

  it('shows the desert rules, the gold rule and the 14-point target in English', () => {
    const english = helpFor(PROFILE, 'en');
    expect(english.textContent).toContain('Through the Desert');
    expect(english.textContent).toContain('unexplored regions');
    expect(english.textContent).toContain('14 points');
    expect(english.textContent).toContain('Gold fields');
    expect(english.textContent).not.toContain('Start on the main island');
    expect(english.textContent).not.toContain('small island');
    expect(english.textContent).not.toContain('home islands');
    expect(english.querySelector('[data-testid="help-desert-setup"]')).not.toBeNull();
    expect(english.querySelector('[data-testid="help-desert-bonus"]')).not.toBeNull();
  });

  it('shows the Traditional Chinese rules with 未探索區域, distinct from 小島 and 新島嶼', () => {
    const chinese = helpFor(PROFILE, 'zh-Hant');
    expect(chinese.textContent).toContain('穿越荒漠特殊規則');
    expect(chinese.textContent).toContain('未探索區域');
    expect(chinese.textContent).toContain('14 分');
    expect(chinese.textContent).toContain('金礦地');
    expect(chinese.textContent).not.toContain('小島');
    expect(chinese.textContent).not.toContain('從主島開始');
  });

  it('leaves the New Shores and Four Islands help alone', () => {
    const shores = helpFor('sf-new-shores-2025', 'en');
    expect(shores.textContent).toContain('Start on the main island');
    expect(shores.querySelector('[data-testid="help-desert-setup"]')).toBeNull();
    const four = helpFor('sf-four-islands-2025', 'en');
    expect(four.querySelector('[data-testid="help-four-islands-setup"]')).not.toBeNull();
    expect(four.querySelector('[data-testid="help-desert-setup"]')).toBeNull();
    expect(four.textContent).not.toMatch(/gold/i);
  });
});

describe('Through the Desert wording (unexplored region)', () => {
  const names = (id: string) => id.toUpperCase();
  const bonus = makeEvent(5, 'island.bonus', { playerId: 'p1', island: 2, vertex: 2, points: 2 });

  it('maps scenarios to their island wording', () => {
    expect(islandWording('through-the-desert')).toBe('desert');
    expect(islandWording('four-islands')).toBe('fourIslands');
    expect(islandWording('new-shores')).toBeNull();
    expect(islandWording(null)).toBeNull();
  });

  it('island bonus events say unexplored region in the desert, new island in four islands, small island in new shores', () => {
    expect(translateEvent('en', bonus, names, { scenario: 'through-the-desert' }).text).toBe('P1 settled a new unexplored region: +2 victory points.');
    expect(translateEvent('zh-Hant', bonus, names, { scenario: 'through-the-desert' }).text).toBe('P1 進入一處新的未探索區域：額外 +2 勝利分。');
    expect(translateEvent('en', bonus, names, { scenario: 'four-islands' }).text).toBe('P1 settled a new island: +2 victory points.');
    expect(translateEvent('en', bonus, names, { scenario: 'new-shores' }).text).toContain('small island');
  });

  function panelFor(profileId: string, locale: 'en' | 'zh-Hant') {
    cleanup();
    const state = createGame({
      profileId,
      players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })),
      setupMode: 'fixed',
      rng: seededRng(4),
    });
    state.moduleState = { seafarers: { window: state.windowId, built: [], moved: false, islands: { p1: [2, 5], p2: [], p3: [] }, claims: [] } };
    state.players[0]!.bonusPoints = 4;
    const view = projectGame(state, 'p2', { hints: actionHints(state, 'p2') });
    const controller = { state: { ...initialTableState(locale, 'Alex'), game: makeSnapshot(view) }, dispatch: vi.fn(), actions: {} } as unknown as TableController;
    render(<LocaleProvider locale={locale}><PlayersPanel controller={controller} /></LocaleProvider>);
    return screen.getByTestId('players-islands-0').getAttribute('aria-label')!;
  }

  it('the player panel lists the counted regions in both locales', () => {
    expect(panelFor(PROFILE, 'en')).toBe('Unexplored region bonus · 2 new unexplored region(s), +4 (region 2, 5): 4');
    expect(panelFor(PROFILE, 'zh-Hant')).toBe('未探索區域獎勵 · 2 處新的未探索區域，+4 (區域 2, 5): 4');
  });
});
