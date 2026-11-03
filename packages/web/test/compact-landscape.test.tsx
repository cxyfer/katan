import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { COMPACT_LANDSCAPE_QUERY } from '../src/components/useIsMobile.ts';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';

/** 只讓指定的查詢字串成立，其餘（含直屏、桌機）一律不成立。 */
function mockMedia(matching: (query: string) => boolean) {
  vi.spyOn(globalThis, 'matchMedia').mockImplementation((query: string) => ({
    matches: matching(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as MediaQueryList);
}

async function openStage() {
  render(<App services={{ api: createFakeApi(), storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  return screen.findByTestId('game-stage');
}

describe('compact landscape layout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('marks the table only when the short, coarse-pointer landscape query matches', async () => {
    mockMedia((query) => query === COMPACT_LANDSCAPE_QUERY);
    const stage = await openStage();
    expect(stage.getAttribute('data-layout')).toBe('compact-landscape');
  });

  it('leaves desktop, tablet and portrait tables without a layout marker', async () => {
    mockMedia((query) => query !== COMPACT_LANDSCAPE_QUERY);
    const stage = await openStage();
    expect(stage.hasAttribute('data-layout')).toBe(false);
  });

  it('keeps the connection state in the DOM in both layouts', async () => {
    mockMedia((query) => query === COMPACT_LANDSCAPE_QUERY);
    await openStage();
    expect(screen.getByTestId('connection-state')).toBeTruthy();
  });
});
