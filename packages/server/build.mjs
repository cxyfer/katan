/** Bundles the service into a single ESM file for the runtime image. */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/server.mjs',
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

process.stdout.write('built dist/server.mjs\n');
