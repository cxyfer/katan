import { StrictMode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_PRESENTATION_DURATION_MS, MAX_EFFECT_DURATION_MS } from '../src/board/animation.ts';
import { useBoardAnimation } from '../src/board/useBoardAnimation.ts';
import { TradePanel } from '../src/components/TradePanel.tsx';
import { initialTableState, shownHand, tableReducer, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeHints, makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

function base(): TableState {
  const view = makeView({ hints: makeHints() });
  view.seq = 12;
  view.events = [makeEvent(12, 'turn.started')];
  return { ...initialTableState('en', ''), session: makeIdentity(), game: makeSnapshot(view, 12) };
}

function rolledSnapshot(lumber: number) {
  const view = makeView({ hints: makeHints() });
  view.seq = 14;
  view.events = [makeEvent(13, 'turn.rolled', { dice: [3, 3], total: 6 }), makeEvent(14, 'production.resolved')];
  view.players[0]!.resources!.lumber = lumber;
  return makeSnapshot(view, 14);
}

describe('roll hold in the table state', () => {
  it('freezes the pre-roll hand from the first render of a rolled update until the dice settle', () => {
    let state = tableReducer(base(), { type: 'snapshot', snapshot: rolledSnapshot(9) });
    expect(state.dicePresenting).toBe(true);
    expect(state.heldHand?.lumber).toBe(2);
    expect(shownHand(state)?.lumber).toBe(2);

    // 演出期間的後續投影不改寫已凍結的擲骰前手牌。
    const later = rolledSnapshot(9);
    later.view.seq = 15;
    later.revision = 15;
    later.view.events = [...later.view.events, makeEvent(15, 'turn.rolled', { dice: [1, 2], total: 3 })];
    state = tableReducer(state, { type: 'snapshot', snapshot: later });
    expect(state.heldHand?.lumber).toBe(2);

    state = tableReducer(state, { type: 'dice-presenting', value: false });
    expect(state.heldHand).toBeNull();
    expect(shownHand(state)?.lumber).toBe(9);
  });

  it('also holds on an events-first roll and ignores updates without a new roll', () => {
    const events = tableReducer(base(), { type: 'events', events: [makeEvent(13, 'turn.rolled', { dice: [6, 6], total: 12 })] });
    expect(events.dicePresenting).toBe(true);
    expect(events.heldHand?.lumber).toBe(2);

    const quiet = makeSnapshot({ ...makeView({ hints: makeHints() }), seq: 13, events: [makeEvent(13, 'build.road')] }, 13);
    expect(tableReducer(base(), { type: 'snapshot', snapshot: quiet }).dicePresenting).toBe(false);
  });

  it('checks trade terms against the held hand while the dice are presenting', () => {
    const state: TableState = { ...tableReducer(base(), { type: 'snapshot', snapshot: rolledSnapshot(9) }) };
    const controller: TableController = { state, dispatch: vi.fn(), actions: {} as TableController['actions'] };
    render(<TradePanel controller={controller} />);
    expect(screen.getByTestId('give-owned-lumber').textContent).toBe('持有 2');
  });
});

describe('dice presentation flag', () => {
  let media: EventTarget & { matches: boolean };
  beforeEach(() => {
    vi.useFakeTimers();
    media = Object.assign(new EventTarget(), { matches: false });
    vi.spyOn(globalThis, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  });
  afterEach(() => vi.useRealTimers());

  it('stays presenting while a later roll waits behind an earlier roll’s effects', () => {
    const onDiceChange = vi.fn();
    const props = (seq: number, events = [makeEvent(seq, 'turn.rolled', { dice: [3, 4] })]) => ({
      snapshot: makeSnapshot({ ...makeView({ events }), seq }, seq),
      sync: { generation: 1, cause: 'snapshot' as const },
    });
    const { result, rerender, unmount } = renderHook(
      (input: ReturnType<typeof props>) => useBoardAnimation(input.snapshot, input.sync, true, false, onDiceChange),
      { initialProps: props(12), wrapper: StrictMode },
    );
    const latest = () => onDiceChange.mock.calls.at(-1)?.[0];
    expect(latest()).toBe(false);
    rerender(props(15, [
      makeEvent(13, 'turn.rolled', { dice: [2, 6] }),
      makeEvent(14, 'production.resolved'),
      makeEvent(15, 'turn.rolled', { dice: [1, 1] }),
    ]));
    expect(latest()).toBe(true);
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS));
    // 第一組特效播放、第二顆骰子排隊中：仍視為演出中。
    expect(result.current.activeDice).toBeNull();
    expect(result.current.active?.events[0]?.seq).toBe(13);
    expect(latest()).toBe(true);
    act(() => vi.advanceTimersByTime(MAX_EFFECT_DURATION_MS));
    expect(result.current.activeDice?.seq).toBe(15);
    expect(latest()).toBe(true);
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS));
    expect(latest()).toBe(false);
    unmount();
    expect(latest()).toBe(false);
  });

  it('corrects a provisional hold when no dice will be presented', () => {
    media.matches = true;
    const onDiceChange = vi.fn();
    const before = base().game;
    const snapshot = rolledSnapshot(9);
    const { rerender } = renderHook(
      (input: { seq: number }) => useBoardAnimation(input.seq === 12 ? before : snapshot, { generation: 1, cause: 'snapshot' }, true, false, onDiceChange),
      { initialProps: { seq: 12 } },
    );
    rerender({ seq: 14 });
    expect(onDiceChange.mock.calls.at(-1)?.[0]).toBe(false);
  });
});
