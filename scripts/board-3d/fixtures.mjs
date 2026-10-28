/**
 * Bridge the #7 deterministic fixture generator to the board-3d evidence path.
 * The rules generator remains single-owned in scripts/board-visual/fixtures.mjs.
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) throw new Error('usage: node scripts/board-3d/fixtures.mjs --out .tmp/board-3d-fixtures.json');

const destination = resolve(root, values.out);
const destinationRelative = relative(root, destination);
if (!destinationRelative || destinationRelative.startsWith('..') || isAbsolute(destinationRelative)) {
  throw new Error('--out must name a file inside this worktree');
}

const bridgeRelative = join('test-results', 'board-3d-bridge', `${process.pid}-${randomUUID()}.json`);
const bridge = resolve(root, bridgeRelative);

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolveRun(stdout.trim())
      : reject(new Error(`fixture generator exited ${code}: ${stderr.trim()}`)));
  });
}

try {
  await mkdir(dirname(bridge), { recursive: true });
  await run(process.execPath, ['scripts/board-visual/fixtures.mjs', '--out', bridgeRelative]);
  const bytes = await readFile(bridge);
  const fixture = JSON.parse(bytes.toString('utf8'));
  if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.boards) || fixture.boards.length !== 2) {
    throw new Error('fixture generator returned an unsupported schema');
  }
  const expected = [
    { id: 'hex-r2', hexes: 19, vertices: 54, edges: 72 },
    { id: 'hex-r56', hexes: 30, vertices: 83, edges: 112 },
  ];
  for (const topology of expected) {
    const board = fixture.boards.find((candidate) => candidate.id === topology.id);
    if (!board || board.topology.hexes !== topology.hexes || board.topology.vertices !== topology.vertices || board.topology.edges !== topology.edges) {
      throw new Error(`fixture topology mismatch for ${topology.id}`);
    }
  }
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(bridge, destination);
  console.log(JSON.stringify({
    destination,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    seed: fixture.seed,
    boards: expected,
    sources: fixture.sources,
  }, null, 2));
} finally {
  await rm(bridge, { force: true });
}
