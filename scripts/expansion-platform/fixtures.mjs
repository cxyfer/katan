#!/usr/bin/env node
/**
 * Prints deterministic fixtures for the expansion-platform harness as JSON:
 * the current registry `ProfileView`s and an in-game archipelago snapshot
 * derived from the board-3d hex-r2 fixture (same players and turn, the
 * sample archipelago board, no legal targets).
 *
 * Usage: node scripts/expansion-platform/fixtures.mjs <board-3d fixture.json>
 * Node strips the rules package's TypeScript types natively (Node >= 23.6).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const rules = await import(resolve(root, 'packages/rules/src/index.ts'));
const protocol = await import(resolve(root, 'packages/protocol/src/index.ts')).catch(() => null);

const source = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const base = source.boards.find((board) => board.id === 'hex-r2');
const topology = rules.getTopology('sample-archipelago');
const layout = rules.archipelagoLayout(topology);
const land = (hex) => layout.terrain[hex] !== 'sea';

const board = {
  topologyId: layout.topologyId,
  terrain: layout.terrain.slice(),
  numbers: layout.numbers.slice(),
  harbors: layout.harbors.map(({ edge, type }) => ({ edge, type })),
  islands: layout.islands.slice(),
  robber: layout.robber,
  pirate: layout.pirate,
  buildings: topology.vertices.map(() => null),
  roads: topology.edges.map(() => null),
};
// One building per player on different islands, plus a road from each.
const players = base.snapshot.view.players.map((player) => player.id);
const picks = [
  { q: -1, r: 0 }, { q: 2, r: -2 }, { q: 2, r: 1 }, { q: -2, r: 1 },
].map((coord) => topology.hexes.findIndex((hex) => hex.q === coord.q && hex.r === coord.r));
picks.forEach((hex, index) => {
  const vertex = topology.vertices.findIndex((info, id) => info.hexes.includes(hex) &&
    info.hexes.filter(land).length >= 2 && !board.buildings[id] &&
    !info.edges.some((edge) => topology.edges[edge].vertices.some((other) => board.buildings[other])));
  board.buildings[vertex] = { player: players[index % players.length], city: index % 2 === 1 };
  const edge = topology.vertices[vertex].edges.find((candidate) => topology.edges[candidate].hexes.every(land));
  if (edge !== undefined) board.roads[edge] = { player: players[index % players.length], ship: false };
});

const snapshot = structuredClone(base.snapshot);
snapshot.view.board = board;
snapshot.view.events = [];
snapshot.view.pending = null;
snapshot.view.pendingQueue = [];
snapshot.view.hints = { ...snapshot.view.hints, legalRoads: [], legalSettlements: [], legalCities: [], pendingKind: null };

const profiles = protocol
  ? rules.PROFILES.map(protocol.profileView)
  : source.profiles;

process.stdout.write(JSON.stringify({ profiles, archipelago: { snapshot } }));
