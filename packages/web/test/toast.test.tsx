import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../src/components/Toast.tsx';
import { NOTICE_EXIT_MS } from '../src/components/useTransientNotice.ts';
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

function countdown() {
  return screen.getByTestId('notice-countdown') as unknown as SVGElement;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe('transient toast', () => {
  it('shows the countdown around the close button and fades out on a click', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(toast(saved, null, onDismiss));
    expect(screen.getByTestId('toast').textContent).toContain('Room settings saved.');
    expect(screen.getByTestId('toast').dataset.tone).toBe('info');
    const ring = countdown();
    expect(ring.closest('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(ring.style.getPropertyValue('--notice-countdown')).toBe('6000ms');
    expect(ring.style.animationPlayState).toBe('running');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('toast').dataset.leaving).toBe('true');
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(NOTICE_EXIT_MS));
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('marks error notices with the error tone', () => {
    render(toast({ messageId: 'error.E_NOT_YOUR_TURN' }, null, vi.fn()));
    expect(screen.getByTestId('toast').dataset.tone).toBe('error');
  });

  it('fades out after six seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('toast').dataset.leaving).toBe('true');
    act(() => vi.advanceTimersByTime(NOTICE_EXIT_MS));
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('starts a new deadline when the same message appears again', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(5000));
    rerender(toast({ ...saved }, 'g1:1', onDismiss, 2));
    act(() => vi.advanceTimersByTime(1000 + NOTICE_EXIT_MS));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('a new toast that replaces a fading one stays and keeps its own deadline', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByTestId('toast').dataset.leaving).toBe('true');
    rerender(toast({ messageId: 'lobby.policySaved' }, 'g1:1', onDismiss, 2));
    act(() => vi.advanceTimersByTime(NOTICE_EXIT_MS));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('fades out a toast that belongs to the previous turn', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(toast(saved, 'g1:1', onDismiss));
    rerender(toast(saved, 'g1:2', onDismiss));
    expect(screen.getByTestId('toast').dataset.leaving).toBe('true');
    act(() => vi.advanceTimersByTime(NOTICE_EXIT_MS));
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps a toast that arrives together with the turn change', () => {
    vi.useFakeTimers();
    const { rerender } = render(toast(null, 'g1:1', vi.fn()));
    rerender(toast({ ...saved }, 'g1:2', vi.fn(), 2));
    act(() => vi.advanceTimersByTime(NOTICE_EXIT_MS));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
  });

  it('holds the remaining deadline while the pointer is over it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(3000));
    expect(countdown().dataset.paused).toBe('false');
    fireEvent.pointerEnter(screen.getByTestId('toast'));
    expect(countdown().dataset.paused).toBe('true');
    expect(countdown().style.animationPlayState).toBe('paused');
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    fireEvent.pointerLeave(screen.getByTestId('toast'));
    expect(countdown().dataset.paused).toBe('false');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    act(() => vi.advanceTimersByTime(1 + NOTICE_EXIT_MS));
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('holds the remaining deadline while the close control is focused', () => {
    vi.useFakeTimers();
    render(toast(saved, 'g1:1', vi.fn()));
    act(() => vi.advanceTimersByTime(3000));
    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.focus(close);
    expect(countdown().dataset.paused).toBe('true');
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    fireEvent.blur(close);
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('toast').dataset.leaving).toBe('true');
  });

  it('holds the deadline while the tab is hidden', () => {
    vi.useFakeTimers();
    render(toast(saved, 'g1:1', vi.fn()));
    act(() => vi.advanceTimersByTime(2000));
    act(() => setHidden(true));
    expect(countdown().dataset.paused).toBe('true');
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    act(() => setHidden(false));
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByTestId('toast').dataset.leaving).toBeUndefined();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('toast').dataset.leaving).toBe('true');
  });

  it('shows the same notice object again after the toast is cleared', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(toast(saved, 'g1:1', onDismiss));
    act(() => vi.advanceTimersByTime(6000 + NOTICE_EXIT_MS));
    expect(screen.queryByTestId('toast')).toBeNull();
    rerender(toast(null, 'g1:1', onDismiss, 2));
    rerender(toast(saved, 'g1:1', onDismiss, 3));
    expect(screen.getByTestId('toast')).toBeTruthy();
  });
});
