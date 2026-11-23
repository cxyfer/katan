/**
 * The Forgotten Tribe（S5）的前端：禮物標記在 SVG 與 3D 的位置、暫存港口與 VP 標記的面板、
 * 港口放置的棋盤目標（單一種自動進入選邊、多種先選種類）、事件與說明文字。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameState, type GameView } from '@katan/rules';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { targetsFromGeometry } from '../src/board/projection.ts';
import { seafarersHints, seafarersView } from '../src/board/seafarers.ts';
import { giftTransform } from '../src/board/three/diorama-ships.ts';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { SeafarersPrompt } from '../src/components/SeafarersPrompt.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

const PROFILE = 'sf-forgotten-tribe-2025';
const COLORS = ['red', 'blue', 'orange', 'white'] as const;

function tribeState(count: 3 | 4 = 3): GameState {
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

const slotOf = (state: GameState) => (state.moduleState as unknown as {
  seafarers: { tribe: { gifts: { edge: number; kind: string; harbor?: string }[]; vp: Record<string, number>; held: Record<string, string[]> } };
}).seafarers.tribe;

const viewOf = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });

function tableWith(view: GameView, overrides: Partial<TableState> = {}): TableState {
  return {
    ...initialTableState('en', 'Alex'),
    bootstrapped: true,
    session: { id: 'p1', nickname: 'Alex', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(view),
    ...overrides,
  };
}

/** p1 有一個大島海岸村落，並暫存了 `held` 港口，輪到 p1 放。 */
function placing(held: string[]): GameView {
  const state = tribeState();
  const topology = createGameTopology(state);
  const coast = topology.vertices.findIndex((info, vertex) => info.edges.length === 3 && state.board.layout.islands[info.hexes[0]!] === 1
    && info.hexes.every((hex) => state.board.layout.islands[hex] === 1 || state.board.layout.terrain[hex] === 'sea')
    && info.edges.filter((edge) => topology.edges[edge]!.hexes.length === 1 || topology.edges[edge]!.hexes.some((hex) => state.board.layout.terrain[hex] === 'sea')).length === 2
    && vertex >= 0);
  state.board.buildings[coast] = { player: 'p1', city: false };
  slotOf(state).held.p1 = held;
  state.pending = { kind: 'seafarers.harbor', module: 'seafarers', responders: ['p1'], data: {} };
  return viewOf(state);
}

function createGameTopology(state: GameState) {
  const geometry = buildGeometry(state.board.layout.topologyId, 100, state.board.layout.terrain);
  return geometry.topology;
}

describe('Forgotten Tribe board (SVG)', () => {
  const svg = (view: GameView) => {
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    return render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
      arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
  };

  it('draws the 49-hex map, 18 gifts of the right kinds, no printed harbours and the pirate on its sea hex', () => {
    const view = viewOf(tribeState());
    const { container } = svg(view);
    expect(view.board.topologyId).toBe('sf-forgotten-tribe');
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(49);
    expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(0);
    const gifts = [...container.querySelectorAll('[data-gift-kind]')];
    expect(gifts).toHaveLength(18);
    const count = (kind: string) => gifts.filter((node) => node.getAttribute('data-gift-kind') === kind).length;
    expect([count('vp'), count('devcard'), count('port')]).toEqual([8, 4, 6]);
    // 面朝上的港口顯示種類（5 個 2:1 資源港、1 個 3:1），發展牌不帶任何身分。
    const harbors = gifts.filter((node) => node.getAttribute('data-gift-kind') === 'port').map((node) => node.getAttribute('data-gift-harbor')).sort();
    expect(harbors).toEqual(['brick', 'generic', 'grain', 'lumber', 'ore', 'wool']);
    for (const node of gifts.filter((entry) => entry.getAttribute('data-gift-kind') === 'devcard')) expect(node.getAttribute('data-gift-harbor')).toBeNull();
    expect(container.querySelector('[data-testid="pirate-hex"]')).not.toBeNull();
    expect(container.textContent).not.toContain('victoryPoint');
    cleanup();
  });

  it('removes a gift once taken and draws a placed harbour', () => {
    const state = tribeState();
    const taken = slotOf(state).gifts.find((gift) => gift.kind === 'port')!;
    slotOf(state).gifts = slotOf(state).gifts.filter((gift) => gift !== taken);
    state.board.layout.harbors.push({ edge: taken.edge, type: 'brick' });
    const { container } = svg(viewOf(state));
    expect(container.querySelectorAll('[data-gift-kind]')).toHaveLength(17);
    expect(container.querySelector(`[data-testid="gift-${taken.edge}"]`)).toBeNull();
    expect(container.querySelector(`[data-testid="harbor-${taken.edge}"]`)).not.toBeNull();
    cleanup();
  });

  it('gift markers carry accessible names in both locales', () => {
    const view = viewOf(tribeState());
    const { container } = svg(view);
    const titles = [...container.querySelectorAll('[data-testid^="gift-"] ~ title')].map((node) => node.textContent);
    expect(titles).toContain('a victory point token (+1)');
    expect(titles).toContain('a development card');
    expect(titles).toContain('a 3:1 port');
    cleanup();
  });
});

