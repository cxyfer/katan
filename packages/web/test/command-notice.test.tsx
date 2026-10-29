import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandStatus } from '../src/components/CommandStatus.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import type { CommandStatus as Status } from '../src/state/commands.ts';

function controller(status: Status, commandId = 'first') {
  const state = initialTableState('en');
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
  it.each(['unknown', 'stale', 'rejected', 'submitting'] as const)('does not auto-dismiss %s', (status) => {
    vi.useFakeTimers();
    render(notice(controller(status)));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByTestId('command-status')).toBeTruthy();
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
