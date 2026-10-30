import { StrictMode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandPanel } from '../src/components/HandPanel.tsx';
import { MAX_HAND_GAIN_CARDS, useHandGains } from '../src/components/useHandGains.ts';
import { initialTableState, type GameSyncMetadata } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

function props(seq = 12, lumber = 2, cause: GameSyncMetadata['cause'] = 'snapshot', generation = 1) {
  const view = makeView({ events: [makeEvent(seq, 'production.resolved')] });
  view.seq = seq;
  view.players[0]!.resources!.lumber = lumber;
  view.players[0]!.handSize = lumber + 8;
  return { snapshot: makeSnapshot(view, seq), sync: { cause, generation }, playerId: 'p1', online: true, syncPending: false };
}
type Input = ReturnType<typeof props>;
const useGains = (input: Input) => useHandGains(input.snapshot, input.sync, input.playerId, input.online, input.syncPending);
const mount = () => renderHook(useGains, { initialProps: props(), wrapper: StrictMode });
let media: EventTarget & { matches: boolean };
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  media = Object.assign(new EventTarget(), { matches: false });
  vi.spyOn(globalThis, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => vi.useRealTimers());

describe('own resource cards descending into the hand', () => {
  it('only animates positive authoritative deltas, once, without delaying the hand count', async () => {
    const controller = (input: Input): TableController => ({
      state: { ...initialTableState('en', ''), game: input.snapshot, gameSync: input.sync, session: makeIdentity() },
      actions: {} as TableController['actions'], dispatch: vi.fn(),
    });
    const { rerender } = render(<HandPanel controller={controller(props())} />, { wrapper: StrictMode });
    expect(screen.queryByTestId('hand-gains')).toBeNull();
    rerender(<HandPanel controller={controller(props(13, 4))} />);
    expect(screen.getByTestId('resource-lumber').querySelector('.resource-tally__count')!.textContent).toBe('4');
    const overlay = screen.getByTestId('hand-gains');
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.querySelectorAll('.hand-gain--lumber .resource-card-art')).toHaveLength(2);
    expect(overlay.querySelector('button')).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    rerender(<HandPanel controller={controller(props(13, 4))} />);
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(screen.queryByTestId('hand-gains')).toBeNull();
    rerender(<HandPanel controller={controller(props(13, 4))} />);
    expect(screen.queryByTestId('hand-gains')).toBeNull();
    rerender(<HandPanel controller={controller(props(14, 1))} />);
    expect(screen.queryByTestId('hand-gains')).toBeNull();
    expect(screen.getByTestId('resource-lumber').querySelector('.resource-tally__count')!.textContent).toBe('1');
  });

  it('waits for the dice presentation before dropping rolled resources, and holds the count meanwhile', () => {
    const rolled = (seq: number, lumber: number) => {
      const input = props(seq, lumber);
      input.snapshot.view.events = [makeEvent(seq - 1, 'turn.rolled', { dice: [3, 3], total: 6 }), makeEvent(seq, 'production.resolved')];
      return input;
    };
    type HeldInput = Input & { held: boolean };
    const { result, rerender } = renderHook(
      (input: HeldInput) => useHandGains(input.snapshot, input.sync, input.playerId, input.online, input.syncPending, input.held),
      { initialProps: { ...props(), held: false }, wrapper: StrictMode },
    );
    const next = rolled(14, 4);
    rerender({ ...next, held: true });
    // 演出期間（含排隊中的骰子）不論多久都不開始落下。
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toEqual([]);
    rerender({ ...next, held: false });
    expect(result.current.map((gain) => [gain.resource, gain.delayMs])).toEqual([['lumber', 0], ['lumber', 45]]);
    act(() => vi.advanceTimersByTime(900));
    expect(result.current).toEqual([]);

    // 手牌數字在演出期間顯示擲骰前的完整數量，不受裝飾卡上限影響。
    const controller = (input: Input, dicePresenting: boolean): TableController => ({
      state: {
        ...initialTableState('en', ''), game: input.snapshot, gameSync: input.sync, session: makeIdentity(), dicePresenting,
        rollHold: dicePresenting ? { hand: { lumber: 2, brick: 2, wool: 2, grain: 2, ore: 2 }, handSizes: {}, eventSeq: 12 } : null,
      },
      actions: {} as TableController['actions'], dispatch: vi.fn(),
    });
    const big = rolled(14, 14);
    const panel = render(<HandPanel controller={controller(props(), false)} />);
    panel.rerender(<HandPanel controller={controller(big, true)} />);
    const count = () => screen.getByTestId('resource-lumber').querySelector('.resource-tally__count')!.textContent;
    expect(count()).toBe('2');
    panel.rerender(<HandPanel controller={controller(big, false)} />);
    expect(count()).toBe('14');
  });

  it('does not infer gains from opponent hand counts or private-looking opponent data', () => {
    const { result, rerender } = mount();
    const next = props(13);
    next.snapshot.view.players[1]!.resources = { lumber: 99, brick: 99, wool: 99, grain: 99, ore: 99 };
    next.snapshot.view.players[1]!.handSize = 495;
    rerender(next);
    expect(result.current).toEqual([]);
  });

  it('retains the resource baseline until an events-first update reaches the authoritative projection', () => {
    const { result, rerender } = mount();
    const legacy = props(12, 2, 'events');
    legacy.snapshot.view.events = [makeEvent(13, 'production.resolved')];
    legacy.snapshot.revision = 13;
    rerender(legacy);
    expect(result.current).toEqual([]);
    rerender(props(13, 3));
    expect(result.current.map((gain) => gain.resource)).toEqual(['lumber']);
  });

  it.each(['hidden', 'motion', 'resize', 'fullscreen'] as const)(
    'does not replay an unprojected legacy gain after %s cancellation or include it in the next gain', (reason) => {
      const { result, rerender } = mount();
      if (reason === 'hidden') act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
      if (reason === 'motion') act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
      const legacy = props(12, 2, 'events');
      legacy.snapshot.revision = 13;
      legacy.snapshot.view.events = [makeEvent(13, 'production.resolved')];
      rerender(legacy);
      if (reason === 'hidden') act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      if (reason === 'motion') act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
      if (reason === 'resize') act(() => window.dispatchEvent(new Event('resize')));
      if (reason === 'fullscreen') act(() => document.dispatchEvent(new Event('fullscreenchange')));
      rerender(props(13, 3));
      expect(result.current).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      rerender(props(14, 4));
      expect(result.current.map((gain) => gain.resource)).toEqual(['lumber']);
    },
  );

  it('rebases resource counts when one projection spans both suppressed and fresh events', () => {
    const { result, rerender } = mount();
    const legacy = props(12, 2, 'events');
    legacy.snapshot.revision = 13;
    legacy.snapshot.view.events = [makeEvent(13, 'production.resolved')];
    rerender(legacy);
    act(() => window.dispatchEvent(new Event('resize')));
    const combined = props(14, 4);
    combined.snapshot.view.events = [makeEvent(13, 'production.resolved'), makeEvent(14, 'production.resolved')];
    rerender(combined);
    expect(result.current).toEqual([]);
    rerender(props(15, 5));
    expect(result.current.map((gain) => gain.resource)).toEqual(['lumber']);
  });

  it('consumes the resource baseline when a remounted legacy projection catches up', () => {
    const legacy = props(12, 2, 'events');
    legacy.snapshot.revision = 13;
    legacy.snapshot.view.events = [makeEvent(13, 'production.resolved')];
    const { result, rerender } = renderHook(useGains, { initialProps: legacy, wrapper: StrictMode });
    rerender(props(13, 3));
    expect(result.current).toEqual([]);
    rerender(props(14, 4));
    expect(result.current.map((gain) => gain.resource)).toEqual(['lumber']);
  });

  it.each(['open', 'resume', 'reconnect', 'gap'] as const)('rebases %s boundaries, then accepts the next continuous gain', (cause) => {
    const { result, rerender } = mount();
    rerender(props(13, 3));
    expect(result.current).toHaveLength(1);
    rerender(props(30, 20, cause, 2));
    expect(result.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    rerender(props(31, 21, 'snapshot', 2));
    expect(result.current).toHaveLength(1);
  });

  it('does not replay gaps, missing private data, game/session switches or remounts', () => {
    const first = mount();
    first.rerender(props(20, 20));
    expect(first.result.current).toEqual([]);
    const missing = props(21, 21);
    missing.snapshot.view.players[0]!.resources = undefined;
    first.rerender(missing);
    first.rerender(props(22, 22));
    expect(first.result.current).toEqual([]);
    const otherGame = props(23, 23);
    otherGame.snapshot.gameId = 'g2';
    first.rerender(otherGame);
    expect(first.result.current).toEqual([]);
    first.rerender({ ...props(24, 24), playerId: 'p2' });
    first.rerender(props(25, 25));
    expect(first.result.current).toEqual([]);
    first.unmount();
    const second = renderHook(useGains, { initialProps: props(25, 25), wrapper: StrictMode });
    expect(second.result.current).toEqual([]);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds concurrent gains and removes each burst at its own deadline, including unmount cleanup', async () => {
    const { result, rerender, unmount } = mount();
    const many = props(13, 100);
    many.snapshot.view.players[0]!.resources!.ore = 100;
    rerender(many);
    expect(result.current).toHaveLength(8);
    expect(new Set(result.current.map((gain) => gain.resource))).toEqual(new Set(['lumber', 'ore']));
    act(() => vi.advanceTimersByTime(300));
    rerender(props(14, 200));
    expect(result.current).toHaveLength(MAX_HAND_GAIN_CARDS);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(850));
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.every((gain) => gain.id.includes(':14:'))).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(result.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    rerender(props(15, 201));
    expect(result.current).toHaveLength(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['offline', 'pending', 'hidden', 'motion'] as const)('cancels and rebases when %s, without recovery replay', (reason) => {
    const { result, rerender } = mount();
    rerender(props(13, 3));
    expect(result.current).toHaveLength(1);
    const interrupted = props(14, 4);
    if (reason === 'offline') interrupted.online = false;
    if (reason === 'pending') interrupted.syncPending = true;
    if (reason === 'hidden') act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    if (reason === 'motion') act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
    rerender(interrupted);
    expect(result.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    if (reason === 'hidden') act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    if (reason === 'motion') act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
    rerender(props(14, 4));
    expect(result.current).toEqual([]);
    rerender(props(15, 5));
    expect(result.current).toHaveLength(1);
  });

  it.each(['resize', 'fullscreenchange'] as const)('cancels stale card positions on %s and accepts the next gain', (event) => {
    const { result, rerender } = mount();
    rerender(props(13, 3));
    expect(result.current).toHaveLength(1);
    act(() => (event === 'resize' ? window : document).dispatchEvent(new Event(event)));
    expect(result.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    rerender(props(13, 3));
    expect(result.current).toEqual([]);
    rerender(props(14, 4));
    expect(result.current).toHaveLength(1);
  });

  it('keeps the descending cards inside fullscreen and suppresses a hidden mounted hand', () => {
    const controller = (input: Input): TableController => ({
      state: { ...initialTableState('en', ''), game: input.snapshot, gameSync: input.sync, session: makeIdentity() },
      actions: {} as TableController['actions'], dispatch: vi.fn(),
    });
    const fullscreen = document.createElement('div');
    document.body.append(fullscreen);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
    const { rerender, unmount } = render(<div hidden><HandPanel controller={controller(props())} /></div>);
    rerender(<div hidden><HandPanel controller={controller(props(13, 3))} /></div>);
    expect(screen.queryByTestId('hand-gains')).toBeNull();
    rerender(<div><HandPanel controller={controller(props(14, 4))} /></div>);
    expect(screen.getByTestId('hand-gains').parentElement).toBe(fullscreen);
    unmount();
    fullscreen.remove();
    Reflect.deleteProperty(document, 'fullscreenElement');
  });

  it('honors initial reduced motion and removes exact motion/visibility listeners', () => {
    media.matches = true;
    const addMedia = vi.spyOn(media, 'addEventListener');
    const removeMedia = vi.spyOn(media, 'removeEventListener');
    const addDocument = vi.spyOn(document, 'addEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const { result, rerender, unmount } = mount();
    rerender(props(13, 20));
    expect(result.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    for (const args of addMedia.mock.calls) expect(removeMedia.mock.calls).toContainEqual(args);
    for (const args of addDocument.mock.calls.filter(([type]) => type === 'visibilitychange')) expect(removeDocument.mock.calls).toContainEqual(args);
  });

  it('drops the inspected or focused card cleanly when the hand shrinks, and only pops a tally count that changed', () => {
    const controller = (input: Input): TableController => ({
      state: { ...initialTableState('en', ''), game: input.snapshot, gameSync: input.sync, session: makeIdentity() },
      actions: {} as TableController['actions'], dispatch: vi.fn(),
    });
    const { rerender } = render(<HandPanel controller={controller(props(12, 3))} />);
    expect(document.querySelector('.resource-tally__count--bump')).toBeNull();
    const third = screen.getByTestId('resource-card-lumber-2').querySelector('button')!;
    act(() => third.focus());
    act(() => third.click());
    expect(third.getAttribute('aria-pressed')).toBe('true');
    rerender(<HandPanel controller={controller(props(13, 2))} />);
    expect(screen.queryByTestId('resource-card-lumber-2')).toBeNull();
    expect(screen.getByTestId('hand-panel').contains(document.activeElement)).toBe(true);
    expect(screen.getByTestId('resource-lumber').querySelector('.resource-tally__count--bump')).toBeTruthy();
    expect(screen.getByTestId('resource-brick').querySelector('.resource-tally__count--bump')).toBeNull();
    rerender(<HandPanel controller={controller(props(14, 3))} />);
    expect(screen.getByTestId('resource-card-lumber-2').querySelector('button')!.getAttribute('aria-pressed')).toBe('false');
  });
});