describe('Forgotten Tribe board (3D)', () => {
  it('places every gift on the water beside its edge, away from the land hex and apart from the others', () => {
    const view = viewOf(tribeState());
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const gifts = seafarersView(view)!.tribe!.gifts;
    expect(gifts).toHaveLength(18);
    const seen = new Set<string>();
    for (const gift of gifts) {
      const transform = giftTransform(geometry, gift.edge)!;
      expect(transform, `gift ${gift.edge}`).not.toBeNull();
      const edge = geometry.edges[gift.edge]!;
      const hex = geometry.hexes[geometry.topology.edges[gift.edge]!.hexes[0]!]!;
      const mid = { x: (edge.x1 + edge.x2) / 2 / geometry.scale, z: (edge.y1 + edge.y2) / 2 / geometry.scale };
      const centre = { x: hex.cx / geometry.scale, z: hex.cy / geometry.scale };
      const [x, , z] = transform.position;
      expect(Math.hypot(x - centre.x, z - centre.z)).toBeGreaterThan(Math.hypot(mid.x - centre.x, mid.z - centre.z));
      seen.add(`${x.toFixed(3)},${z.toFixed(3)}`);
    }
    expect(seen.size).toBe(18);
  });
});

describe('Forgotten Tribe players panel', () => {
  function panel(locale: 'en' | 'zh-Hant') {
    cleanup();
    const state = tribeState();
    slotOf(state).vp.p1 = 2;
    state.players[0]!.bonusPoints = 2;
    slotOf(state).held.p1 = ['brick', 'generic'];
    const controller = { state: { ...initialTableState(locale, 'Alex'), game: makeSnapshot(viewOf(state, 'p2')) }, dispatch: vi.fn(), actions: {} } as unknown as TableController;
    render(<LocaleProvider locale={locale}><PlayersPanel controller={controller} /></LocaleProvider>);
  }

  it('shows each player’s VP tokens and the ports waiting in front of them as visible text', () => {
    panel('en');
    expect(screen.getByTestId('players-tribe-vp-0').getAttribute('aria-label')).toBe('Victory point tokens: 2');
    const held = screen.getByTestId('players-tribe-held-0');
    expect(held.getAttribute('aria-label')).toBe('Ports waiting to be placed: a 2:1 Brick port · a 3:1 port: 2');
    expect(held.textContent).toContain('2:1B 3:1');
    expect(screen.queryByTestId('players-tribe-vp-1')).toBeNull();
    panel('zh-Hant');
    expect(screen.getByTestId('players-tribe-vp-0').getAttribute('aria-label')).toContain('VP 標記');
    expect(screen.getByTestId('players-tribe-held-0').getAttribute('aria-label')).toContain('尚未放下的港口');
    cleanup();
  });
});

