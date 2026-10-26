/**
 * Local development runner: builds the client in watch mode and restarts the
 * service when server/rules/protocol sources change.
 */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const webDir = resolve(root, 'packages/web');

const web = spawn('pnpm', ['--filter', '@catan/web', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
});

let server = null;
let restarting = false;

function startServer() {
  server = spawn('node', ['--experimental-strip-types', 'packages/server/src/main.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: process.env.PORT ?? '3000',
      WEB_DIST_PATH: resolve(webDir, 'dist'),
      SQLITE_PATH: process.env.SQLITE_PATH ?? resolve(root, '.data/catan.sqlite'),
    },
  });
  server.on('exit', (code) => {
    if (!restarting && code !== 0) process.stdout.write(`server exited with ${code}\n`);
  });
}

function restart() {
  if (!server) return;
  restarting = true;
  const current = server;
  current.once('exit', () => {
    restarting = false;
    startServer();
  });
  current.kill('SIGTERM');
}

startServer();

for (const directory of ['packages/server/src', 'packages/rules/src', 'packages/protocol/src']) {
  watch(resolve(root, directory), { recursive: true }, (_event, filename) => {
    if (filename && !filename.endsWith('.ts')) return;
    process.stdout.write(`change detected: ${directory}/${filename}\n`);
    restart();
  });
}

const stop = () => {
  restarting = true;
  server?.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
