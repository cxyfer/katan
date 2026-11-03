/**
 * Base-game regression pins for the expansion platform.
 *
 * The digests below were recorded from master's own engine (master @ 0815c76,
 * base-2025.3), not from the expansion branch: a temporary detached worktree
 * at master received only this file and the `simulate.ts` options it needs,
 * and `RECORD_BASE_PINS=1 pnpm --filter @catan/rules exec vitest run
 * test/base-regression.test.ts` printed each section. The expansion branch
 * must then reproduce them unchanged. Topology indices, base layouts, freshly
 * created snapshots and whole simulated games stay byte-identical so that saved
 * base games keep their meaning. When master changes base behaviour, re-record
 * the same way from the new master, never from this branch.
 */

import { describe, expect, it } from 'vitest';
import { createGame } from '../src/engine.ts';
import { buildBaseLayout } from '../src/layout.ts';
import { seededRng } from '../src/rng.ts';
import { getTopology } from '../src/topology-registry.ts';
import { COLORS, playerIds } from './helpers.ts';
import { simulateGame } from './simulate.ts';

/** 64-bit FNV-1a over the JSON text, as hex; stable and dependency-free. */
function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

// The rules package has no DOM or Node typings, so reach both through globalThis.
const host = globalThis as unknown as {
  process?: { env: Record<string, string | undefined> };
  console: { log(message: string): void };
};
const RECORDING = !!host.process?.env.RECORD_BASE_PINS;

/** Compares a section with its pins, or prints it when re-recording. */
function expectPinned(section: keyof typeof PINNED, out: Record<string, string>): void {
  if (RECORDING) {
    host.console.log(`PIN ${section} ${JSON.stringify(out)}`);
    return;
  }
  expect(out).toEqual(PINNED[section]);
}

function topologyShape(id: string) {
  const topology = getTopology(id);
  return {
    id: topology.id,
    hexes: topology.hexes,
    vertices: topology.vertices,
    edges: topology.edges,
    coastalEdges: topology.coastalEdges,
    harborSlots: topology.harborSlots,
  };
}

function created(profileId: string, players: number, mode: 'fixed' | 'variable', seed: number) {
  return createGame({
    profileId,
    players: playerIds(players).map((id, index) => ({ id, nickname: id, color: COLORS[index]! })),
    setupMode: mode,
    rng: seededRng(seed),
  });
}

describe('base regression pins', () => {
  it('keeps the hex-r2 and hex-r56 indices', () => {
    expectPinned('topologies', {
      'hex-r2': digest(topologyShape('hex-r2')),
      'hex-r56': digest(topologyShape('hex-r56')),
    });
  });

  it('keeps fixed and variable base layouts for the same seed', () => {
    const out: Record<string, string> = {};
    for (const id of ['hex-r2', 'hex-r56']) {
      const topology = getTopology(id);
      out[`${id}:fixed`] = digest(buildBaseLayout({ topology, mode: 'fixed', rng: seededRng(1) }));
      for (const seed of [1, 2, 3, 7, 99]) {
        out[`${id}:variable:${seed}`] = digest(buildBaseLayout({ topology, mode: 'variable', rng: seededRng(seed) }));
      }
    }
    expectPinned('layouts', out);
  });

  it('creates byte-identical base snapshots', () => {
    const out: Record<string, string> = {};
    for (const [profileId, counts] of [['base-2025', [3, 4]], ['base-paired-2025', [5, 6]]] as const) {
      for (const players of counts) {
        for (const mode of ['fixed', 'variable'] as const) {
          out[`${profileId}:${players}:${mode}`] = digest(created(profileId, players, mode, 42));
        }
      }
    }
    expectPinned('snapshots', out);
  });

  it('plays whole simulated base games to the same final state', () => {
    const out: Record<string, string> = {};
    for (const seed of [11, 29, 47]) out[`seed:${seed}`] = digest(simulateGame(seed));
    out['paired:6:variable:5'] = digest(simulateGame(5, 6000, { players: 6, profileId: 'base-paired-2025', mode: 'variable' }));
    out['base:3:variable:8'] = digest(simulateGame(8, 6000, { players: 3, mode: 'variable' }));
    expectPinned('games', out);
  }, 30_000);
});

const PINNED = {
  topologies: {
    'hex-r2': '59d633e638db320d',
    'hex-r56': '5f81735086d9a4d6',
  },
  layouts: {
    'hex-r2:fixed': '16c8bff7561077f2',
    'hex-r2:variable:1': 'e05f8e38e6f22ec2',
    'hex-r2:variable:2': '8bd1d06624471b96',
    'hex-r2:variable:3': '43ec3f47f9dfed52',
    'hex-r2:variable:7': '14dd4a288ff8de31',
    'hex-r2:variable:99': '975ab4260248015c',
    'hex-r56:fixed': '5bd6818bb7b769bb',
    'hex-r56:variable:1': '573be6d7d48ff831',
    'hex-r56:variable:2': '324cb8bccc000a91',
    'hex-r56:variable:3': '5d2ae857eef9c57b',
    'hex-r56:variable:7': 'efd3a31ecd648334',
    'hex-r56:variable:99': 'f9e1331703b9f7df',
  },
  snapshots: {
    'base-2025:3:fixed': 'beb00353c3435a6d',
    'base-2025:3:variable': '322ae9e409ba4ba3',
    'base-2025:4:fixed': '6cc414be3b8e8cd4',
    'base-2025:4:variable': '48fbe1c1ecd90cf8',
    'base-paired-2025:5:fixed': '355ef6d38dcaa589',
    'base-paired-2025:5:variable': 'fca1847668944417',
    'base-paired-2025:6:fixed': '691d354c2d7efad9',
    'base-paired-2025:6:variable': '2fe8f5e666fd8447',
  },
  games: {
    'base:3:variable:8': '1462427badb857c8',
    'paired:6:variable:5': '3c00ff5d7781a65c',
    'seed:11': '03c796714315a908',
    'seed:29': 'a7584951a986ecc3',
    'seed:47': '79a4f9601eaf9ec7',
  },
};
