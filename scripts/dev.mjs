/** Vite client plus a compiled, watched service; neither survives runner shutdown. */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { context } from 'esbuild';
import { serverBuildOptions } from '../packages/server/build-options.mjs';

const root = resolve(import.meta.dirname, '..');
const webDir = resolve(root, 'packages/web');
const port = Number(process.env.PORT ?? 3000);
const serviceHost = process.env.HOST ?? '127.0.0.1';
const connectHost = ['0.0.0.0', '::'].includes(serviceHost) ? '127.0.0.1' : serviceHost;
const serviceOrigin = `http://${connectHost.includes(':') ? `[${connectHost}]` : connectHost}:${port}`;
// 開發產物不覆寫 pnpm build 產生的正式 bundle。
const outfile = resolve(root, 'packages/server/dist/dev/server.mjs');
let buildContext;
let webProcess;
let webStarting;
let server;
let stopping = false;
let shutdownPromise;
const expectedExits = new WeakSet();
let finishInitialBuild;
const initialBuild = new Promise((resolveBuild) => { finishInitialBuild = resolveBuild; });

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  expectedExits.add(child);
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  const deadline = setTimeout(() => child.kill('SIGKILL'), 12_000);
  try { await exited; } finally { clearTimeout(deadline); }
}

async function stopWeb(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  expectedExits.add(child);
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  const deadline = setTimeout(() => child.kill('SIGKILL'), 12_000);
  try { await exited; } finally { clearTimeout(deadline); }
}

function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  process.exitCode = code;
  // Vite is isolated so its own SIGTERM listener cannot exit this supervisor.
  shutdownPromise = (async () => {
    await Promise.all([webStarting?.catch(() => {}), stopServer(server), stopWeb(webProcess), buildContext?.dispose()]);
  })();
  return shutdownPromise;
}

function fail(error) {
  console.error(`[dev] ${error instanceof Error ? error.message : error}`);
  void shutdown(1).catch((failure) => {
    console.error('[dev] cleanup failed:', failure);
    process.exitCode = 1;
  });
}

async function restartService() {
  await stopServer(server);
  if (stopping) return;
  const child = spawn(process.execPath, ['--enable-source-maps', outfile], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST: serviceHost,
      PORT: String(port),
      WEB_DIST_PATH: process.env.WEB_DIST_PATH ?? resolve(webDir, 'dist'),
      SQLITE_PATH: process.env.SQLITE_PATH ?? resolve(root, '.data/catan.sqlite'),
    },
  });
  server = child;
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    if (!stopping && !expectedExits.has(child)) {
      fail(new Error(`service exited (${signal ?? code}); stopping the client too`));
    }
  });
  const deadline = Date.now() + 15_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`${serviceOrigin}/readyz`, { signal: AbortSignal.timeout(500) });
      if (response.ok && child.exitCode === null && child.signalCode === null) {
        console.log(`[dev] service ready at ${serviceOrigin} (pid ${child.pid})`);
        return;
      }
    } catch { /* 啟動及遷移期間短暫重試。 */ }
    await delay(100);
  }
  if (!stopping) fail(new Error('service did not become ready within 15 seconds'));
}

async function startWeb() {
  const child = spawn(process.execPath, ['scripts/dev-web.mjs'], {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, VITE_HOST: process.env.VITE_HOST ?? '127.0.0.1' },
  });
  webProcess = child;
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      output += chunk;
      process[stream === child.stdout ? 'stdout' : 'stderr'].write(chunk);
    });
  }
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    if (!stopping && !expectedExits.has(child)) {
      fail(new Error(`web client exited (${signal ?? code}); stopping the service too`));
    }
  });
  const deadline = Date.now() + 15_000;
  while (!stopping && child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    if (/\b(?:Local|Network):\s+https?:\/\/\S+/.test(output)) return;
    await delay(50);
  }
  if (!stopping) fail(new Error('web client did not become ready within 15 seconds'));
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  console.log('[dev] compiling service');
  buildContext = await context({
    ...serverBuildOptions,
    outfile,
    plugins: [{
      name: 'restart-service',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length) {
            // 編譯錯誤時停止舊後端，避免網頁繼續使用舊規則；修正後 watcher 重啟。
            await stopServer(server);
            console.error('[dev] service build failed; waiting for source changes');
            finishInitialBuild(false);
            return;
          }
          await restartService();
          finishInitialBuild(true);
        });
      },
    }],
  });
  if (stopping) {
    await buildContext.dispose();
    buildContext = undefined;
  } else {
    await buildContext.watch();
    if (!await initialBuild) throw new Error('initial service build failed');
    if (!stopping) {
      webStarting = startWeb();
      await webStarting;
    }
  }
} catch (error) {
  fail(error);
}
