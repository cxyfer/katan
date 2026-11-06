import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { SUPPORTED_LOCALES } from '../src/i18n/index.ts';
import { compareStableVersions, isNoteUnread, notesForVersion, PLAYER_NOTES, type PlayerNote } from '../src/news/player-notes.ts';
import { memoryStorage, NEWS_SEEN_KEY, type StorageLike } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';

// vite.config.ts 從根目錄 package.json 注入，和 /healthz 回報的是同一個版號。
const rootVersion = __CATAN_VERSION__;
// 首頁實際顯示的紀錄與最新一則。
const SHOWN = notesForVersion(rootVersion);
const LATEST_PLAYER_NOTE = SHOWN[0];

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

  it('has a note for the stable version in package.json', () => {
    // 下一版的紀錄可以先合入（超前的會被隱藏），但正式版號 bump 時必須已有自己的那一則。
    if (/^\d+\.\d+\.\d+$/.test(rootVersion)) {
      expect(PLAYER_NOTES.map((note) => note.version), `add a player note for ${rootVersion}`).toContain(rootVersion);
      expect(LATEST_PLAYER_NOTE!.version).toBe(rootVersion);
    }
    expect(SHOWN.length).toBeGreaterThan(0);
  });

});

const note = (version: string): PlayerNote => ({ version, date: '2026-01-01', title: { en: 'x', 'zh-Hant': 'x' }, items: [] });

describe('notes shown for a version', () => {
  const notes = [note('0.5.0'), note('0.4.0'), note('0.3.0')];
  const versions = (shown: readonly PlayerNote[]) => shown.map((entry) => entry.version);

  it('hides a note that landed ahead of the version bump', () => {
    // 0.5.0 的紀錄已合入 master，但 package.json 仍是 0.4.0。
    expect(versions(notesForVersion('0.4.0', notes))).toEqual(['0.4.0', '0.3.0']);
  });

  it('shows the upcoming note on its release candidates and after the bump', () => {
    expect(versions(notesForVersion('0.5.0-rc.1', notes))).toEqual(['0.5.0', '0.4.0', '0.3.0']);
    expect(versions(notesForVersion('0.5.0', notes))).toEqual(['0.5.0', '0.4.0', '0.3.0']);
  });

  it('shows every note when the version cannot be parsed', () => {
    expect(versions(notesForVersion('dev', notes))).toEqual(['0.5.0', '0.4.0', '0.3.0']);
  });
});

describe('seen-version watermark', () => {

  it('compares stable versions numerically and rejects anything else', () => {
    expect(compareStableVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareStableVersions('0.4.0', '0.4.0')).toBe(0);
    expect(compareStableVersions('0.4.0', '1.0.0')).toBeLessThan(0);
    expect(compareStableVersions('0.5.0-rc.1', '0.4.0')).toBeNull();
    expect(compareStableVersions('garbage', '0.4.0')).toBeNull();
  });

  it('flags only a note newer than the stored version', () => {
    expect(isNoteUnread(note('0.4.0'), null)).toBe(true);
    expect(isNoteUnread(note('0.4.0'), '0.3.0')).toBe(true);
    expect(isNoteUnread(note('0.4.0'), '0.4.0')).toBe(false);
    // 站台回滾：看過 0.5.0 的玩家不會把 0.4.0 當成新公告。
    expect(isNoteUnread(note('0.4.0'), '0.5.0')).toBe(false);
    expect(isNoteUnread(note('0.4.0'), 'corrupt')).toBe(true);
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
    expect(entries).toHaveLength(SHOWN.length);
    expect(within(entries[0]!).getByRole('heading', { level: 3 }).textContent).toBe(LATEST_PLAYER_NOTE!.title.en);

    expect(screen.queryByTestId('news-unread')).toBeNull();
    expect(storage.getItem(NEWS_SEEN_KEY)).toBe(LATEST_PLAYER_NOTE!.version);
  });

  it('stays quiet when the latest note was already seen', async () => {
    renderHome(memoryStorage({ [NEWS_SEEN_KEY]: LATEST_PLAYER_NOTE!.version }));
    await screen.findByRole('tab', { name: /notice board/i });
    expect(screen.queryByTestId('news-unread')).toBeNull();
  });

  it('keeps a newer seen version after a rollback instead of rewinding it', async () => {
    const [major, minor] = LATEST_PLAYER_NOTE!.version.split('.').map(Number);
    const future = `${major}.${minor! + 1}.0`;
    const storage = memoryStorage({ [NEWS_SEEN_KEY]: future });
    renderHome(storage);
    fireEvent.click(await screen.findByRole('tab', { name: /notice board/i }));
    await screen.findByRole('tabpanel', { name: /notice board/i });
    expect(screen.queryByTestId('news-unread')).toBeNull();
    expect(storage.getItem(NEWS_SEEN_KEY)).toBe(future);
  });

  it('renders the notes in Traditional Chinese', async () => {
    renderHome(memoryStorage());
    await screen.findByRole('tab', { name: /notice board/i });
    fireEvent.change(screen.getByTestId('locale-switch'), { target: { value: 'zh-Hant' } });
    fireEvent.click(await screen.findByRole('tab', { name: /公告牌/ }));
    const panel = await screen.findByRole('tabpanel', { name: /公告牌/ });
    const latest = within(panel).getAllByRole('article')[0]!;
    expect(within(latest).getByRole('heading', { level: 3 }).textContent).toBe(LATEST_PLAYER_NOTE!.title['zh-Hant']);
    expect(within(latest).getAllByRole('listitem')[0]!.textContent).toBe(LATEST_PLAYER_NOTE!.items[0]!['zh-Hant']);
  });
});
