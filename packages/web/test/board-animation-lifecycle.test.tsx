import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardAnimation } from '../src/board/useBoardAnimation.ts';
import { makeEvent, makeSnapshot, makeView } from '../src/test/fixtures.ts';
import type { GameSyncMetadata } from '../src/state/table.ts';

function snapshot(seq: number) {
  return makeSnapshot({ ...makeView({ events: [makeEvent(seq, 'turn.rolled', { dice: [3, 4] })] }), seq }, seq);
}
const props = (seq = 12, cause: GameSyncMetadata['cause'] = 'snapshot', generation = 1) => ({
  snapshot: snapshot(seq), sync: { generation, cause }, online: true, mandatory: false,
});
function mount() {
  return renderHook((input) => useBoardAnimation(input.snapshot, input.sync, input.online, input.mandatory), {
    initialProps: props(), wrapper: StrictMode,
  });
}
let media: EventTarget & { matches: boolean };
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  media = Object.assign(new EventTarget(), { matches: false });
  hidden = false;
  vi.spyOn(globalThis, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => vi.useRealTimers());

describe('board animation lifecycle (E07–E09, A01)', () => {
  it('plays a new snapshot once for at most 800ms, without restarting on unrelated renders', () => {
    const { result, rerender, unmount } = mount();
    expect(result.current.active).toBeNull();
    rerender(props(13));
    const group = result.current.active;
    expect(group?.events[0]?.seq).toBe(13);
    act(() => vi.advanceTimersByTime(400));
    rerender(props(13));
    expect(result.current.active).toBe(group);
    act(() => vi.advanceTimersByTime(399));
    expect(result.current.active).toBe(group);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.active).toBeNull();
    rerender(props(13));
    expect(result.current.active).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds active plus pending work to eight, drops overflow and accepts the next new event', () => {
    const { result, rerender, unmount } = mount();
    for (let seq = 13; seq <= 20; seq++) rerender(props(seq));
    expect(result.current.pendingCount).toBe(8);
    rerender(props(21));
    expect(result.current.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    rerender(props(22));
    expect(result.current.active?.events[0]?.seq).toBe(22);
    unmount();
  });

  it('plays both new rolls in a continuous snapshot delta without extending either group deadline', () => {
    const { result, rerender, unmount } = mount();
    const next = props(15);
    next.snapshot.view.events = [makeEvent(13, 'turn.rolled'), makeEvent(14, 'production.resolved'), makeEvent(15, 'turn.rolled')];
    rerender(next);
    expect(result.current.pendingCount).toBe(2);
    expect(result.current.active?.events.map((event) => event.seq)).toEqual([13, 14]);
    act(() => vi.advanceTimersByTime(400));
    rerender(props(16));
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.active?.events[0]?.seq).toBe(15);
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.active?.events[0]?.seq).toBe(16);
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.active).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('cancels immediately for mandatory actions, offline / reconnect and event gaps', () => {
    const { result, rerender, unmount } = mount();
    rerender(props(13));
    rerender({ ...props(13), mandatory: true });
    expect(result.current.active).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    rerender(props(13));
    expect(result.current.active).toBeNull();
    rerender(props(14));
    expect(result.current.active).toBeTruthy();
    rerender({ ...props(14), online: false });
    expect(result.current.active).toBeNull();
    rerender(props(50, 'reconnect', 2));
    expect(result.current.active).toBeNull();
    rerender(props(51, 'snapshot', 2));
    expect(result.current.active).toBeTruthy();
    rerender(props(60, 'gap', 3));
    expect(result.current.active).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('rebases when hidden and on returning, including data received while hidden', () => {
    const { result, rerender, unmount } = mount();
    rerender(props(13));
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    expect(vi.getTimerCount()).toBe(0);
    rerender(props(14));
    expect(result.current.active).toBeNull();
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    rerender(props(14));
    expect(result.current.active).toBeNull();
    rerender(props(15));
    expect(result.current.active?.events[0]?.seq).toBe(15);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not replay a retained legacy event log after background recovery or remount', () => {
    const legacy = (seq: number) => {
      const input = props(seq, 'events');
      input.snapshot.view.seq = 12;
      input.snapshot.view.events = Array.from({ length: seq - 12 }, (_, index) => makeEvent(index + 13, 'turn.rolled'));
      return input;
    };
    const first = mount();
    first.rerender(legacy(13));
    expect(first.result.current.active?.events[0]?.seq).toBe(13);
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    first.rerender(legacy(14));
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    first.rerender(legacy(15));
    expect(first.result.current.active?.events.map((event) => event.seq)).toEqual([15]);
    first.unmount();
    const second = renderHook((input) => useBoardAnimation(input.snapshot, input.sync, true, false), { initialProps: legacy(15), wrapper: StrictMode });
    expect(second.result.current.active).toBeNull();
    second.rerender(legacy(16));
    expect(second.result.current.active?.events.map((event) => event.seq)).toEqual([16]);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours initial and changing reduced motion and removes its exact listeners on unmount', () => {
    media.matches = true;
    const addMedia = vi.spyOn(media, 'addEventListener');
    const removeMedia = vi.spyOn(media, 'removeEventListener');
    const addDocument = vi.spyOn(document, 'addEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const { result, rerender, unmount } = mount();
    rerender(props(13));
    expect(result.current.active).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
    rerender(props(13));
    expect(result.current.active).toBeNull();
    rerender(props(14));
    expect(result.current.active).toBeTruthy();
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(result.current.active).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    for (const args of addMedia.mock.calls) expect(removeMedia.mock.calls).toContainEqual(args);
    for (const args of addDocument.mock.calls.filter(([type]) => type === 'visibilitychange')) expect(removeDocument.mock.calls).toContainEqual(args);
  });

  it('discards timers and history on unmount / remount, also in StrictMode', () => {
    const first = mount();
    first.rerender(props(13));
    expect(vi.getTimerCount()).toBe(1);
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const second = renderHook(() => useBoardAnimation(snapshot(13), props().sync, true, false), { wrapper: StrictMode });
    expect(second.result.current.active).toBeNull();
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
