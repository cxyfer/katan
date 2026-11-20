/** 0.4.x 的 catan.sqlite 在首次啟動時由 katan.sqlite 接手。 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacySqlite } from '../src/legacy-sqlite.ts';
import { startService } from '../src/main.ts';
import { createClient } from './helpers.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'katan-legacy-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('legacy sqlite file', () => {
  it('renames a sibling catan.sqlite together with its WAL files', () => {
    writeFileSync(join(dir, 'catan.sqlite'), 'main');
    writeFileSync(join(dir, 'catan.sqlite-wal'), 'wal');
    const target = join(dir, 'katan.sqlite');
    expect(migrateLegacySqlite(target, null)).toEqual({ action: 'renamed', from: join(dir, 'catan.sqlite'), to: target });
    expect(readFileSync(target, 'utf8')).toBe('main');
    expect(readFileSync(`${target}-wal`, 'utf8')).toBe('wal');
    expect(existsSync(join(dir, 'catan.sqlite'))).toBe(false);
  });

  it('copies LEGACY_SQLITE_PATH and leaves the original as a backup', () => {
    mkdirSync(join(dir, 'legacy'));
    const legacy = join(dir, 'legacy', 'catan.sqlite');
    writeFileSync(legacy, 'old volume');
    const target = join(dir, 'katan.sqlite');
    expect(migrateLegacySqlite(target, legacy)).toEqual({ action: 'copied', from: legacy, to: target });
    expect(readFileSync(target, 'utf8')).toBe('old volume');
    expect(existsSync(legacy)).toBe(true);
  });

  it('retries a copy that was interrupted before the database was complete', () => {
    mkdirSync(join(dir, 'legacy'));
    const legacy = join(dir, 'legacy', 'catan.sqlite');
    writeFileSync(legacy, 'complete database');
    const target = join(dir, 'katan.sqlite');
    // 上次複製在寫完前被中斷：只留下暫存檔，目標檔不存在
    writeFileSync(`${target}.migrating`, 'compl');
    expect(migrateLegacySqlite(target, legacy).action).toBe('copied');
    expect(readFileSync(target, 'utf8')).toBe('complete database');
    expect(existsSync(`${target}.migrating`)).toBe(false);
  });

  it('never touches an existing katan.sqlite or a custom file name', () => {
    writeFileSync(join(dir, 'catan.sqlite'), 'old');
    writeFileSync(join(dir, 'katan.sqlite'), 'current');
    expect(migrateLegacySqlite(join(dir, 'katan.sqlite'), join(dir, 'catan.sqlite'))).toEqual({ action: 'none' });
    expect(readFileSync(join(dir, 'katan.sqlite'), 'utf8')).toBe('current');
    expect(migrateLegacySqlite(join(dir, 'custom.sqlite'), null)).toEqual({ action: 'none' });
    expect(migrateLegacySqlite(':memory:', join(dir, 'catan.sqlite'))).toEqual({ action: 'none' });
  });

  it('keeps guest identities when a 0.4.x data directory is upgraded', async () => {
    const quiet = () => undefined;
    const before = await startService({ port: 0, host: '127.0.0.1', sqlitePath: join(dir, 'catan.sqlite') }, quiet);
    const client = createClient(`http://127.0.0.1:${before.port}`);
    const created = client.expectOk<{ player: { id: string } }>(await client.post('/api/session', { nickname: 'Old' }));
    await before.close();

    const after = await startService({ port: 0, host: '127.0.0.1', sqlitePath: join(dir, 'katan.sqlite') }, quiet);
    try {
      const upgraded = createClient(`http://127.0.0.1:${after.port}`);
      upgraded.cookie = client.cookie;
      const resolved = upgraded.expectOk<{ player: { id: string } }>(await upgraded.get('/api/session'));
      expect(resolved.player.id).toBe(created.player.id);
      expect(existsSync(join(dir, 'catan.sqlite'))).toBe(false);
    } finally {
      await after.close();
    }
  });
});
