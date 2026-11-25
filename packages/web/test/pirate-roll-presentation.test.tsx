/**
 * 海盜巢穴（S7b）：擲骰造成的待答（贏海盜的選牌、7 的偷牌）不能取消骰子演出，
 * 否則骰子被略過、海盜直接跳到新位置（透露較小的骰值）。其他劇本的待答行為不變（D7）。
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_PRESENTATION_DURATION_MS } from '../src/board/animation.ts';
import { useBoardAnimation } from '../src/board/useBoardAnimation.ts';
import { makeEvent, makeSnapshot, makeView } from '../src/test/fixtures.ts';
import type { PublicPendingView } from '@katan/rules';

function snapshotWith(seq: number, dice: [number, number], pending: unknown) {
  const view = makeView({ events: [makeEvent(seq, 'turn.rolled', { dice, total: dice[0] + dice[1] })] });
  view.seq = seq;
  view.pending = pending as PublicPendingView;
  return makeSnapshot(view, seq);
}
const input = (seq: number, dice: [number, number], pending: unknown) => ({
  snapshot: snapshotWith(seq, dice, pending), sync: { generation: 1, cause: 'snapshot' as const }, online: true, mandatory: true,
});
const mount = () => renderHook((props) => useBoardAnimation(props.snapshot, props.sync, props.online, props.mandatory), {
  initialProps: input(12, [3, 4], null),
});

let media: EventTarget & { matches: boolean };
beforeEach(() => {
  vi.useFakeTimers();
  media = Object.assign(new EventTarget(), { matches: false });
  vi.spyOn(globalThis, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
});
afterEach(() => vi.useRealTimers());

const frame = (kind: string, data: Record<string, unknown>) => ({ kind, module: 'seafarers', responders: ['p1'], data });

describe('rolls that open a pirate answer keep their dice presentation', () => {
  it.each([
    ['seven steal after 2 + 5 (nobody over 7 cards, a victim exists)', [2, 5] as [number, number], frame('seafarers.sevenSteal', { victims: ['p2'], fromRoll: true })],
    ['pirate gift after 2 + 2 (not a 7)', [2, 2] as [number, number], frame('seafarers.pirateGift', { strength: 2, fromRoll: true })],
  ])('%s', (_name, dice, pending) => {
    const { result, rerender } = mount();
    rerender(input(13, dice, pending));
    expect(result.current.activeDice?.seq).toBe(13);
    expect(result.current.activeDice?.dice).toEqual(dice);
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS));
    expect(result.current.activeDice).toBeNull();
  });

  it('other module answers still give way to the required action (D7)', () => {
    const { result, rerender } = mount();
    rerender(input(13, [2, 5], frame('seafarers.gold', { picks: { p1: 1 } })));
    expect(result.current.activeDice).toBeNull();
    rerender(input(14, [2, 2], frame('seafarers.pirateGift', { strength: 2 })));
    expect(result.current.activeDice).toBeNull();
  });
});
