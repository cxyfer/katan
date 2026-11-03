import { useEffect } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameView } from '@catan/rules';
import { DICE_PRESENTATION_DURATION_MS, MAX_EFFECT_DURATION_MS } from '../src/board/animation.ts';
import type { BoardSceneProps } from '../src/board/render-contract.ts';
import { useBoardAnimation } from '../src/board/useBoardAnimation.ts';
import { BoardView } from '../src/components/BoardView.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { boardHeld, initialTableState, shownBoardView, tableReducer, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeHints, makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

// 只記錄 3D 場景收到的盤面；不回報 ready，畫面維持 SVG 以便同時檢查兩條路徑。
const sceneMock = vi.hoisted(() => ({ props: null as BoardSceneProps | null }));
vi.mock('../src/board/three/BoardScene3D.tsx', () => ({
  default: (props: BoardSceneProps) => {
    sceneMock.props = props;
    useEffect(() => undefined, []);
    return <div data-testid="board-scene-mock" aria-hidden="true" />;
  },
}));

const KNIGHT = 5;
const CITY = 20;
const OTHER_CITY = 30;
const ROAD = 7;

function ckModule(overrides: Record<string, unknown> = {}) {
  return {
    barbarian: { position: 6, length: 7, attacks: 0 },
    barbarianStrength: 2, defenderStrength: 2, robberActive: false,
    lastRoll: { event: 'science', red: 2, atSeq: 11 },
    knights: [{ player: 'p1', vertex: KNIGHT, level: 2, active: true }],
    walls: [{ vertex: CITY, player: 'p2' }],
    toppled: [] as number[],
    metropolises: { science: { player: 'p1', vertex: OTHER_CITY }, trade: null, politics: null },
    ...overrides,
  };
}

/** 擲骰前：p1 的騎士已啟用、p2 的城市有城牆、強盜尚未登場。 */
function preRoll(ck = true): TableState {
  const view = makeView({ hints: makeHints() });
  view.seq = 12;
  view.events = [makeEvent(12, 'turn.started')];
  view.board.buildings[CITY] = { player: 'p2', city: true };
  view.board.buildings[OTHER_CITY] = { player: 'p1', city: true };
  if (ck) view.modules = { citiesKnights: ckModule() };
  return { ...initialTableState('en', ''), session: makeIdentity(), game: makeSnapshot(view, 12) };
}

/** 蠻族攻擊那一擲：騎士翻倒、p2 的城市倒下並失去城牆、強盜進入沙漠。 */
function attackRoll(before: TableState): ReturnType<typeof makeSnapshot> {
  const after = structuredClone(before.game!);
  after.view.seq = after.revision = 18;
  after.view.turn.dice = [2, 6];
  after.view.events.push(
    makeEvent(13, 'turn.rolled', { dice: [2, 6], total: 8, extra: { event: 'ship', red: 6 } }),
    makeEvent(14, 'ck.eventRolled', { event: 'ship', red: 6 }),
    makeEvent(15, 'ck.barbariansAdvanced', { position: 7, length: 7 }),
    makeEvent(16, 'ck.barbariansAttack', { barbarians: 2, defenders: 2, outcome: 'barbarians' }),
    makeEvent(17, 'ck.cityPillaged', { playerId: 'p2', vertex: CITY, wallLost: true, toppled: true }),
    makeEvent(18, 'ck.robberEntered', { hex: after.view.board.robber }),
  );
  after.view.board.buildings[CITY] = { player: 'p2', city: false };
  after.view.modules = { citiesKnights: ckModule({
    barbarian: { position: 0, length: 7, attacks: 1 },
    defenderStrength: 0, robberActive: true,
    lastRoll: { event: 'ship', red: 6, atSeq: 13 },
    knights: [{ player: 'p1', vertex: KNIGHT, level: 2, active: false }],
    walls: [],
    toppled: [CITY],
  }) };
  return after;
}

function deliver(before: TableState, after: ReturnType<typeof makeSnapshot>, order: 'snapshot' | 'events'): TableState {
  const state = order === 'events' ? tableReducer(before, { type: 'events', events: after.view.events }) : before;
  return tableReducer(state, { type: 'snapshot', snapshot: after });
}

