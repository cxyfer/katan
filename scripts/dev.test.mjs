/** Real dev lifecycle, isolated source copy, random ports and temporary SQLite. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const { WebSocket } = createRequire(join(root, 'packages/server/package.json'))('ws');

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function until(check, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}

async function responds(port, path = '/readyz') {
  try { return (await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(500) })).ok; }
  catch { return false; }
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'katan-dev-regression-'));
  for (const file of ['package.json', 'tsconfig.base.json', 'scripts/dev.mjs', 'scripts/dev-web.mjs',
    'packages/server/build-options.mjs', 'packages/web/vite.config.ts', 'packages/web/index.html']) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await cp(join(root, file), join(directory, file));
  }
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  for (const name of ['server', 'web', 'rules', 'protocol']) {
    const relative = `packages/${name}`;
    const target = join(directory, relative);
    await cp(join(root, relative, 'src'), join(target, 'src'), { recursive: true });
    await cp(join(root, relative, 'package.json'), join(target, 'package.json'));
    await mkdir(join(target, 'node_modules/@catan'), { recursive: true });
    for (const entry of await readdir(join(root, relative, 'node_modules'))) {
      if (entry === '@catan' || entry.startsWith('.')) continue;
      await symlink(join(root, relative, 'node_modules', entry), join(target, 'node_modules', entry), 'dir');
    }
    for (const workspace of ['rules', 'protocol']) {
      await symlink(join(directory, 'packages', workspace), join(target, 'node_modules/@catan', workspace), 'dir');
    }
  }
  return directory;
}

async function delayViteListen(directory, milliseconds) {
  await writeFile(join(directory, 'vite-delay.mjs'), `
    import dns from 'node:dns';
    const lookup = dns.lookup.bind(dns);
    dns.lookup = (hostname, ...args) => {
      if (hostname === 'localhost') {
        console.log('[fixture] delaying Vite bind');
        setTimeout(() => lookup(hostname, ...args), ${milliseconds});
      }
      else lookup(hostname, ...args);
    };
  `);
}

function launch(directory, port, webPort, extraEnv = {}) {
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development', COOKIE_SECURE: 'false', DATABASE_URL: '',
      PORT: String(port), VITE_PORT: String(webPort), HOST: '127.0.0.1', SQLITE_PATH: join(directory, 'data.sqlite'), ...extraEnv },
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const finished = once(child, 'exit');
  return { child, finished, output: () => output };
}

async function stop(run) {
  if (run.child.exitCode !== null || run.child.signalCode !== null) return;
  run.child.kill('SIGTERM');
  const deadline = setTimeout(() => run.child.kill('SIGKILL'), 16_000);
  try { await run.finished; } finally { clearTimeout(deadline); }
}

test('compiled dev server proxies a live game, watches dependencies, recovers and cleans up', { timeout: 90_000 }, async () => {
  const directory = await fixture();
  const port = await freePort();
  let webPort = await freePort();
  while (webPort === port) webPort = await freePort();
  const run = launch(directory, port, webPort);
  try {
    await until(() => responds(webPort), 'development servers never became ready');
    assert.doesNotMatch(run.output(), /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/);
    const base = `http://127.0.0.1:${webPort}`;
    const index = await (await fetch(base)).text();
    assert.match(index, /@vite\/client/);
    assert.equal((await fetch(`${base}/src/main.tsx`)).status, 200);
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.ok, true);
    const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'Dev regression', locale: 'en' }) });
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const player = (await response.json()).data.player;
    const restored = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
    assert.equal(restored.data.player.id, player.id);
    const socket = new WebSocket(`ws://127.0.0.1:${webPort}/ws`, { headers: { cookie } });
    try {
      await new Promise((resolvePong, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket proxy pong timeout')), 5000);
        socket.once('error', (error) => { clearTimeout(timer); reject(error); });
        socket.on('message', (data) => {
          if (JSON.parse(String(data)).type === 'pong') { clearTimeout(timer); resolvePong(); }
        });
        socket.once('open', () => socket.send(JSON.stringify({ type: 'ping', payload: {} })));
      });
    } finally { socket.terminate(); }
    const smoke = spawn(process.execPath, [join(root, 'scripts/smoke.mjs')], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SMOKE_BASE_URL: base },
    });
    let smokeLog = '';
    smoke.stdout.on('data', (data) => { smokeLog += data; });
    smoke.stderr.on('data', (data) => { smokeLog += data; });
    const [smokeCode] = await once(smoke, 'exit');
    assert.equal(smokeCode, 0, smokeLog);
    assert.match(smokeLog, /PASS  initial placement completes/);
    assert.match(smokeLog, /PASS  a dice roll is accepted/);

    const readyCount = () => run.output().split('[dev] service ready at').length - 1;
    for (const name of ['rules', 'protocol', 'server']) {
      const file = join(directory, `packages/${name}/src/${name === 'server' ? 'main' : 'index'}.ts`);
      const source = await readFile(file, 'utf8');
      const before = readyCount();
      await writeFile(file, `${source}\n// dev watch regression ${name}\n`);
      await until(async () => readyCount() > before && await responds(webPort), `${name} change did not restart service`);
    }
    const broken = join(directory, 'packages/server/src/main.ts');
    const source = await readFile(broken, 'utf8');
    await writeFile(broken, `${source}\nconst syntax error = ;\n`);
    await until(() => run.output().includes('service build failed'), 'build error not detected');
    await until(async () => !await responds(port), 'stale service remained live after build error');
    const beforeRecovery = readyCount();
    await writeFile(broken, source);
    await until(async () => readyCount() > beforeRecovery && await responds(webPort), 'service did not recover after source repair');
    const afterRestart = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
    assert.equal(afterRestart.data.player.id, player.id, 'restart lost persistent session');
    run.child.kill('SIGINT');
    await until(() => run.child.exitCode !== null, 'Ctrl-C did not stop the dev runner');
    assert.equal(run.child.exitCode, 0, run.output());
    await until(async () => !await responds(port) && !await responds(webPort, '/'), 'owned listeners survived shutdown');

    const blocker = createServer();
    await new Promise((done) => blocker.listen(webPort, '127.0.0.1', done));
    try {
      const failed = launch(directory, port, webPort);
      try {
        await until(() => failed.child.exitCode !== null, 'occupied web port left runner alive');
        assert.equal(failed.child.exitCode, 1, failed.output());
        await until(async () => !await responds(port), 'backend survived Vite startup failure');
      } finally { await stop(failed); }
    } finally { await new Promise((done) => blocker.close(done)); }
    const backendBlocker = createServer((socket) => socket.destroy());
    await new Promise((done) => backendBlocker.listen(port, '127.0.0.1', done));
    try {
      const failed = launch(directory, port, webPort);
      try {
        await until(() => failed.child.exitCode !== null, 'occupied service port left runner alive');
        assert.equal(failed.child.exitCode, 1, failed.output());
        assert.doesNotMatch(failed.output(), /Local:/, 'client advertised readiness after service startup failure');
        assert.equal(await responds(webPort, '/'), false);
      } finally { await stop(failed); }
    } finally { await new Promise((done) => backendBlocker.close(done)); }
    await delayViteListen(directory, 750);
    const midListenStop = launch(directory, port, webPort,
      { VITE_HOST: 'localhost', NODE_OPTIONS: ['--import', './vite-delay.mjs', process.env.NODE_OPTIONS].filter(Boolean).join(' ') });
    try {
      await until(() => midListenStop.output().includes('[fixture] delaying Vite bind'), 'Vite did not enter delayed bind');
      midListenStop.child.kill('SIGINT');
      await until(() => midListenStop.child.exitCode !== null, 'listen-time cancellation left runner alive');
      assert.equal(midListenStop.child.exitCode, 0, midListenStop.output());
      assert.doesNotMatch(midListenStop.output(), /Local:/, 'client advertised a listener after cancellation');
      await until(async () => !await responds(webPort), 'Vite listener survived cancellation');
      assert.equal(await responds(port), false);
    } finally { await stop(midListenStop); }
    await rm(join(directory, 'vite-delay.mjs'), { force: true });
    const earlyStop = launch(directory, port, webPort);
    try {
      await until(() => earlyStop.output().includes('compiling service'), 'runner did not reach compilation');
      earlyStop.child.kill('SIGINT');
      await until(() => earlyStop.child.exitCode !== null, 'startup cancellation left runner alive');
      assert.equal(earlyStop.child.exitCode, 0, earlyStop.output());
      assert.doesNotMatch(earlyStop.output(), /service ready at|Local:/);
      assert.equal(await responds(port), false);
      assert.equal(await responds(webPort), false);
    } finally { await stop(earlyStop); }
    const networkHost = launch(directory, port, webPort, { VITE_HOST: '127.0.0.2' });
    try {
      await until(() => /\bNetwork:\s+https?:\/\/\S+/.test(networkHost.output()),
        'Vite network URL did not satisfy dev readiness');
      assert.doesNotMatch(networkHost.output(), /\bLocal:/);
      const networkUrl = networkHost.output().match(/\bNetwork:\s+(https?:\/\/\S+)/)?.[1];
      assert.ok(networkUrl);
      assert.match(await (await fetch(networkUrl)).text(), /@vite\/client/);
      networkHost.child.kill('SIGINT');
      await until(() => networkHost.child.exitCode !== null, 'network-host runner did not stop');
      assert.equal(networkHost.child.exitCode, 0, networkHost.output());
      assert.equal(await responds(port), false);
    } finally { await stop(networkHost); }
    if (process.platform !== 'win32') {
      const termStop = launch(directory, port, webPort);
      let servicePid;
      try {
        await until(() => responds(webPort), 'SIGTERM fixture never became ready');
        servicePid = Number([...termStop.output().matchAll(/service ready at .+\(pid (\d+)\)/g)].at(-1)?.[1]);
        assert.ok(servicePid);
        process.kill(servicePid, 'SIGSTOP');
        termStop.child.kill('SIGTERM');
        await until(() => termStop.child.exitCode !== null, 'SIGTERM did not stop the runner after child timeout', 20_000);
        assert.equal(termStop.child.exitCode, 0, termStop.output());
        assert.equal(processExists(servicePid), false, 'stalled backend survived runner shutdown');
        await until(async () => !await responds(webPort), 'Vite listener survived SIGTERM');
      } finally {
        await stop(termStop);
        if (servicePid && processExists(servicePid)) {
          process.kill(servicePid, 'SIGCONT');
          process.kill(servicePid, 'SIGKILL');
        }
      }
    }
    const runtimeFailure = launch(directory, port, webPort);
    try {
      await until(() => responds(webPort), 'runtime failure fixture never became ready');
      const latestPid = [...runtimeFailure.output().matchAll(/service ready at .*\(pid (\d+)\)/g)].at(-1)?.[1];
      assert.ok(latestPid);
      process.kill(Number(latestPid), 'SIGKILL');
      await until(() => runtimeFailure.child.exitCode !== null, 'backend crash left runner alive');
      assert.equal(runtimeFailure.child.exitCode, 1);
      await until(async () => !await responds(webPort, '/'), 'Vite survived backend crash');
    } finally { await stop(runtimeFailure); }
    await writeFile(broken, `${source}\nconst syntax error = ;\n`);
    const initialFailure = launch(directory, port, webPort);
    try {
      await until(() => initialFailure.child.exitCode !== null, 'initial build failure left runner alive');
      assert.equal(initialFailure.child.exitCode, 1, initialFailure.output());
      assert.equal(await responds(webPort, '/'), false);
      assert.equal(await responds(port), false);
    } finally { await stop(initialFailure); }
  } catch (error) {
    console.error(run.output());
    throw error;
  } finally {
    await stop(run);
    await rm(directory, { recursive: true, force: true });
  }
});
