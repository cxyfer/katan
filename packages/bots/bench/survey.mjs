import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'katan-bot-survey-'));
try {
  const outfile = join(directory, 'survey.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./survey.ts', import.meta.url))],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22.5',
  });
  const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
