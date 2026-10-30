/** Shared TypeScript bundling contract for development and production. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Paths resolve against this file so the script also works from the repo root.
const packageDir = import.meta.dirname;
const outDir = join(packageDir, 'dist');

// The release version lives in the root package.json only; stamp it into the
// bundle so `/healthz` cannot drift from the tag that was published.
const { version } = JSON.parse(readFileSync(join(packageDir, '../../package.json'), 'utf8'));

export const serverBuildOptions = {
  absWorkingDir: packageDir,
  entryPoints: [join(packageDir, 'src/main.ts')],
  outfile: join(outDir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  define: { __CATAN_VERSION__: JSON.stringify(version) },
  banner: {
    js: [
      "import { createRequire as __catanCreateRequire } from 'node:module';",
      'const require = __catanCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  // Optional native accelerators that are resolved lazily at runtime.
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
};
