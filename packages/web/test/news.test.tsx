import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { SUPPORTED_LOCALES } from '../src/i18n/index.ts';
import { LATEST_PLAYER_NOTE, PLAYER_NOTES } from '../src/news/player-notes.ts';
import { memoryStorage, NEWS_SEEN_KEY, type StorageLike } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';

// vite.config.ts 從根目錄 package.json 注入，和 /healthz 回報的是同一個版號。
const rootVersion = __CATAN_VERSION__;

function parseStable(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`not a stable version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: string, b: string): number {
  const [x, y] = [parseStable(a), parseStable(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

describe('player notes contract', () => {
  it('lists stable versions newest first with ISO dates', () => {
    expect(PLAYER_NOTES.length).toBeGreaterThan(0);
    for (const note of PLAYER_NOTES) {
      expect(() => parseStable(note.version)).not.toThrow();
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${note.date}T00:00:00Z`))).toBe(false);
    }
    for (let i = 1; i < PLAYER_NOTES.length; i += 1) {
      const [newer, older] = [PLAYER_NOTES[i - 1]!, PLAYER_NOTES[i]!];
      expect(compare(newer.version, older.version), `${newer.version} before ${older.version}`).toBeGreaterThan(0);
      expect(newer.date >= older.date).toBe(true);
    }
    expect(LATEST_PLAYER_NOTE).toBe(PLAYER_NOTES[0]);
  });

  it('writes every title and item in every locale', () => {
    for (const note of PLAYER_NOTES) {
      expect(note.items.length, note.version).toBeGreaterThan(0);
      for (const text of [note.title, ...note.items]) {
        for (const locale of SUPPORTED_LOCALES) expect(text[locale]?.trim(), `${note.version} ${locale}`).toBeTruthy();
      }
      // 條目以英文當 React key，同一則內不可重複。
      expect(new Set(note.items.map((item) => item.en)).size).toBe(note.items.length);
    }
  });

  it('has a note for the stable version in package.json and none ahead of it', () => {
    // 預發布版本（-rc.N）可以先帶著即將發布的那一則，但不能超過它的基礎版號。
    const base = rootVersion.replace(/-.*$/, '');
    expect(compare(LATEST_PLAYER_NOTE!.version, base)).toBeLessThanOrEqual(0);
    if (base === rootVersion) {
      expect(PLAYER_NOTES.map((note) => note.version), `add a player note for ${rootVersion}`).toContain(rootVersion);
    }
  });
});

function renderHome(storage: StorageLike) {
  return render(
    <App services={{ api: createFakeApi(), storage, languages: ['en'], connectSocket: false }} />,
  );
}

describe('home notice board', () => {
  it('flags unseen notes and clears the flag once the board is opened', async () => {
    const storage = memoryStorage();
    renderHome(storage);
    const tab = await screen.findByRole('tab', { name: /notice board/i });
    expect(within(tab).getByTestId('news-unread').textContent).toBe('New');
    expect(tab.textContent).toContain(LATEST_PLAYER_NOTE!.title.en);

    fireEvent.click(tab);
    const panel = await screen.findByRole('tabpanel', { name: /notice board/i });
    expect(within(panel).getByTestId('news-version').textContent).toBe(`You are playing v${__CATAN_VERSION__}`);
    const entries = within(panel).getAllByRole('article');
    expect(entries).toHaveLength(PLAYER_NOTES.length);
    expect(within(entries[0]!).getByRole('heading', { level: 3 }).textContent).toBe(LATEST_PLAYER_NOTE!.title.en);

    expect(screen.queryByTestId('news-unread')).toBeNull();
    expect(storage.getItem(NEWS_SEEN_KEY)).toBe(LATEST_PLAYER_NOTE!.version);
  });

  it('stays quiet when the latest note was already seen', async () => {
    renderHome(memoryStorage({ [NEWS_SEEN_KEY]: LATEST_PLAYER_NOTE!.version }));
    await screen.findByRole('tab', { name: /notice board/i });
    expect(screen.queryByTestId('news-unread')).toBeNull();
  });

  it('renders the notes in Traditional Chinese', async () => {
    renderHome(memoryStorage());
    await screen.findByRole('tab', { name: /notice board/i });
    fireEvent.change(screen.getByTestId('locale-switch'), { target: { value: 'zh-Hant' } });
    fireEvent.click(await screen.findByRole('tab', { name: /公告牌/ }));
    const panel = await screen.findByRole('tabpanel', { name: /公告牌/ });
    expect(within(panel).getByText(LATEST_PLAYER_NOTE!.title['zh-Hant'])).toBeTruthy();
    expect(within(panel).getByText(LATEST_PLAYER_NOTE!.items[0]!['zh-Hant'])).toBeTruthy();
  });
});
