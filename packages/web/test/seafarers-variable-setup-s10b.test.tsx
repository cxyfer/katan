/**
 * S10b：世外部落、布匹產地、卡坦奇觀的 variable setup 在前端：大廳可選、SVG 渲染 variable 版圖；
 * 布匹產地的選強盜（12 號圓片格）在 SVG 與 3D 共用的棋盤目標上可操作，提示、事件文字與兩種語言。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, applyCommand, createGame, getProfile, projectGame, seededRng, type Command, type GameState, type GameView } from '@katan/rules';
import { App } from '../src/App.tsx';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { targetsFromGeometry } from '../src/board/projection.ts';
import { BoardView } from '../src/components/BoardView.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { t as translate } from '../src/i18n/index.ts';
import { requiredActionFor } from '../src/state/pending.ts';
import { activeTurnKey, EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import { memoryStorage } from '../src/state/session.ts';
import type { TableController } from '../src/state/useTable.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeEvent, makeProfile, makeRoom, makeSnapshot } from '../src/test/fixtures.ts';

const COLORS = ['red', 'blue', 'orange', 'white'] as const;
const SCENARIOS = ['sf-forgotten-tribe-2025', 'sf-cloth-for-catan-2025', 'sf-wonders-of-catan-2025'] as const;
const CLOTH = 'sf-cloth-for-catan-2025';

function gameState(profileId: string, count: 3 | 4, mode: 'fixed' | 'variable', seed = 9): GameState {
  return createGame({
    profileId,
    players: ['p1', 'p2', 'p3', 'p4'].slice(0, count).map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: mode,
    rng: seededRng(seed),
  });
}

const viewOf = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });

function tableWith(view: GameView, viewer = 'p1', overrides: Partial<TableState> = {}): TableState {
  return {
    ...initialTableState('en', 'Alex'),
    bootstrapped: true,
    session: { id: viewer, nickname: viewer, locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(view),
    ...overrides,
  };
}

describe('lobby', () => {
  for (const id of SCENARIOS) {
    it(`${id}: the host can switch the setup mode to variable`, async () => {
      const profile = getProfile(id)!;
      const api = createFakeApi({
        room: makeRoom({ profileId: id, capacity: 4, setupMode: 'fixed' }),
        profiles: [makeProfile({ id, playerCounts: [3, 4], setupModes: [...profile.setupModes], expansions: ['seafarers'], scenario: profile.scenario })],
      });
      render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
      fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
      fireEvent.click(screen.getByTestId('join-room'));
      await screen.findByTestId('room-code');
      const setup = screen.getByTestId('lobby-setup') as HTMLSelectElement;
      expect([...setup.options].map((option) => option.value)).toEqual(['fixed', 'variable']);
      fireEvent.change(setup, { target: { value: 'variable' } });
      fireEvent.click(screen.getByTestId('save-settings'));
      await waitFor(() => expect(api.callsOf('updateSettings')).toHaveLength(1));
      expect(api.callsOf('updateSettings')[0]!.args[1]).toEqual({ setupMode: 'variable' });
      cleanup();
    });
  }
});

describe.each(SCENARIOS)('%s variable board in the SVG renderer', (id) => {
  for (const count of [3, 4] as const) {
    it(`${count} players: same topology and land as fixed, different discs, every hex and port drawn`, () => {
      const fixed = viewOf(gameState(id, count, 'fixed'));
      const view = viewOf(gameState(id, count, 'variable'));
      expect(view.board.topologyId).toBe(fixed.board.topologyId);
      expect(view.board.terrain.filter((tile) => tile !== 'sea')).toHaveLength(fixed.board.terrain.filter((tile) => tile !== 'sea').length);
      expect(view.board.numbers).not.toEqual(fixed.board.numbers);
      const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
      const { container } = render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
        arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
        viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(pid) => pid} /></LocaleProvider>);
      expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(view.board.terrain.length);
      expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(view.board.harbors.length);
      cleanup();
    });
  }
});

describe('Cloth for Catan: choosing the robber in the variable setup', () => {
  const twelves = (view: GameView): number[] => view.board.numbers.flatMap((n, hex) => n === 12 ? [hex] : []);

  it('the starting player gets an armed hex board on the two 12 hexes; everyone else gets none', () => {
    const state = gameState(CLOTH, 4, 'variable');
    const view = viewOf(state);
    expect(view.turn.setup).toMatchObject({ stage: 'robber', seat: 0 });
    const intent = boardIntent(tableWith(view), 'p1')!;
    expect(intent).toMatchObject({ kind: 'hex', commandType: 'cloth.robber', labelId: 'sf.cloth.robber', fromHints: true });
    expect(intent.targets).toEqual(twelves(view));
    expect(intent.targets).toHaveLength(2);
    const other = viewOf(state, 'p2');
    expect(boardIntent(tableWith(other, 'p2'), 'p2')).toBeNull();
  });

  it('the same hex targets are reachable by both renderers (shared geometry projection used by the 3D scene)', () => {
    const view = viewOf(gameState(CLOTH, 4, 'variable'));
    const intent = boardIntent(tableWith(view), 'p1')!;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const projected = targetsFromGeometry(geometry, 'hex', intent.targets);
    expect(projected.map((target) => target.index)).toEqual(intent.targets);
    for (const target of projected) expect(Number.isFinite(target.world.x) && Number.isFinite(target.world.z)).toBe(true);
  });

  it('the board offers the two hexes in the target list and selecting one arms cloth.robber with the hex field', async () => {
    const view = viewOf(gameState(CLOTH, 4, 'variable'));
    const selectTarget = vi.fn();
    const controller = { state: tableWith(view), dispatch: vi.fn(), actions: { selectTarget } } as unknown as TableController;
    render(<LocaleProvider locale="en"><BoardView controller={controller} /></LocaleProvider>);
    // 設置導引說明要選強盜，而不是放村落或路。
    expect(screen.getByTestId('setup-robber-guide').textContent).toContain('12');
    fireEvent.click(await screen.findByTestId('open-target-picker'));
    const [first, second] = twelves(view);
    expect(screen.queryByTestId(`picker-hex-${first}`)).not.toBeNull();
    expect(screen.queryByTestId(`picker-hex-${second}`)).not.toBeNull();
    fireEvent.click(screen.getByTestId(`picker-hex-${second}`));
    expect(selectTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hex', index: second, commandType: 'cloth.robber', labelId: 'sf.cloth.robber' }));
    cleanup();
  });

  it('the setup banner names the robber step; the starter is the one asked, the others wait for them', () => {
    const state = gameState(CLOTH, 4, 'variable');
    expect(requiredActionFor(tableWith(viewOf(state)))).toMatchObject({ kind: 'setup', messageId: 'sf.cloth.robber.piece', mine: true });
    expect(requiredActionFor(tableWith(viewOf(state, 'p2'), 'p2'))).toMatchObject({ kind: 'setup', messageId: 'sf.cloth.robber.piece', mine: false, waitingFor: ['p1'] });
  });

  it('after the choice the board goes back to the starting settlements and the event reads in both languages', () => {
    const state = gameState(CLOTH, 4, 'variable');
    const hex = state.board.layout.numbers.map((n, index) => ({ n, index })).filter(({ n }) => n === 12).map(({ index }) => index)[1]!;
    const outcome = applyCommand(state, 'p1', { type: 'cloth.robber', hex } as unknown as Command, seededRng(1));
    if (!outcome.ok) throw new Error(outcome.error.code);
    const view = viewOf(outcome.state);
    expect(view.turn.setup).toMatchObject({ stage: 'building' });
    expect(view.board.robber).toBe(hex);
    expect(boardIntent(tableWith(view), 'p1')).toMatchObject({ kind: 'vertex', commandType: 'setup.placeBuilding' });
    const event = makeEvent(1, 'cloth.robberChosen', { playerId: 'p1', hex });
    const names = (id: string) => id.toUpperCase();
    expect(translateEvent('en', event, names).text).toBe(`P1 chose hex ${hex} (a 12 disc) for the robber to start on.`);
    for (const locale of ['en', 'zh-Hant'] as const) {
      const text = translateEvent(locale, event, names);
      expect(text.unknown).toBe(false);
      expect(text.text).not.toMatch(/\{\w+\}/);
    }
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const id of ['sf.cloth.robber', 'sf.cloth.robber.piece', 'sf.cloth.robber.choose', 'sf.cloth.robber.wait']) {
        expect(translate(locale, id), `${locale} ${id}`).not.toBe(id);
      }
    }
  });

  it('the active turn key changes when the robber is chosen (remaining steps do not change)', () => {
    const state = gameState(CLOTH, 4, 'variable');
    const before = activeTurnKey(tableWith(viewOf(state)))!;
    const hex = state.board.layout.numbers.indexOf(12);
    const outcome = applyCommand(state, 'p1', { type: 'cloth.robber', hex } as unknown as Command, seededRng(1));
    if (!outcome.ok) throw new Error(outcome.error.code);
    expect(activeTurnKey(tableWith(viewOf(outcome.state)))).not.toBe(before);
  });

  it('the guide for other players names the chooser', () => {
    const view = viewOf(gameState(CLOTH, 4, 'variable'), 'p2');
    const controller = { state: tableWith(view, 'p2'), dispatch: vi.fn(), actions: {} } as unknown as TableController;
    render(<LocaleProvider locale="en"><BoardView controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('setup-robber-guide').textContent).toContain('P1');
    cleanup();
  });
});

