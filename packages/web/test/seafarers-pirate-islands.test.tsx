/**
 * The Pirate Islands（S7a）的前端：堡壘（lair 數）、beachhead、預置棋子與海盜航道在 SVG 與 3D 的位置，
 * 船線的下一個目標提示、玩家面板的堡壘與船線、船線被拒絕時的訊息（zh-Hant 與 en）。
 * 劇本規則說明在 S7c 啟用時補。
 */

import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameState, type GameView } from '@katan/rules';
import { buildGeometry } from '../src/board/geometry.ts';
import { seafarersHints, seafarersView } from '../src/board/seafarers.ts';
import { createBeachheadModel, createLairStackModel, createRouteMarkModel, createTargetRingModel, lairSpot, vertexSpot } from '../src/board/three/diorama-pirate-islands.ts';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { t as translate } from '../src/i18n/index.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeSnapshot } from '../src/test/fixtures.ts';

const PROFILE = 'sf-pirate-islands-2025';
const COLORS = ['red', 'blue', 'orange', 'white'] as const;

function pirateState(count: 3 | 4 = 4): GameState {
  const state = createGame({
    profileId: PROFILE,
    players: ['p1', 'p2', 'p3', 'p4'].slice(0, count).map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(4),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.windowId += 1;
  return state;
}

const viewOf = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });
const SESSION = { id: 'p1', nickname: 'Alex', locale: 'en' as const, createdAt: '2026-01-01T00:00:00.000Z' };

function controllerFor(view: GameView, locale: 'en' | 'zh-Hant' = 'en'): TableController {
  const state: TableState = {
    ...initialTableState(locale, 'Alex'),
    bootstrapped: true,
    session: { ...SESSION, locale },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(view),
  };
  return { state, dispatch: vi.fn(), actions: {} } as unknown as TableController;
}

const svg = (view: GameView) => {
  const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
  return render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
    arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
    viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id.toUpperCase()} /></LocaleProvider>);
};

describe('Pirate Islands board (SVG)', () => {
  it('draws the 49-hex map, 8 harbours, the preset settlements and ships, 4 fortresses with 3 lair tokens, 4 beachheads and the 14-hex route', () => {
    const view = viewOf(pirateState(4));
    const { container } = svg(view);
    expect(view.board.topologyId).toBe('sf-pirate-islands');
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(49);
    expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(8);
    // 預置：4 個東島村落 + 4 個堡壘（玩家色村落）= 8 棟建築，4 艘船。
    expect(container.querySelectorAll('[data-testid^="building-"]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-testid^="ship-"]')).toHaveLength(4);
    const fortresses = [...container.querySelectorAll('[data-testid^="fortress-"]')];
    expect(fortresses).toHaveLength(4);
    for (const node of fortresses) {
      expect(node.getAttribute('data-lairs')).toBe('3');
      expect(node.querySelector('title')!.textContent).toMatch(/^P[1-4]’s pirate fortress: 3 lair token\(s\) left/);
      expect(node.textContent).toContain('×3');
    }
    expect(container.querySelectorAll('[data-testid^="beachhead-"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="pirate-route"]')!.getAttribute('data-hexes')).toBe('14');
    expect(container.querySelector('[data-testid="pirate-route"] title')!.textContent).toBe('Pirate route');
    // 強盜不使用：沒有強盜棋子；海盜在航道起點的海格。
    expect(container.querySelector('[data-testid="robber"]')).toBeNull();
    expect(container.querySelector('[data-testid="pirate-hex"]')).not.toBeNull();
    cleanup();
  });

  it('3 players: three fortresses and three beachheads, no white pieces', () => {
    const { container } = svg(viewOf(pirateState(3)));
    expect(container.querySelectorAll('[data-testid^="fortress-"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-testid^="beachhead-"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-testid^="building-"]')).toHaveLength(6);
    cleanup();
  });

  it('marks the viewer’s next line target (beachhead first, then the fortress) and shows a recaptured fortress without lair tokens', () => {
    const state = pirateState(4);
    const view = viewOf(state);
    const sea = seafarersView(view)!;
    const mine = sea.pirateIslands!.beachheads.find((entry) => entry.player === 'p1')!;
    expect(sea.lineTarget).toBe(mine.vertex);
    expect(seafarersHints(view)!.pirateLine).toMatchObject({ next: 'beachhead', target: mine.vertex });
    const { container } = svg(view);
    const target = container.querySelectorAll('[data-target="true"]');
    expect(target).toHaveLength(1);
    expect(target[0]!.getAttribute('data-testid')).toBe(`beachhead-${mine.vertex}`);
    expect(target[0]!.querySelector('title')!.textContent).toBe('P1’s beachhead marker · your ship line goes here next');
    cleanup();
    // 到達 beachhead 後目標換成堡壘；堡壘收復後沒有 lair 疊。
    const slot = (state.moduleState as unknown as { seafarers: { pirateIslands: { fortresses: { player: string; vertex: number; lairs: number }[] } } }).seafarers.pirateIslands;
    slot.fortresses[0]!.lairs = 0;
    const recaptured = svg(viewOf(state)).container;
    const node = recaptured.querySelector(`[data-testid="fortress-${slot.fortresses[0]!.vertex}"]`)!;
    expect(node.getAttribute('data-lairs')).toBe('0');
    expect(node.querySelector('title')!.textContent).toBe('P1’s fortress, recaptured');
    expect(node.textContent).not.toContain('×');
    cleanup();
  });

  it('shows no pirate layer in other Seafarers scenarios', () => {
    const state = createGame({ profileId: 'sf-cloth-for-catan-2025', players: [{ id: 'p1', nickname: 'P1', color: 'red' }, { id: 'p2', nickname: 'P2', color: 'blue' }, { id: 'p3', nickname: 'P3', color: 'orange' }], setupMode: 'fixed', rng: seededRng(4) });
    state.turn.setup = null; state.turn.phase = 'action';
    const view = viewOf(state);
    expect(seafarersView(view)!.pirateIslands).toBeNull();
    expect(seafarersView(view)!.lineTarget).toBeNull();
    const { container } = svg(view);
    expect(container.querySelector('[data-testid="pirate-islands-layer"]')).toBeNull();
    cleanup();
  });
});

