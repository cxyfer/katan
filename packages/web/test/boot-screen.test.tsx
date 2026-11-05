import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { BootScreen, BOOT_SLOW_MS } from '../src/components/BootScreen.tsx';
import { catalogs } from '../src/i18n/index.ts';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { activeBootStep, bootPercent, BOOT_STEPS, BOOT_WEIGHTS, initialBootProgress } from '../src/state/boot.ts';
import { initialTableState, tableReducer } from '../src/state/table.ts';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';

const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-boot-failed');
});

describe('static boot splash in index.html', () => {
  it('uses the same strings as the i18n catalogs', () => {
    const json = /<script type="application\/json" id="boot-i18n">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1];
    const embedded = JSON.parse(json ?? '{}') as Record<string, Record<string, string>>;
    expect(Object.keys(embedded).sort()).toEqual(Object.keys(catalogs).sort());
    for (const [locale, messages] of Object.entries(embedded)) {
      for (const [id, text] of Object.entries(messages)) {
        expect(text, `${locale} ${id}`).toBe(catalogs[locale as keyof typeof catalogs][id]);
      }
    }
  });

  it('lists the same steps as the React boot screen', () => {
    const steps = [...indexHtml.matchAll(/<li class="boot__step" data-step="([a-z]+)"/g)].map((match) => match[1]);
    expect(steps).toEqual([...BOOT_STEPS]);
    expect(indexHtml).toContain(`Math.round(${BOOT_WEIGHTS.assets} * `);
    expect(indexHtml).toContain(`Math.max(0, ${BOOT_SLOW_MS} - performance.now())`);
    // bootAssetsFailed 讀的標記
    expect(indexHtml).toContain(`document.documentElement.setAttribute('data-boot-failed', '')`);
  });
});

describe('static boot splash plural', () => {
  it('uses a singular asset message for one file', () => {
    expect(catalogs.en['boot.assetsDetail.one']).toBe('Downloaded {files} file · {size}');
    expect(catalogs.en['boot.assetsDetail.other']).toBe('Downloaded {files} files · {size}');
    expect(indexHtml).toContain(`files === 1 ? 'one' : 'other'`);
  });
});

describe('boot progress', () => {
  it('weights settled steps, counting failures and skips as settled', () => {
    expect(Object.values(BOOT_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(100);
    const start = initialBootProgress();
    expect(bootPercent(start)).toBe(BOOT_WEIGHTS.assets);
    expect(activeBootStep(start)).toBe('config');

    let state = initialTableState('en');
    for (const [step, status] of [['config', 'failed'], ['session', 'done'], ['profiles', 'done'], ['games', 'skipped']] as const) {
      state = tableReducer(state, { type: 'boot-step', step, status });
    }
    expect(bootPercent(state.boot)).toBe(100);
    expect(activeBootStep(state.boot)).toBeNull();
  });

  it('shows each bootstrap request as it settles', async () => {
    const fake = createFakeApi();
    const session = deferred<Awaited<ReturnType<typeof fake.getSession>>>();
    const api = { ...fake, getSession: () => session.promise };
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);

    const progress = screen.getByTestId('boot-progress');
    await waitFor(() => expect(screen.getByTestId('boot-step-profiles').dataset.status).toBe('done'));
    expect(screen.getByTestId('boot-step-assets').dataset.status).toBe('done');
    expect(screen.getByTestId('boot-step-config').dataset.status).toBe('done');
    expect(screen.getByTestId('boot-step-session').dataset.status).toBe('active');
    expect(screen.getByTestId('boot-step-games').dataset.status).toBe('pending');
    expect(progress.getAttribute('aria-valuenow')).toBe('70');
    expect(progress.getAttribute('aria-valuetext')).toBe('70% · Checking your session');

    await act(async () => session.resolve(await fake.getSession()));
    await waitFor(() => expect(screen.queryByTestId('boot-screen')).toBeNull());
  });

  it('marks a failed request and skips the game list without a session', async () => {
    const fake = createFakeApi({ identity: null });
    const profiles = deferred<Awaited<ReturnType<typeof fake.listProfiles>>>();
    const api = {
      ...fake,
      getConfig: async () => ({ ok: false as const, error: { code: 'E_NETWORK', messageId: 'error.E_NETWORK' } }),
      getSession: async () => ({ ok: true as const, data: { player: null } }),
      listProfiles: () => profiles.promise,
    };
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);

    await waitFor(() => expect(screen.getByTestId('boot-step-games').dataset.status).toBe('skipped'));
    expect(screen.getByTestId('boot-step-config').dataset.status).toBe('failed');
    expect(screen.getByTestId('boot-step-config').textContent).toContain('Failed');
    expect(screen.getByTestId('boot-step-profiles').dataset.status).toBe('active');

    await act(async () => profiles.resolve(await fake.listProfiles()));
    await screen.findByTestId('nickname-input');
  });

  it('stays on the failure notice when a stylesheet failed before React mounted', async () => {
    document.documentElement.setAttribute('data-boot-failed', '');
    const api = createFakeApi({ identity: null });
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);

    await waitFor(() => expect(screen.getByTestId('boot-step-profiles').dataset.status).toBe('done'));
    await act(async () => {});
    expect(screen.queryByTestId('nickname-input')).toBeNull();
    expect(screen.getByTestId('boot-step-assets').dataset.status).toBe('failed');
    expect(screen.getByTestId('boot-failed').textContent).toContain('could not be downloaded');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.getByTestId('boot-screen').getAttribute('aria-busy')).toBe('false');
  });

  it('stops before the first screen when a stylesheet fails during bootstrap', async () => {
    const fake = createFakeApi({ identity: null });
    const profiles = deferred<Awaited<ReturnType<typeof fake.listProfiles>>>();
    const api = { ...fake, listProfiles: () => profiles.promise };
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
    await waitFor(() => expect(screen.getByTestId('boot-step-profiles').dataset.status).toBe('active'));
    expect(screen.getByTestId('boot-step-assets').dataset.status).toBe('done');

    document.documentElement.setAttribute('data-boot-failed', '');
    await act(async () => profiles.resolve(await fake.listProfiles()));
    await screen.findByTestId('boot-failed');
    expect(screen.queryByTestId('nickname-input')).toBeNull();
  });

  it('offers a refresh once loading takes longer than usual', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    render(<LocaleProvider locale="zh-Hant"><BootScreen boot={initialBootProgress()} /></LocaleProvider>);
    act(() => { vi.advanceTimersByTime(BOOT_SLOW_MS - 1001); });
    expect(screen.queryByTestId('boot-slow')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByTestId('boot-slow').textContent).toContain('比平常久');
    expect(screen.getByRole('button', { name: '重新整理' })).toBeTruthy();
  });
});
