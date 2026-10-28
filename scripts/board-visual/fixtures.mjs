/** Repeatable, viewer-authorized board fixtures; never contacts a service or DB. */
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) throw new Error('usage: node scripts/board-visual/fixtures.mjs --out test-results/board-visual/fixtures.json');
const destination = resolve(root, values.out);
const outputRelative = relative(join(root, 'test-results'), destination);
if (!outputRelative || outputRelative.startsWith('..') || isAbsolute(outputRelative)) {
  throw new Error('--out must name a file inside this worktree\'s test-results/');
}

const temporary = await mkdtemp(join(tmpdir(), 'catan-board-fixtures-'));
try {
  const bundle = join(temporary, 'fixtures.mjs');
  await build({
    absWorkingDir: root,
    stdin: {
      contents: "export * as fixtures from './packages/web/src/test/fixtures.ts'; export * as rules from './packages/rules/src/index.ts';",
      resolveDir: root,
      sourcefile: 'board-visual-fixtures.ts',
      loader: 'ts',
    },
    outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  });
  const { fixtures: f, rules: r } = await import(pathToFileURL(bundle).href);
  const names = ['Captain Alexandra Longname', '小美航海家與群島探索隊長', 'Alex', 'Alex', 'Éléonore Longue Traversée', '鄭成功與六人島嶼遠征艦隊'];
  const colors = ['red', 'blue', 'orange', 'white', 'green', 'brown'];
  const seed = 7;
  const boards = [];
  for (const [topologyId, count, profileId] of [['hex-r2', 4, 'base-2025'], ['hex-r56', 6, 'base-paired-2025']]) {
    const rng = r.seededRng(seed);
    let state = r.createGame({ profileId, setupMode: 'fixed', rng,
      players: names.slice(0, count).map((nickname, seat) => ({ id: `p${seat + 1}`, nickname, color: colors[seat] })),
    });
    let revision = 1;
    function apply(actor, command, commandRng = rng) {
      const outcome = r.applyCommand(state, actor, command, commandRng);
      if (!outcome.ok) throw new Error(`${topologyId}: ${command.type}: ${JSON.stringify(outcome.error)}`);
      state = outcome.state;
      revision += 1;
    }
    while (state.turn.phase === 'setup') {
      const actor = state.players[state.turn.seat].id;
      const hints = r.actionHints(state, actor);
      const road = state.turn.setup.stage === 'road';
      apply(actor, road ? { type: 'setup.placeRoad', edge: hints.legalRoads[0] }
        : { type: 'setup.placeBuilding', vertex: hints.legalSettlements[0] });
    }
    // Fixture-only resource provisioning; all placements still use engine validation.
    for (const resource of r.RESOURCES) {
      const amount = 5 - state.players[0].resources[resource];
      state.players[0].resources[resource] += amount;
      state.bank[resource] -= amount;
    }
    const snapshot = (events = state.log.slice(-40)) => f.makeSnapshot(
      r.projectGame(state, 'p1', { events, hints: r.actionHints(state, 'p1') }), revision,
    );
    const baseline = snapshot([]);
    const sequence = [];
    // Recorded engine outcomes, not decoration RNG substituting live server dice.
    const dice = [1, 3];
    let draw = 0;
    apply('p1', { type: 'turn.roll' }, { int: () => dice[draw++] });
    sequence.push({ atMs: 600, command: { type: 'turn.roll' }, snapshot: snapshot() });
    const city = r.actionHints(state, 'p1').legalCities[0];
    apply('p1', { type: 'build.city', vertex: city });
    sequence.push({ atMs: 3000, command: { type: 'build.city', vertex: city }, snapshot: snapshot() });
    const road = r.actionHints(state, 'p1').legalRoads[0];
    apply('p1', { type: 'build.road', edge: road });
    sequence.push({ atMs: 5000, command: { type: 'build.road', edge: road }, snapshot: snapshot() });
    const projected = snapshot();
    const initial = snapshot([]);
    const room = f.makeRoom({ status: 'playing', capacity: count, profileId, gameId: 'g1',
      members: initial.view.players.map((player) => f.makeMember({ playerId: player.id, nickname: player.nickname,
        seat: player.seat, color: player.color, host: player.id === 'p1' })),
    });
    const topology = r.getTopology(topologyId);
    boards.push({ id: topologyId, topologyId, seed, snapshot: initial, historySnapshot: projected, baseline, sequence,
      room, games: [f.makeResumable({ status: 'playing', profileId,
        players: initial.view.players.map(({ id: playerId, nickname, color }) => ({ playerId, nickname, color })),
      })],
      topology: { hexes: topology.hexes.length, vertices: topology.vertices.length, edges: topology.edges.length },
    });
  }
  const sources = {};
  for (const source of ['packages/web/src/test/fixtures.ts', 'packages/rules/src/engine.ts', 'packages/rules/src/project.ts', 'packages/rules/src/topology.ts', 'packages/rules/src/layout.ts']) {
    sources[source] = createHash('sha256').update(await readFile(join(root, source))).digest('hex');
  }
  const fixture = { schemaVersion: 1, seed, sources,
    limitations: ['Synthetic fixture resource provisioning; projected engine snapshots, not a real network game.',
      'Static snapshot deliberately omits history for animation-free comparison; historySnapshot preserves current initial-history behavior for E01.',
      'Sequence is emitted by rules commands and authorized with projectGame for p1; no private engine state is exported.'],
    identity: f.makeIdentity({ nickname: names[0] }), config: f.makeConfig(),
    profiles: [f.makeProfile(), f.makeProfile({ id: 'base-paired-2025', labelKey: 'profile.base-paired-2025', playerCounts: [5, 6], paired: true })], boards,
  };
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(fixture, null, 2) + '\n');
  console.log(JSON.stringify({ destination, seed, boards: boards.map(({ id, topology }) => ({ id, ...topology })) }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
