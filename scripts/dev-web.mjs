/** Start the web dev server in a child process owned by scripts/dev.mjs. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const webDir = resolve(root, 'packages/web');
const requireWeb = createRequire(resolve(webDir, 'package.json'));
const { createServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
const server = await createServer({ root: webDir });
await server.listen();
server.printUrls();
