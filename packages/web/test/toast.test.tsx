import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../src/components/Toast.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import type { Notice } from '@catan/protocol';

const saved: Notice = { messageId: 'lobby.settingsSaved' };

function toast(notice: Notice | null, turnKey: string | null, onDismiss: () => void, toastId = 1) {
  return (
    <LocaleProvider locale="en">
      <Toast notice={notice} toastId={toastId} turnKey={turnKey} onDismiss={onDismiss} />
    </LocaleProvider>
  );
}

afterEach(() => vi.useRealTimers());

describe('transient toast', () => {
  it('renders the notice and still allows an immediate dismissal', () => {
    const onDismiss = vi.fn();
    render(toast(saved, null, onDismiss));
    expect(screen.getByTestId('toast').textContent).toContain('Room settings saved.');
    const progress = screen.getByTestId('notice-progress');
    expect(progress.getAttribute('aria-hidden')).toBe('true');
    expect((progress as HTMLElement).style.animationDuration).toBe('6000ms');
    expect((progress as HTMLElement).style.animationPlayState).toBe('running');
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
    rerender(toast({ ...saved }, 'g1:1', onDismiss, 2));
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
    rerender(toast({ ...saved }, 'g1:2', vi.fn(), 2));
    expect(screen.getByTestId('toast')).toBeTruthy();
  });

  it('holds the remaining deadline while the dismiss control is focused', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(3000));
    const progress = screen.getByTestId('notice-progress');
    expect(progress.getAttribute('data-paused')).toBe('false');
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByTestId('notice-progress').getAttribute('data-paused')).toBe('true');
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByTestId('toast')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByTestId('notice-progress').getAttribute('data-paused')).toBe('false');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId('toast')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows the same notice object again after the toast is cleared', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByTestId('toast')).toBeNull();
    rerender(toast(null, 'g1:1', onDismiss));
    rerender(toast(saved, 'g1:1', onDismiss));
    expect(screen.getByTestId('toast')).toBeTruthy();
  });
});
