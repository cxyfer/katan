import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../src/components/Toast.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import type { Notice } from '@catan/protocol';

const saved: Notice = { messageId: 'lobby.settingsSaved' };

function toast(notice: Notice | null, turnKey: string | null, onDismiss: () => void) {
  return (
    <LocaleProvider locale="en">
      <Toast notice={notice} turnKey={turnKey} onDismiss={onDismiss} />
    </LocaleProvider>
  );
}

afterEach(() => vi.useRealTimers());

describe('transient toast', () => {
  it('renders the notice and still allows an immediate dismissal', () => {
    const onDismiss = vi.fn();
    render(toast(saved, null, onDismiss));
    expect(screen.getByTestId('toast').textContent).toContain('Room settings saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses itself after six seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByTestId('toast')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('starts a new deadline when the same message appears again', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(5000));
    rerender(toast({ ...saved }, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('toast')).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('dismisses a toast that belongs to the previous turn', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(toast(saved, 'g1:1', onDismiss));
    expect(screen.getByTestId('toast')).toBeTruthy();
    rerender(toast(saved, 'g1:2', onDismiss));
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps a toast that arrives together with the turn change', () => {
    vi.useFakeTimers();
    const { rerender } = render(toast(null, 'g1:1', vi.fn()));
    rerender(toast({ ...saved }, 'g1:2', vi.fn()));
    expect(screen.getByTestId('toast')).toBeTruthy();
  });
});
