/**
 * 0.4.x 以前的預設 SQLite 檔名是 `catan.sqlite`。新檔不存在時，在開啟資料庫前
 * 接手舊檔：同目錄的舊檔直接改名；`LEGACY_SQLITE_PATH` 指向的舊檔（例如 Compose
 * 以唯讀方式掛載的舊 volume）則複製一份，原檔留作備份。
 */

import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const LEGACY_FILE_NAME = 'catan.sqlite';
const CURRENT_FILE_NAME = 'katan.sqlite';
/**
 * 主檔與附屬檔；WAL 尚未 checkpoint 的資料在 `-wal` 裡。主檔最後搬：中途中斷時
 * 新主檔仍不存在，下次啟動會重新搬一次。
 */
const FILE_SUFFIXES = ['-wal', '-shm', '-journal', ''];

export type LegacySqliteMigration =
  | { action: 'none' }
  | { action: 'renamed' | 'copied'; from: string; to: string };

function moveDatabase(from: string, to: string, transfer: (src: string, dest: string) => void): void {
  for (const suffix of FILE_SUFFIXES) {
    if (existsSync(from + suffix)) transfer(from + suffix, to + suffix);
  }
}

export function migrateLegacySqlite(sqlitePath: string, legacyPath: string | null): LegacySqliteMigration {
  if (sqlitePath === ':memory:' || existsSync(sqlitePath)) return { action: 'none' };

  if (basename(sqlitePath) === CURRENT_FILE_NAME) {
    const sibling = join(dirname(sqlitePath), LEGACY_FILE_NAME);
    if (existsSync(sibling)) {
      moveDatabase(sibling, sqlitePath, renameSync);
      return { action: 'renamed', from: sibling, to: sqlitePath };
    }
  }

  if (legacyPath && existsSync(legacyPath)) {
    moveDatabase(legacyPath, sqlitePath, copyFileSync);
    return { action: 'copied', from: legacyPath, to: sqlitePath };
  }
  return { action: 'none' };
}
