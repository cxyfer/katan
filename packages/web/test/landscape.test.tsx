import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RotatePrompt } from '../src/components/RotatePrompt.tsx';
import { useFullscreen } from '../src/components/useFullscreen.ts';
import { LocaleProvider } from '../src/i18n/context.tsx';

/** 依查詢字串決定 matches，模擬安裝狀態、指標與方向。 */
function mockMedia(matching: (query: string) => boolean) {
  vi.spyOn(globalThis, 'matchMedia').mockImplementation((query: string) => ({
    matches: matching(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as MediaQueryList);
}

const installedPortraitPhone = (query: string) =>
  query.includes('display-mode: standalone') || query.includes('orientation: portrait');

function renderPrompt() {
  return render(<LocaleProvider locale="en"><RotatePrompt /></LocaleProvider>);
}

describe('web app manifest', () => {
  it('opens installed apps standalone and in landscape without changing the app id', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/site.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', orientation: 'landscape' });
  });
});

describe('rotate prompt', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('asks an installed portrait phone to rotate and can be dismissed for the session', () => {
    mockMedia(installedPortraitPhone);
    const { unmount } = renderPrompt();
    const dialog = screen.getByTestId('rotate-prompt');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(screen.getByTestId('rotate-prompt-continue'));

    fireEvent.click(screen.getByTestId('rotate-prompt-continue'));
    expect(screen.queryByTestId('rotate-prompt')).toBeNull();
    unmount();
    renderPrompt();
    expect(screen.queryByTestId('rotate-prompt')).toBeNull();
  });

  it('stays hidden in a browser tab, in landscape, and on a non-touch window', () => {
    mockMedia((query) => query.includes('orientation: portrait'));
    const tab = renderPrompt();
    expect(screen.queryByTestId('rotate-prompt')).toBeNull();
    tab.unmount();

    mockMedia((query) => query.includes('display-mode: standalone'));
    renderPrompt();
    expect(screen.queryByTestId('rotate-prompt')).toBeNull();
  });

  it('treats iOS navigator.standalone as installed', () => {
    mockMedia((query) => query.includes('orientation: portrait'));
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    try {
      renderPrompt();
      expect(screen.getByTestId('rotate-prompt')).toBeTruthy();
    } finally {
      Reflect.deleteProperty(navigator, 'standalone');
    }
  });
});

describe('fullscreen orientation lock', () => {
  let lock: ReturnType<typeof vi.fn>;
  let target: HTMLDivElement;

  beforeEach(() => {
    target = document.createElement('div');
    target.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    lock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.screen, 'orientation', { configurable: true, value: { lock } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis.screen, 'orientation');
  });

  async function enterFullscreen() {
    const { result } = renderHook(() => useFullscreen({ current: target }));
    await act(() => result.current.toggle());
    return result;
  }

  it('locks landscape after entering fullscreen on a touch device', async () => {
    mockMedia((query) => query === '(pointer: coarse)');
    const result = await enterFullscreen();
    expect(target.requestFullscreen).toHaveBeenCalled();
    expect(lock).toHaveBeenCalledWith('landscape');
    expect(result.current.failed).toBe(false);
  });

  it('does not lock on a mouse-driven window', async () => {
    mockMedia(() => false);
    await enterFullscreen();
    expect(lock).not.toHaveBeenCalled();
  });

  it('keeps fullscreen working when the browser refuses the lock', async () => {
    mockMedia((query) => query === '(pointer: coarse)');
    lock.mockRejectedValue(new DOMException('needs fullscreen', 'NotSupportedError'));
    const result = await enterFullscreen();
    expect(lock).toHaveBeenCalled();
    expect(result.current.failed).toBe(false);
  });
});
