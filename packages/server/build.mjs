/** Bundles the service into a single ESM file for the runtime image. */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Paths resolve against this file so the script also works from the repo root.
const packageDir = import.meta.dirname;
const outDir = join(packageDir, 'dist');
mkdirSync(outDir, { recursive: true });

await build({
  absWorkingDir: packageDir,
  entryPoints: [join(packageDir, 'src/main.ts')],
  outfile: join(outDir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  banner: {
    js: [
      "import { createRequire as __catanCreateRequire } from 'node:module';",
      'const require = __catanCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  // Optional native accelerators that are resolved lazily at runtime.
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
});

process.stdout.write(`built ${join(outDir, 'server.mjs')}\n`);
