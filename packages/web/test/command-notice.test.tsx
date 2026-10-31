import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandStatus } from '../src/components/CommandStatus.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import type { CommandStatus as Status } from '../src/state/commands.ts';
import { makeSnapshot, makeView } from '../src/test/fixtures.ts';

function controller(status: Status, commandId = 'first', windowId = 1) {
  const state = initialTableState('en');
  const view = makeView();
  view.windowId = windowId;
  state.game = makeSnapshot(view);
  state.command = { commandId, status, labelId: 'action.roll', command: { type: 'roll' }, error: null, baseRevision: 1, revision: 2 };
  return { state, actions: { clearCommand: vi.fn() } } as unknown as TableController;
}
function notice(value: TableController) {
  return <LocaleProvider locale="en"><CommandStatus controller={value} /></LocaleProvider>;
}
afterEach(() => vi.useRealTimers());
describe('side command receipt', () => {
  it('removes accepted feedback after four seconds without a dismiss button or clearing command state', () => {
    vi.useFakeTimers();
    const value = controller('accepted');
    render(notice(value));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    const progress = screen.getByTestId('notice-progress');
    expect((progress as HTMLElement).style.animationDuration).toBe('4000ms');
    expect(progress.className).toContain('notice-progress--accepted');
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('command-status')).toBeNull();
    expect(value.actions.clearCommand).not.toHaveBeenCalled();
  });
  it('gives each new accepted command its own timeout', () => {
    vi.useFakeTimers();
    const { rerender } = render(notice(controller('accepted')));
    act(() => vi.advanceTimersByTime(3000));
    rerender(notice(controller('accepted', 'second')));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByTestId('command-status')).toBeNull();
  });
  it('removes rejected feedback after eight seconds without clearing the retry path', () => {
    vi.useFakeTimers();
    const value = controller('rejected');
    render(notice(value));
    expect(screen.getByTestId('command-retry')).toBeTruthy();
    const progress = screen.getByTestId('notice-progress');
    expect((progress as HTMLElement).style.animationDuration).toBe('8000ms');
    expect(progress.className).toContain('notice-progress--rejected');
    act(() => vi.advanceTimersByTime(7999));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('command-status')).toBeNull();
    expect(value.actions.clearCommand).not.toHaveBeenCalled();
  });
  it('restarts the deadline after a focused retry control is replaced', () => {
    vi.useFakeTimers();
    const { rerender } = render(notice(controller('rejected', 'same')));
    fireEvent.focus(screen.getByTestId('command-retry'));
    rerender(notice(controller('submitting', 'same')));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    rerender(notice(controller('rejected', 'same')));
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.queryByTestId('command-status')).toBeNull();
  });

  it('holds rejected feedback while its retry control is focused', () => {
    vi.useFakeTimers();
    render(notice(controller('rejected')));
    act(() => vi.advanceTimersByTime(3000));
    const retry = screen.getByTestId('command-retry');
    fireEvent.focus(retry);
    expect(screen.getByTestId('notice-progress').getAttribute('data-paused')).toBe('true');
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    fireEvent.blur(retry);
    expect(screen.getByTestId('notice-progress').getAttribute('data-paused')).toBe('false');
    act(() => vi.advanceTimersByTime(4999));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('command-status')).toBeNull();
  });

  it('shows a rejected outcome that reuses a dismissed accepted command id', () => {
    vi.useFakeTimers();
    const { rerender } = render(notice(controller('accepted', 'same')));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByTestId('command-status')).toBeNull();
    rerender(notice(controller('rejected', 'same')));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    expect(screen.getByTestId('command-retry')).toBeTruthy();
  });
  it.each(['unknown', 'stale', 'submitting'] as const)('does not auto-dismiss %s', (status) => {
    vi.useFakeTimers();
    render(notice(controller(status)));
    expect(screen.queryByTestId('notice-progress')).toBeNull();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByTestId('command-status')).toBeTruthy();
  });
  it.each(['accepted', 'rejected'] as const)('clears %s feedback when the turn changes', (status) => {
    vi.useFakeTimers();
    const { rerender } = render(notice(controller(status, 'first', 1)));
    expect(screen.getByTestId('command-status')).toBeTruthy();
    rerender(notice(controller(status, 'first', 2)));
    expect(screen.queryByTestId('command-status')).toBeNull();
  });
  it('keeps unknown recovery across a turn change', () => {
    vi.useFakeTimers();
    const { rerender } = render(notice(controller('unknown', 'first', 1)));
    rerender(notice(controller('unknown', 'first', 2)));
    expect(screen.getByTestId('command-resolve')).toBeTruthy();
  });
  it('keeps a new receipt that arrives with a turn change', () => {
    vi.useFakeTimers();
    const { rerender } = render(notice(controller('accepted', 'first', 1)));
    rerender(notice(controller('accepted', 'second', 2)));
    expect(screen.getByTestId('command-status')).toBeTruthy();
  });
  it('clears a receipt when the same player starts a later turn', () => {
    vi.useFakeTimers();
    const { rerender } = render(notice(controller('rejected', 'first', 1)));
    rerender(notice(controller('rejected', 'first', 2)));
    rerender(notice(controller('rejected', 'first', 3)));
    expect(screen.queryByTestId('command-status')).toBeNull();
  });
  it('cancels an old receipt timer when another command needs recovery', () => {
    vi.useFakeTimers();
    const { rerender } = render(notice(controller('accepted')));
    act(() => vi.advanceTimersByTime(3000));
    rerender(notice(controller('unknown', 'second')));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByTestId('command-resolve')).toBeTruthy();
  });
});