function board(state: TableState) {
  const controller: TableController = { state, dispatch: vi.fn(), actions: {} as TableController['actions'] };
  return <LocaleProvider locale="en"><BoardView controller={controller} /></LocaleProvider>;
}

const knight = () => screen.getByTestId(`knight-${KNIGHT}`).getAttribute('data-active');
const building = () => screen.getByTestId(`building-${CITY}`).querySelector('title')!.textContent;

describe('board hold during the roll presentation', () => {
  it.each(['snapshot', 'events'] as const)('keeps the SVG board at its pre-roll state through a barbarian attack (%s first)', (order) => {
    const before = preRoll();
    const held = deliver(before, attackRoll(before), order);
    expect(held.dicePresenting).toBe(true);
    expect(boardHeld(held)).toBe(true);
    expect(shownBoardView(held)).toBe(before.game!.view);

    const { rerender } = render(board(held));
    expect(knight()).toBe('true');
    expect(building()).toContain('City');
    expect(screen.queryByTestId(`wall-${CITY}`)).not.toBeNull();
    expect(screen.getByTestId('metropolis-science')).not.toBeNull();
    expect(screen.queryByTestId('robber')).toBeNull();

    const revealed = tableReducer(held, { type: 'dice-presenting', value: false });
    expect(boardHeld(revealed)).toBe(false);
    expect(shownBoardView(revealed)).toBe(revealed.game!.view);
    rerender(board(revealed));
    expect(knight()).toBe('false');
    expect(building()).toContain('Settlement');
    expect(screen.queryByTestId(`wall-${CITY}`)).toBeNull();
    expect(screen.getByTestId('metropolis-science')).not.toBeNull();
    expect(screen.queryByTestId('robber')).not.toBeNull();
  });

  it('keeps the pre-roll board when later projections arrive during the presentation', () => {
    const before = preRoll();
    const after = attackRoll(before);
    let state = deliver(before, after, 'snapshot');
    const later = structuredClone(after);
    later.view.seq = later.revision = 19;
    later.view.events.push(makeEvent(19, 'build.road', { playerId: 'p2', edge: ROAD }));
    later.view.board.roads[ROAD] = { player: 'p2', ship: false };
    state = tableReducer(state, { type: 'snapshot', snapshot: later });
    expect(shownBoardView(state)).toBe(before.game!.view);
    render(board(state));
    expect(knight()).toBe('true');
    expect(screen.queryByTestId(`road-${ROAD}`)).toBeNull();
  });

  it('drops the held board when another game opens', () => {
    const before = preRoll();
    const held = deliver(before, attackRoll(before), 'snapshot');
    const other = makeSnapshot(makeView({ hints: makeHints() }), 3);
    other.gameId = 'g2';
    const state = tableReducer(held, { type: 'snapshot', snapshot: other });
    expect(state.rollHold).toBeNull();
    expect(shownBoardView(state)).toBe(other.view);
  });

  it('does not hold the board for an update without a roll', () => {
    const before = preRoll();
    const built = structuredClone(before.game!);
    built.view.seq = built.revision = 13;
    built.view.events.push(makeEvent(13, 'build.road', { playerId: 'p1', edge: ROAD }));
    built.view.board.roads[ROAD] = { player: 'p1', ship: false };
    const state = tableReducer(before, { type: 'snapshot', snapshot: built });
    expect(state.dicePresenting).toBe(false);
    expect(shownBoardView(state)).toBe(built.view);
    render(board(state));
    expect(screen.getByTestId(`road-${ROAD}`)).not.toBeNull();
  });

  it('leaves the base game board live while its dice are presenting', () => {
    const before = preRoll(false);
    const after = structuredClone(before.game!);
    after.view.seq = after.revision = 15;
    after.view.turn.dice = [3, 3];
    after.view.events.push(
      makeEvent(13, 'turn.rolled', { dice: [3, 3], total: 6 }),
      makeEvent(14, 'production.resolved'),
      makeEvent(15, 'build.road', { playerId: 'p2', edge: ROAD }),
    );
    after.view.board.roads[ROAD] = { player: 'p2', ship: false };
    const state = tableReducer(before, { type: 'snapshot', snapshot: after });
    expect(state.dicePresenting).toBe(true);
    expect(state.rollHold?.board).toBeNull();
    expect(boardHeld(state)).toBe(false);
    expect(shownBoardView(state)).toBe(after.view);
    render(board(state));
    expect(screen.getByTestId(`road-${ROAD}`)).not.toBeNull();
    expect(screen.queryByTestId('robber')).not.toBeNull();
  });

  it('passes the pre-roll board and C&K pieces to the 3D scene until the dice settle', async () => {
    history.replaceState(null, '', '/?renderer=r3f');
    sceneMock.props = null;
    const before = preRoll();
    const after = attackRoll(before);
    const held = deliver(before, after, 'snapshot');
    const { rerender } = render(board(held));
    await screen.findByTestId('board-scene-mock');
    const shown = () => sceneMock.props!;
    expect(shown().board).toBe(before.game!.view.board);
    expect(shown().board.buildings[CITY]).toEqual({ player: 'p2', city: true });
    expect(shown().citiesKnights?.robberActive).toBe(false);
    expect(shown().citiesKnights?.knights[0]?.active).toBe(true);
    expect(shown().citiesKnights?.walls).toEqual([{ vertex: CITY, player: 'p2' }]);
    expect(shown().modules).toBe(before.game!.view.modules);

    rerender(board(tableReducer(held, { type: 'dice-presenting', value: false })));
    expect(shown().board).toBe(after.view.board);
    expect(shown().board.buildings[CITY]).toEqual({ player: 'p2', city: false });
    expect(shown().citiesKnights?.robberActive).toBe(true);
    expect(shown().citiesKnights?.knights[0]?.active).toBe(false);
    expect(shown().citiesKnights?.walls).toEqual([]);
    expect(shown().citiesKnights?.toppled).toEqual([CITY]);
  });
});