describe('Pirate Islands board (3D)', () => {
  it('stands the lair stack on land beside the fortress, the beachhead on its vertex, and builds the models', () => {
    const view = viewOf(pirateState(4));
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const pirate = seafarersView(view)!.pirateIslands!;
    expect(pirate.fortresses).toHaveLength(4);
    for (const fortress of pirate.fortresses) {
      const spot = lairSpot(geometry, fortress.vertex)!;
      const vertex = geometry.vertices[fortress.vertex]!;
      const info = geometry.topology.vertices[fortress.vertex]!;
      const land = geometry.hexes[info.hexes.find((hex) => geometry.land[hex] !== false)!]!;
      // 疊在堡壘旁：比頂點更靠近陸地格中心，且不在頂點正上方。
      const fromVertex = Math.hypot(spot[0] - vertex.x / geometry.scale, spot[2] - vertex.y / geometry.scale);
      const toLand = Math.hypot(spot[0] - land.cx / geometry.scale, spot[2] - land.cy / geometry.scale);
      const vertexToLand = Math.hypot(vertex.x - land.cx, vertex.y - land.cy) / geometry.scale;
      expect(fromVertex).toBeGreaterThan(0.2);
      expect(toLand).toBeLessThan(vertexToLand);
    }
    for (const beachhead of pirate.beachheads) {
      const spot = vertexSpot(geometry, beachhead.vertex)!;
      expect(spot[0]).toBeCloseTo(geometry.vertices[beachhead.vertex]!.x / geometry.scale, 6);
    }
    for (const model of [createLairStackModel(1), createLairStackModel(3), createBeachheadModel('#d33'), createTargetRingModel(), createRouteMarkModel()]) {
      expect(model.getAttribute('position').count).toBeGreaterThan(0);
    }
    // 更多的 lair 疊得更高。
    const height = (count: number) => { const box = createLairStackModel(count); box.computeBoundingBox(); return box.boundingBox!.max.y; };
    expect(height(3)).toBeGreaterThan(height(1));
    expect(pirate.route).toHaveLength(14);
  });
});

describe('Pirate Islands boxed-in line', () => {
  /** p1 的船線端點旁的邊全被 p4 的船占住：端點到目標完全不通，末端（預置）的船可以移動。 */
  function boxedIn(): GameState {
    const state = pirateState(4);
    const slot = (state.moduleState as unknown as { seafarers: { pirateIslands: { lines: Record<string, { start: number; edges: number[] }> } } }).seafarers.pirateIslands;
    const geometry = buildGeometry('sf-pirate-islands', 100, state.board.layout.terrain);
    const line = slot.lines.p1!;
    const info = geometry.topology.edges[line.edges[0]!]!;
    const end = info.vertices.find((vertex) => vertex !== line.start)!;
    for (const edge of geometry.topology.vertices[end]!.edges) if (!state.board.roads[edge]) state.board.roads[edge] = { player: 'p4', ship: true };
    return state;
  }

  it('lists the last ship as movable and says so in the panel, in both locales; nothing when the line is free', () => {
    const state = boxedIn();
    const view = viewOf(state, 'p1');
    const hints = seafarersHints(view)!;
    expect(hints.pirateLine).toMatchObject({ stuck: true });
    expect(hints.movableShips.map((entry) => entry.edge)).toContain(hints.pirateLine!.edges[0]);
    for (const locale of ['en', 'zh-Hant'] as const) {
      render(<LocaleProvider locale={locale}><PlayersPanel controller={controllerFor(view, locale)} /></LocaleProvider>);
      expect(screen.getByTestId('line-stuck').textContent).toBe(translate(locale, 'sf.pirate.stuck'));
      cleanup();
    }
    expect(translate('en', 'sf.pirate.stuck')).toContain('boxed in');
    expect(translate('zh-Hant', 'sf.pirate.stuck')).toContain('被圍住');
    render(<LocaleProvider locale="en"><PlayersPanel controller={controllerFor(viewOf(pirateState(4), 'p1'), 'en')} /></LocaleProvider>);
    expect(screen.queryByTestId('line-stuck')).toBeNull();
    cleanup();
  });
});

