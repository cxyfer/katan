import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { COMPACT_LANDSCAPE_QUERY } from '../src/components/useIsMobile.ts';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';

/** 只讓指定的查詢字串成立，其餘（含直屏、桌機）一律不成立；回傳可模擬 change 事件的控制器。 */
function mockMedia(matching: (query: string) => boolean) {
  let current = matching;
  const lists = new Map<string, { matches: boolean; listeners: Set<(event: MediaQueryListEvent) => void> }>();
  vi.spyOn(globalThis, 'matchMedia').mockImplementation((query: string) => {
    const entry = lists.get(query) ?? { matches: current(query), listeners: new Set() };
    lists.set(query, entry);
    return {
      get matches() { return entry.matches; },
      media: query,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => entry.listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => entry.listeners.delete(listener),
    } as unknown as MediaQueryList;
  });
  return {
    /** 例如旋轉裝置：重新評估每個查詢，對結果有變的清單送出 change。 */
    update(next: (query: string) => boolean) {
      current = next;
      for (const [query, entry] of lists) {
        const matches = next(query);
        if (matches === entry.matches) continue;
        entry.matches = matches;
        for (const listener of entry.listeners) listener({ matches, media: query } as MediaQueryListEvent);
      }
    },
  };
}

async function openStage() {
  render(<App services={{ api: createFakeApi(), storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  return screen.findByTestId('game-stage');
}

describe('compact landscape layout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('targets short, coarse-pointer landscape viewports only', () => {
    expect(COMPACT_LANDSCAPE_QUERY).toContain('(orientation: landscape)');
    expect(COMPACT_LANDSCAPE_QUERY).toContain('(max-height: 520px)');
    expect(COMPACT_LANDSCAPE_QUERY).toContain('(pointer: coarse)');
  });

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

  it('adds and removes the layout marker when the phone rotates', async () => {
    const media = mockMedia(() => false);
    const stage = await openStage();
    expect(stage.hasAttribute('data-layout')).toBe(false);
    act(() => media.update((query) => query === COMPACT_LANDSCAPE_QUERY));
    expect(stage.getAttribute('data-layout')).toBe('compact-landscape');
    act(() => media.update(() => false));
    expect(stage.hasAttribute('data-layout')).toBe(false);
  });

  it('docks the collapsed hand as the resource tally on phones only', async () => {
    const narrow = (query: string) => query === '(max-width: 649px)';
    const media = mockMedia(narrow);
    const stage = await openStage();
    expect(stage.getAttribute('data-hand-dock')).toBe('tally');
    expect(stage.hasAttribute('data-layout')).toBe(false);
    // 手機轉橫：窄螢幕查詢不再成立，改由 compact-landscape 標記。
    act(() => media.update((query) => query === COMPACT_LANDSCAPE_QUERY));
    expect(stage.getAttribute('data-layout')).toBe('compact-landscape');
    expect(stage.getAttribute('data-hand-dock')).toBe('tally');
    // 桌機與平板維持露出牌背的收合手牌。
    act(() => media.update(() => false));
    expect(stage.hasAttribute('data-hand-dock')).toBe(false);
  });

  it('keeps the connection state in the DOM in both layouts', async () => {
    const media = mockMedia((query) => query === COMPACT_LANDSCAPE_QUERY);
    const stage = await openStage();
    expect(stage.getAttribute('data-layout')).toBe('compact-landscape');
    expect(screen.getByTestId('connection-state')).toBeTruthy();
    act(() => media.update(() => false));
    expect(stage.hasAttribute('data-layout')).toBe(false);
    expect(screen.getByTestId('connection-state')).toBeTruthy();
  });
});