describe('Forgotten Tribe harbour placement on the board', () => {
  it('one held kind arms the board straight away: edge targets beside the settlement, carrying the harbour', () => {
    const view = placing(['brick']);
    const hints = seafarersHints(view)!;
    expect(hints.harborChoices.harbors).toEqual(['brick']);
    expect(hints.harborChoices.edges.length).toBeGreaterThan(0);
    const intent = boardIntent(tableWith(view), 'p1')!;
    expect(intent).toMatchObject({ kind: 'edge', commandType: 'harbor.place', labelId: 'sf.harbor.place', extra: { harbor: 'brick' }, fromHints: true });
    expect(intent.targets).toEqual(hints.harborChoices.edges);
  });

  it('several kinds ask for the kind first, then arm the board with that kind', () => {
    const view = placing(['brick', 'generic']);
    expect(boardIntent(tableWith(view), 'p1')).toBeNull();
    const selectTarget = vi.fn();
    const controller = { state: tableWith(view), actions: { submitCommand: vi.fn(), selectTarget, cancelSelection: vi.fn() } } as unknown as TableController;
    render(<LocaleProvider locale="en"><SeafarersPrompt controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('harbor-choice-text').textContent).toContain('Which port');
    fireEvent.click(screen.getByTestId('harbor-type-generic'));
    expect(selectTarget).toHaveBeenCalledWith({ kind: 'edge', index: null, commandType: 'harbor.place', labelId: 'sf.harbor.place', extra: { harbor: 'generic' }, targetsKey: 'harbor.place' });
    cleanup();
    const armed = boardIntent(tableWith(view, { selection: { ...EMPTY_SELECTION, kind: 'edge', commandType: 'harbor.place', labelId: 'sf.harbor.place', extra: { harbor: 'generic' }, targetsKey: 'harbor.place' } }), 'p1')!;
    expect(armed).toMatchObject({ kind: 'edge', commandType: 'harbor.place', extra: { harbor: 'generic' } });
    expect(armed.targets).toEqual(seafarersHints(view)!.harborChoices.edges);
  });

  it('the same edge targets are reachable by both renderers (shared geometry projection)', () => {
    const view = placing(['wool']);
    const intent = boardIntent(tableWith(view), 'p1')!;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const projected = targetsFromGeometry(geometry, 'edge', intent.targets);
    expect(projected).toHaveLength(intent.targets.length);
    for (const target of projected) {
      expect(Number.isFinite(target.world.x) && Number.isFinite(target.world.z)).toBe(true);
    }
  });

  it('other players see no choices and no armed board while waiting', () => {
    const state = tribeState();
    slotOf(state).held.p1 = ['brick'];
    state.pending = { kind: 'seafarers.harbor', module: 'seafarers', responders: ['p1'], data: {} };
    const other = viewOf(state, 'p2');
    expect(seafarersHints(other)!.harborChoices).toEqual({ harbors: [], edges: [] });
    expect(boardIntent({ ...tableWith(other), session: { id: 'p2', nickname: 'B', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' } }, 'p2')).toBeNull();
  });
});

describe('Forgotten Tribe text', () => {
  const names = (id: string) => id.toUpperCase();

  function helpFor(locale: 'en' | 'zh-Hant') {
    cleanup();
    const controller = { state: { ...initialTableState(locale, 'Alex'), game: makeSnapshot(viewOf(tribeState())) } } as unknown as TableController;
    render(<LocaleProvider locale={locale}><HelpPanel controller={controller} /></LocaleProvider>);
    return screen.getByTestId('help-seafarers');
  }

  it('the help panel explains gifts, ports, number discs and the 13-point target, without island bonus or gold', () => {
    const english = helpFor('en');
    expect(english.textContent).toContain('The Forgotten Tribe');
    for (const id of ['setup', 'discs', 'gifts', 'ports', 'win']) expect(english.querySelector(`[data-testid="help-tribe-${id}"]`)).not.toBeNull();
    expect(english.textContent).toContain('13 points');
    expect(english.textContent).toContain('one path between ports');
    expect(english.textContent).not.toContain('Gold fields');
    expect(english.textContent).not.toContain('+2 victory points');
    expect(english.textContent).not.toContain('Start on the main island');
    const chinese = helpFor('zh-Hant');
    expect(chinese.textContent).toContain('世外部落特殊規則');
    expect(chinese.textContent).toContain('13 分');
    expect(chinese.textContent).toContain('數字圓片');
    expect(chinese.textContent).not.toContain('金礦地');
    cleanup();
  });

  it('gift and placement events read naturally in both locales', () => {
    const vp = makeEvent(1, 'tribe.gift', { playerId: 'p1', edge: 4, gift: 'vp' });
    const card = makeEvent(2, 'tribe.gift', { playerId: 'p1', edge: 2, gift: 'devcard' });
    const port = makeEvent(3, 'tribe.gift', { playerId: 'p1', edge: 3, gift: 'port', harbor: 'brick' });
    const placed = makeEvent(4, 'harbor.placed', { playerId: 'p1', edge: 9, harbor: 'generic' });
    expect(translateEvent('en', vp, names).text).toBe('P1 took a victory point token (+1) from path 4.');
    expect(translateEvent('en', card, names).text).toBe('P1 took a development card from path 2.');
    expect(translateEvent('en', port, names).text).toBe('P1 took a 2:1 Brick port from path 3.');
    expect(translateEvent('en', placed, names).text).toBe('P1 placed a 3:1 port beside a coastal settlement (path 9).');
    expect(translateEvent('zh-Hant', port, names).text).toContain('拿走了');
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const event of [vp, card, port, placed]) {
        const text = translateEvent(locale, event, names);
        expect(text.unknown, event.type).toBe(false);
        expect(text.text).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('the waiting prompt names the harbour placement', () => {
    const view = placing(['brick']);
    expect(view.pending).toMatchObject({ kind: 'seafarers.harbor', module: 'seafarers' });
  });
});