describe('Pirate Islands player panel and messages', () => {
  it('does not count an unrecaptured fortress as a settlement: after setup 3 settlements, 3 VP', () => {
    const state = pirateState(4);
    const geometry = buildGeometry('sf-pirate-islands', 100, state.board.layout.terrain);
    const topo = geometry.topology;
    const east = topo.vertices.map((info, vertex) => ({ info, vertex })).filter(({ info, vertex }) =>
      !state.board.buildings[vertex] && info.hexes.length > 0 && info.hexes.every((hex) => state.board.layout.islands[hex] === 1));
    // 設置後第 2、3 個村落（只影響顯示，不必合乎距離規則）。
    state.board.buildings[east[0]!.vertex] = { player: 'p1', city: false };
    state.board.buildings[east[east.length - 1]!.vertex] = { player: 'p1', city: false };
    render(<LocaleProvider locale="en"><PlayersPanel controller={controllerFor(viewOf(state, 'p1'), 'en')} /></LocaleProvider>);
    expect(screen.getAllByLabelText('Settlements (3 × 1): 3').length).toBeGreaterThan(0);
    const fortress = (state.moduleState as unknown as { seafarers: { pirateIslands: { fortresses: { player: string; lairs: number }[] } } }).seafarers.pirateIslands.fortresses[0]!;
    expect(fortress.lairs).toBe(3);
    cleanup();
    // 收復後堡壘算一個村落。
    fortress.lairs = 0;
    render(<LocaleProvider locale="en"><PlayersPanel controller={controllerFor(viewOf(state, 'p1'), 'en')} /></LocaleProvider>);
    expect(screen.getAllByLabelText('Settlements (4 × 1): 4').length).toBeGreaterThan(0);
    cleanup();
  });

  function panel(locale: 'en' | 'zh-Hant') {
    const state = pirateState(4);
    const slot = (state.moduleState as unknown as { seafarers: { pirateIslands: { fortresses: { player: string; lairs: number }[]; lines: Record<string, { start: number | null; edges: number[] }> } } }).seafarers.pirateIslands;
    slot.fortresses[1]!.lairs = 0;
    render(<LocaleProvider locale={locale}><PlayersPanel controller={controllerFor(viewOf(state, 'p1'), locale)} /></LocaleProvider>);
  }

  it('shows each player’s fortress (lair tokens left, or recaptured) and ship line, and no Longest Road or Largest Army', () => {
    panel('en');
    expect(screen.getByTestId('players-fortress-0').getAttribute('aria-label')).toBe('Pirate fortress (lair tokens left): ×3');
    expect(screen.getByTestId('players-fortress-0').textContent).toBe('×3');
    expect(screen.getByTestId('players-fortress-1').getAttribute('aria-label')).toBe('Pirate fortress (lair tokens left): recaptured');
    expect(screen.getByTestId('players-fortress-1').textContent).toBe('recaptured');
    expect(screen.getByTestId('players-ship-line-0').getAttribute('aria-label')).toBe('Ship line to the western islands: 1 ship(s), next: beachhead: 1');
    expect(screen.queryByTestId('players-route-0')).toBeNull();
    cleanup();
    panel('zh-Hant');
    expect(screen.getByTestId('players-fortress-0').getAttribute('aria-label')).toBe('海盜堡壘（剩餘 pirate lair）: ×3');
    expect(screen.getByTestId('players-fortress-1').getAttribute('aria-label')).toBe('海盜堡壘（剩餘 pirate lair）: 已收復');
    expect(screen.getByTestId('players-ship-line-0').getAttribute('aria-label')).toContain('下一站：beachhead');
    cleanup();
  });

  it('has the ship line refusal and the pirate texts in both locales', () => {
    expect(translate('en', 'error.E_SHIP_LINE')).toContain('shortest path');
    expect(translate('zh-Hant', 'error.E_SHIP_LINE')).toContain('最短路徑');
    expect(translate('en', 'error.E_LINE_WALLED')).toContain('wall off');
    expect(translate('zh-Hant', 'error.E_LINE_WALLED')).toContain('完全擋住');
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const key of ['sf.pirate.fortress', 'sf.pirate.fortressTarget', 'sf.pirate.recaptured', 'sf.pirate.beachhead', 'sf.pirate.beachheadTarget', 'sf.pirate.route', 'sf.pirate.next.done']) {
        expect(translate(locale, key as never, { player: 'P1', count: 2 })).not.toBe(key);
      }
    }
  });
});
