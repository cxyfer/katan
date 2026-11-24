/**
 * New World（S9）的前端：隨機版圖與放下的港口在 SVG 與 3D 的位置、港口選邊的棋盤目標、
 * 抽到的港口提示、房主的重新產生入口與全體同意的投票橫幅、島嶼獎勵 1 分、說明與事件文字。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, applyCommand, createGame, projectGame, seededRng, type Command, type GameState, type GameView } from '@katan/rules';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { targetsFromGeometry } from '../src/board/projection.ts';
import { islandBonusPoints, seafarersHints, seafarersView } from '../src/board/seafarers.ts';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { NewWorldPrompt, RegeneratePanel } from '../src/components/NewWorldPrompt.tsx';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { requiredActionFor } from '../src/state/pending.ts';
import { activeTurnKey, EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeMember, makeRoom, makeSnapshot } from '../src/test/fixtures.ts';

const PROFILE = 'sf-new-world-2025';
const COLORS = ['red', 'blue', 'orange', 'white'] as const;

function worldState(count: 3 | 4 = 3, seed = 4): GameState {
  return createGame({
    profileId: PROFILE,
    players: ['p1', 'p2', 'p3', 'p4'].slice(0, count).map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: 'variable',
    rng: seededRng(seed),
  });
}

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

const room = (overrides = {}) => makeRoom({
  status: 'playing', gameId: 'g1', profileId: PROFILE, setupMode: 'variable', capacity: 3,
  members: [makeMember(), makeMember({ playerId: 'p2', nickname: 'Bea', seat: 1, color: 'blue', host: false }), makeMember({ playerId: 'p3', nickname: 'Cy', seat: 2, color: 'orange', host: false })],
  ...overrides,
});

const place = (state: GameState, edge?: number): GameState => {
  const id = state.players[state.turn.seat]!.id;
  const edges = (actionHints(state, id).modules!.seafarers as { harborChoices: { edges: number[] } }).harborChoices.edges;
  const outcome = applyCommand(state, id, { type: 'world.harbor', edge: edge ?? edges[0]! } as unknown as Command, seededRng(1));
  if (!outcome.ok) throw new Error(outcome.error.code);
  return outcome.state;
};

const svg = (view: GameView) => {
  const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
  return render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
    arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
    viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
};

describe('New World board (SVG)', () => {
  it('draws the random 42-hex map with no printed ports, the robber off the board and no crash', () => {
    const view = viewOf(worldState());
    const { container } = svg(view);
    expect(view.board.topologyId).toBe('sf-new-world');
    expect(view.board.robber).toBe(-1);
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(42);
    expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(0);
    cleanup();
  });

  it('draws every placed port at its chosen edge', () => {
    let state = worldState(3, 7);
    for (let step = 0; step < 4; step++) state = place(state);
    const view = viewOf(state);
    const { container } = svg(view);
    expect(view.board.harbors).toHaveLength(4);
    for (const harbor of view.board.harbors) expect(container.querySelector(`[data-testid="harbor-${harbor.edge}"]`), `harbor ${harbor.edge}`).not.toBeNull();
    cleanup();
  });

  it('draws an island bonus token per claim', () => {
    const state = worldState();
    const slot = (state.moduleState as unknown as { seafarers: { claims: unknown[]; islands: Record<string, number[]> } }).seafarers;
    const vertex = state.board.buildings.findIndex((_, index) => index === 20);
    slot.claims.push({ player: 'p1', island: 2, vertex });
    slot.islands.p1!.push(2);
    const { container } = svg(viewOf(state));
    const token = container.querySelector('[data-testid^="island-bonus-"]')!;
    expect(container.querySelectorAll('[data-testid^="island-bonus-"]')).toHaveLength(1);
    // 新世界一個島 1 分，標記上寫 +1（New Shores 是 +2）。
    expect(token.textContent).toBe('+1');
    cleanup();
  });
});

describe('New World port placement on the board', () => {
  it('the acting player gets an armed edge board for the drawn port; everyone else gets none', () => {
    const state = worldState();
    const view = viewOf(state);
    const hints = seafarersHints(view)!;
    expect(view.turn.setup).toMatchObject({ stage: 'harbor', seat: 0 });
    expect(hints.harborChoices.harbors).toHaveLength(1);
    expect(hints.harborChoices.edges.length).toBeGreaterThan(10);
    const intent = boardIntent(tableWith(view), 'p1')!;
    expect(intent).toMatchObject({ kind: 'edge', commandType: 'world.harbor', labelId: 'sf.world.harbor', fromHints: true });
    expect(intent.targets).toEqual(hints.harborChoices.edges);
    const other = viewOf(state, 'p2');
    expect(boardIntent({ ...tableWith(other), session: { id: 'p2', nickname: 'B', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' } }, 'p2')).toBeNull();
  });

  it('the same edge targets are reachable by both renderers (shared geometry projection)', () => {
    const view = viewOf(worldState());
    const intent = boardIntent(tableWith(view), 'p1')!;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const projected = targetsFromGeometry(geometry, 'edge', intent.targets);
    expect(projected).toHaveLength(intent.targets.length);
    for (const target of projected) expect(Number.isFinite(target.world.x) && Number.isFinite(target.world.z)).toBe(true);
  });

  it('the setup banner names the port step, not a settlement or road', () => {
    const view = viewOf(worldState());
    expect(requiredActionFor(tableWith(view))).toMatchObject({ kind: 'setup', messageId: 'sf.world.harbor', mine: true });
    expect(requiredActionFor({ ...tableWith(viewOf(worldState(), 'p2')), session: { id: 'p2', nickname: 'B', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' } }))
      .toMatchObject({ kind: 'setup', messageId: 'sf.world.harbor', mine: false, waitingFor: ['p1'] });
  });
});

describe('New World prompt and regeneration vote', () => {
  const controllerFor = (view: GameView, selfId: string, extra: Partial<TableState> = {}, actions: Record<string, unknown> = {}) => ({
    state: tableWith(view, { session: { id: selfId, nickname: selfId, locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' }, ...extra }),
    actions: { proposeRegenerate: vi.fn(async () => true), respondRegenerate: vi.fn(async () => undefined), ...actions },
  }) as unknown as TableController;

  it('shows the drawn port to everyone, and the choose hint only to the acting player', () => {
    const view = viewOf(worldState());
    const drawn = seafarersView(view)!.world!.drawn!;
    render(<LocaleProvider locale="en"><NewWorldPrompt controller={controllerFor(view, 'p1', { room: room() })} /></LocaleProvider>);
    expect(screen.getByTestId('world-harbor-drawn').getAttribute('data-harbor')).toBe(drawn);
    expect(screen.getByTestId('world-harbor-drawn').textContent).toMatch(/P1 drew a (3:1|2:1 \w+) port\./);
    expect(screen.getByTestId('world-harbor-choose')).not.toBeNull();
    cleanup();
    render(<LocaleProvider locale="en"><NewWorldPrompt controller={controllerFor(viewOf(worldState(), 'p2'), 'p2', { room: room() })} /></LocaleProvider>);
    expect(screen.getByTestId('world-harbor-drawn')).not.toBeNull();
    expect(screen.queryByTestId('world-harbor-choose')).toBeNull();
    cleanup();
  });

  it('only the host sees the propose button; others get a note; it disappears after the first port', () => {
    const view = viewOf(worldState());
    const proposeRegenerate = vi.fn(async () => true);
    render(<LocaleProvider locale="en"><NewWorldPrompt controller={controllerFor(view, 'p1', { room: room() }, { proposeRegenerate })} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('world-regenerate'));
    expect(proposeRegenerate).toHaveBeenCalledTimes(1);
    cleanup();
    render(<LocaleProvider locale="en"><NewWorldPrompt controller={controllerFor(viewOf(worldState(), 'p2'), 'p2', { room: room() })} /></LocaleProvider>);
    expect(screen.queryByTestId('world-regenerate')).toBeNull();
    expect(screen.getByTestId('world-regenerate-note')).not.toBeNull();
    cleanup();
    const later = viewOf(place(worldState()), 'p2');
    render(<LocaleProvider locale="en"><NewWorldPrompt controller={controllerFor(later, 'p1', { room: room() })} /></LocaleProvider>);
    expect(screen.queryByTestId('world-regenerate')).toBeNull();
    expect(screen.queryByTestId('world-regenerate-note')).toBeNull();
    cleanup();
  });

  it('renders nothing outside the harbor stage', () => {
    let state = worldState();
    for (let step = 0; step < 10; step++) state = place(state);
    expect(state.turn.setup).toMatchObject({ stage: 'building' });
    const { container } = render(<LocaleProvider locale="en"><NewWorldPrompt controller={controllerFor(viewOf(state), 'p1', { room: room() })} /></LocaleProvider>);
    expect(container.textContent).toBe('');
    cleanup();
  });

  it('the vote banner lets an unconsenting seat approve or decline, and shows who is still awaited', async () => {
    const view = viewOf(worldState());
    const pendingRegenerate = { id: 'rg1', proposedBy: 'p1', consents: ['p1'], createdAt: '2026-01-01T00:00:00.000Z' };
    const respondRegenerate = vi.fn(async () => undefined);
    render(<LocaleProvider locale="en"><RegeneratePanel controller={controllerFor(viewOf(worldState(), 'p2'), 'p2', { room: room({ pendingRegenerate }) }, { respondRegenerate })} /></LocaleProvider>);
    expect(screen.getByTestId('regenerate-summary').textContent).toContain('Alex proposed redrawing');
    fireEvent.click(screen.getByTestId('regenerate-approve'));
    expect(respondRegenerate).toHaveBeenLastCalledWith('rg1', true);
    await waitFor(() => expect((screen.getByTestId('regenerate-reject') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('regenerate-reject'));
    expect(respondRegenerate).toHaveBeenLastCalledWith('rg1', false);
    cleanup();
    // 提案者看到等待名單與撤回按鈕，沒有同意／拒絕。
    render(<LocaleProvider locale="en"><RegeneratePanel controller={controllerFor(view, 'p1', { room: room({ pendingRegenerate }) }, { respondRegenerate })} /></LocaleProvider>);
    expect(screen.queryByTestId('regenerate-approve')).toBeNull();
    expect(screen.getByTestId('regenerate-waiting').textContent).toContain('Waiting for Bea, Cy to agree.');
    fireEvent.click(screen.getByTestId('regenerate-withdraw'));
    expect(respondRegenerate).toHaveBeenLastCalledWith('rg1', false);
    cleanup();
    // 沒有提案時沒有橫幅。
    const { container } = render(<LocaleProvider locale="en"><RegeneratePanel controller={controllerFor(view, 'p1', { room: room() })} /></LocaleProvider>);
    expect(container.textContent).toBe('');
    cleanup();
  });
});

describe('New World island bonus (1 point)', () => {
  it('counts 1 point per claimed island and the players panel shows it', () => {
    const state = worldState();
    const slot = (state.moduleState as unknown as { seafarers: { claims: unknown[]; islands: Record<string, number[]> } }).seafarers;
    slot.islands.p1!.push(2, 3);
    state.players[0]!.bonusPoints = 2;
    const view = viewOf(state, 'p2');
    expect(islandBonusPoints(view, 'p1', 1)).toBe(2);
    expect(islandBonusPoints(view, 'p1')).toBe(4);
    const controller = { state: { ...initialTableState('en', 'Alex'), game: makeSnapshot(view) }, dispatch: vi.fn(), actions: {} } as unknown as TableController;
    render(<LocaleProvider locale="en"><PlayersPanel controller={controller} /></LocaleProvider>);
    const mark = screen.getByTestId('players-islands-0');
    expect(mark.getAttribute('aria-label')).toContain('2 new island(s), +2');
    cleanup();
  });
});

describe('New World text', () => {
  const names = (id: string) => id.toUpperCase();

  function helpFor(locale: 'en' | 'zh-Hant') {
    cleanup();
    const controller = { state: { ...initialTableState(locale, 'Alex'), game: makeSnapshot(viewOf(worldState())) } } as unknown as TableController;
    render(<LocaleProvider locale={locale}><HelpPanel controller={controller} /></LocaleProvider>);
    return screen.getByTestId('help-seafarers');
  }

  it('the help panel explains the random map, port placement, home islands, regeneration and the 12-point target', () => {
    const english = helpFor('en');
    expect(english.textContent).toContain('New World');
    for (const id of ['setup', 'ports', 'bandits', 'bonus', 'regenerate', 'win']) expect(english.querySelector(`[data-testid="help-world-${id}"]`)).not.toBeNull();
    expect(english.textContent).toContain('12 points');
    expect(english.textContent).toContain('+1 victory point');
    expect(english.textContent).not.toContain('Gold fields');
    expect(english.textContent).not.toContain('Start on the main island');
    const chinese = helpFor('zh-Hant');
    expect(chinese.textContent).toContain('新世界特殊規則');
    expect(chinese.textContent).toContain('12 分');
    expect(chinese.textContent).toContain('全體玩家同意');
    cleanup();
  });

  it('draw, placement, skip and regeneration events read naturally in both locales', () => {
    const events = [
      makeEvent(1, 'world.harborDrawn', { playerId: 'p1', harbor: 'ore', number: 3 }),
      makeEvent(2, 'world.harborPlaced', { playerId: 'p2', harbor: 'generic', edge: 9 }),
      makeEvent(3, 'world.harborsSkipped', { remaining: 4 }),
      makeEvent(4, 'world.regenerated', { count: 2 }),
      makeEvent(5, 'island.bonus', { playerId: 'p1', island: 2, vertex: 3, points: 1 }),
    ];
    expect(translateEvent('en', events[0]!, names).text).toBe('P1 drew a 2:1 Ore port to place (port 3 of 10).');
    expect(translateEvent('en', events[1]!, names).text).toBe('P2 placed a 3:1 port on path 9.');
    expect(translateEvent('en', events[3]!, names).text).toContain('redraw 2');
    expect(translateEvent('en', events[4]!, names, { scenario: 'new-world' }).text).toBe('P1 settled a new island: +1 victory point.');
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const event of events) {
        const text = translateEvent(locale, event, names, { scenario: 'new-world' });
        expect(text.unknown, event.type).toBe(false);
        expect(text.text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe('New World board redraw clears a stale port selection', () => {
  it('a snapshot with a new reroll count or terrain empties the selection; the same board keeps it', async () => {
    const { tableReducer } = await import('../src/state/table.ts');
    const first = worldState(3, 7);
    const view = viewOf(first);
    const selection = { ...EMPTY_SELECTION, kind: 'edge' as const, index: 5, commandType: 'world.harbor', labelId: 'sf.world.harbor' };
    const base = tableWith(view, { selection });
    const sameBoard = tableReducer(base, { type: 'snapshot', snapshot: makeSnapshot(view, 13) });
    expect(sameBoard.selection).toEqual(selection);
    const other = viewOf(worldState(3, 8));
    const redrawn = tableReducer(base, { type: 'snapshot', snapshot: makeSnapshot(other, 14) });
    expect(redrawn.selection).toEqual(EMPTY_SELECTION);
    const rerolled = JSON.parse(JSON.stringify(view)) as GameView;
    (rerolled.modules!.seafarers as { world: { rerolls: number } }).world.rerolls = 1;
    expect(tableReducer(base, { type: 'snapshot', snapshot: makeSnapshot(rerolled, 15) }).selection).toEqual(EMPTY_SELECTION);
  });
});

describe('New World setup stage details', () => {
  it('the harbor stage never falls back to the starting-road board, even without a module board hint', () => {
    const view = viewOf(worldState());
    expect(boardIntent(tableWith(view), 'p1')).not.toBeNull();
    const bare = JSON.parse(JSON.stringify(view)) as GameView;
    const hints = bare.hints!.modules!.seafarers as { board: unknown; targets: Record<string, number[]> };
    hints.board = null;
    hints.targets = {};
    expect(boardIntent(tableWith(bare), 'p1')).toBeNull();
  });

  it('the active turn key changes with every port, redraw and the move on to the starting settlements', () => {
    const keyOf = (state: GameState) => activeTurnKey(tableWith(viewOf(state)))!;
    const start = worldState(3, 7);
    const keys = [keyOf(start)];
    let state = start;
    for (let step = 0; step < 10; step++) {
      state = place(state);
      keys.push(keyOf(state));
    }
    expect(new Set(keys).size).toBe(keys.length);
    // 重排：港口數與 remaining 都沒變，但 rerolls 變了。
    const redraw = JSON.parse(JSON.stringify(start)) as GameState;
    (redraw.moduleState as unknown as { seafarers: { world: { rerolls: number } } }).seafarers.world.rerolls = 1;
    expect(keyOf(redraw)).not.toBe(keys[0]);
  });

  it('the help panel shows port progress in the harbor stage, not the fixed placement count', () => {
    const controller = { state: { ...initialTableState('en', 'Alex'), game: makeSnapshot(viewOf(worldState())) } } as unknown as TableController;
    render(<LocaleProvider locale="en"><HelpPanel controller={controller} /></LocaleProvider>);
    const text = screen.getByTestId('help-panel').textContent!;
    expect(text).toContain('Setup · Placing ports: 1 of 10');
    expect(text).not.toContain('remaining');
    cleanup();
    let state = worldState();
    for (let step = 0; step < 10; step++) state = place(state);
    const later = { state: { ...initialTableState('en', 'Alex'), game: makeSnapshot(viewOf(state)) } } as unknown as TableController;
    render(<LocaleProvider locale="en"><HelpPanel controller={later} /></LocaleProvider>);
    expect(screen.getByTestId('help-panel').textContent).toMatch(/Setup · \d+ remaining/);
    cleanup();
  });
});
