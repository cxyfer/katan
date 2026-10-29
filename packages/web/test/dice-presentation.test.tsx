import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_PRESENTATION_DURATION_MS, DICE_ROLL_DURATION_MS, diceRollPresentations } from '../src/board/animation.ts';
import { useBoardAnimation } from '../src/board/useBoardAnimation.ts';
import { DicePresentation } from '../src/components/DicePresentation.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { makeEvent, makeSnapshot, makeView } from '../src/test/fixtures.ts';
import type { GameSyncMetadata } from '../src/state/table.ts';

function props(seq = 12, cause: GameSyncMetadata['cause'] = 'snapshot', generation = 1) {
  const view = makeView({ events: [makeEvent(seq, 'turn.rolled', { dice: [2, 6], total: 8 })] });
  view.seq = seq;
  view.turn.dice = [2, 6];
  return { snapshot: makeSnapshot(view, seq), sync: { cause, generation }, online: true, mandatory: false };
}
function Harness(input: ReturnType<typeof props>) {
  const animation = useBoardAnimation(input.snapshot, input.sync, input.online, input.mandatory);
  return <LocaleProvider locale="en">
    <span data-testid="board-effect-active">{animation.active ? 'yes' : 'no'}</span>
    {animation.activeDice && <DicePresentation key={animation.activeDice.id} dice={animation.activeDice.dice} />}
  </LocaleProvider>;
}
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

function open() {
  return render(<Harness {...props()} />, { wrapper: StrictMode });
}

describe('centered dice presentation', () => {
  it('rolls for 1.5 seconds before revealing and announcing authoritative faces, then removes after a bounded hold', () => {
    const { rerender, unmount } = open();
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    rerender(<Harness {...props(13)} />);
    const panel = screen.getByTestId('dice-focus');
    expect(panel.getAttribute('data-phase')).toBe('rolling');
    expect(panel.textContent).not.toContain('2 + 6 = 8');
    expect(screen.getByTestId('dice-announcement').textContent).toBe('');
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByTestId('board-effect-active').textContent).toBe('no');
    expect(screen.getByTestId('dice-focus')).toBe(panel);
    rerender(<Harness {...props(13)} />);
    act(() => vi.advanceTimersByTime(DICE_ROLL_DURATION_MS - 801));
    expect(panel.getAttribute('data-phase')).toBe('rolling');
    act(() => vi.advanceTimersByTime(1));
    expect(panel.getAttribute('data-phase')).toBe('result');
    expect(screen.getByTestId('dice-announcement').textContent).toBe('Rolled 2 + 6 = 8');
    expect([...panel.querySelectorAll('.dice-presentation__die')].map((die) => die.textContent)).toEqual(['2', '6']);
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS - DICE_ROLL_DURATION_MS - 1));
    expect(screen.getByTestId('dice-focus')).toBe(panel);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    rerender(<Harness {...props(13)} />);
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['mandatory', 'offline', 'background', 'motion', 'reconnect', 'gap'] as const)(
    'cancels an unfinished roll for %s without revealing or replaying it on recovery', (reason) => {
      const { rerender, unmount } = open();
      rerender(<Harness {...props(13)} />);
      act(() => vi.advanceTimersByTime(1000));
      const interrupted = props(13);
      if (reason === 'mandatory') interrupted.mandatory = true;
      if (reason === 'offline') interrupted.online = false;
      if (reason === 'background') act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
      if (reason === 'motion') act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
      if (reason === 'reconnect' || reason === 'gap') interrupted.sync = { cause: reason, generation: 2 };
      rerender(<Harness {...interrupted} />);
      expect(screen.queryByTestId('dice-focus')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      act(() => {
        hidden = false;
        media.matches = false;
        document.dispatchEvent(new Event('visibilitychange'));
        media.dispatchEvent(new Event('change'));
      });
      const generation = interrupted.sync.generation;
      rerender(<Harness {...props(13, 'snapshot', generation)} />);
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByTestId('dice-focus')).toBeNull();
      rerender(<Harness {...props(14, 'snapshot', generation)} />);
      expect(screen.getByTestId('dice-focus').getAttribute('data-phase')).toBe('rolling');
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('presents two rolls from one event delta in order without revealing the next result early', () => {
    const { rerender, unmount } = open();
    const next = props(15);
    next.snapshot.view.events = [
      makeEvent(13, 'turn.rolled', { dice: [2, 6] }),
      makeEvent(14, 'production.resolved'),
      makeEvent(15, 'turn.rolled', { dice: [1, 1] }),
    ];
    next.snapshot.view.turn.dice = [1, 1];
    rerender(<Harness {...next} />);
    act(() => vi.advanceTimersByTime(DICE_ROLL_DURATION_MS));
    expect(screen.getByTestId('dice-announcement').textContent).toBe('Rolled 2 + 6 = 8');
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS - DICE_ROLL_DURATION_MS));
    expect(screen.getByTestId('dice-focus').getAttribute('data-phase')).toBe('rolling');
    expect(screen.getByTestId('dice-announcement').textContent).toBe('');
    act(() => vi.advanceTimersByTime(DICE_ROLL_DURATION_MS));
    expect(screen.getByTestId('dice-announcement').textContent).toBe('Rolled 1 + 1 = 2');
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS - DICE_ROLL_DURATION_MS));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops queued rolls at overflow and consumes only fresh events after the overflow', () => {
    const { rerender, unmount } = open();
    for (let seq = 13; seq <= 20; seq++) rerender(<Harness {...props(seq)} />);
    expect(screen.getByTestId('dice-focus')).toBeTruthy();
    rerender(<Harness {...props(21)} />);
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<Harness {...props(21)} />);
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    rerender(<Harness {...props(22)} />);
    expect(screen.getByTestId('dice-focus')).toBeTruthy();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not manufacture a result from missing or malformed authoritative dice', () => {
    const events = [undefined, [0, 6], [1, 7], [1.5, 3], [1], ['2', 4], [1, 2, 3]].map((dice, index) =>
      makeEvent(index + 1, 'turn.rolled', { dice }));
    expect(diceRollPresentations('g1', events)).toEqual([]);
    expect(diceRollPresentations('g1', [makeEvent(8, 'turn.rolled', { dice: [2, 5] })])).toEqual([
      { id: 'g1:8', seq: 8, dice: [2, 5] },
    ]);
  });
});