describe('arrivals while the board is held', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  type Step = { view: GameView; held: boolean };
  const snapshotOf = (view: GameView) => makeSnapshot(view, view.seq);
  function views() {
    const start = makeView({ events: [makeEvent(12, 'turn.started')] });
    const next = structuredClone(start);
    next.seq = 14;
    next.events.push(makeEvent(13, 'turn.rolled', { dice: [2, 6] }), makeEvent(14, 'build.road', { playerId: 'p2', edge: ROAD }));
    next.board.roads[ROAD] = { player: 'p2', ship: false };
    return { start, next };
  }

  it('starts a placement that landed during the hold only once the board is released', () => {
    const { start, next } = views();
    const { result, rerender } = renderHook(
      (input: Step) => useBoardAnimation(snapshotOf(input.view), { generation: 1, cause: 'snapshot' }, true, false, undefined, undefined, input.held),
      { initialProps: { view: start, held: false } as Step },
    );
    rerender({ view: next, held: true });
    expect(result.current.arrivals).toHaveLength(0);
    // 骰子演出比落下長：延後的落下不能在盤面放行前就逾時消失。
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS));
    expect(result.current.arrivals).toHaveLength(0);

    rerender({ view: next, held: false });
    expect(result.current.arrivals).toHaveLength(1);
    expect(result.current.arrivals[0]!.events.map((event) => event.type)).toEqual(['build.road']);
    act(() => vi.advanceTimersByTime(MAX_EFFECT_DURATION_MS));
    expect(result.current.arrivals).toHaveLength(0);

    // 再次凍結、放行不重播。
    rerender({ view: next, held: true });
    rerender({ view: next, held: false });
    expect(result.current.arrivals).toHaveLength(0);
  });

  it('plays placements at once when the board is not held', () => {
    const { start, next } = views();
    const { result, rerender } = renderHook(
      (input: Step) => useBoardAnimation(snapshotOf(input.view), { generation: 1, cause: 'snapshot' }, true, false, undefined, undefined, input.held),
      { initialProps: { view: start, held: false } as Step },
    );
    rerender({ view: next, held: false });
    expect(result.current.arrivals).toHaveLength(1);
  });

  it('drops deferred placements on a presentation reset instead of replaying them', () => {
    const { start, next } = views();
    const { result, rerender } = renderHook(
      (input: Step) => useBoardAnimation(snapshotOf(input.view), { generation: 1, cause: 'snapshot' }, true, false, undefined, undefined, input.held),
      { initialProps: { view: start, held: false } as Step },
    );
    rerender({ view: next, held: true });
    act(() => result.current.resetPresentation());
    rerender({ view: next, held: false });
    expect(result.current.arrivals).toHaveLength(0);
  });
});
