#!/usr/bin/env node
/**
 * Prints deterministic Traders & Barbarians fixtures for the capture harness
 * as JSON: the registry `ProfileView`s and, per scenario, an in-game snapshot
 * produced by the real rules engine (setup played with seeded legal
 * placements, then a few scenario-specific pieces), projected for p1.
 *
 * Usage: node scripts/traders-barbarians/fixtures.mjs <board-3d fixture.json>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const rules = await import(resolve(root, 'packages/rules/src/index.ts'));
const protocol = await import(resolve(root, 'packages/protocol/src/index.ts'));

const source = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const base = source.boards.find((board) => board.id === 'hex-r2');
const seats = base.snapshot.view.players.map(({ id, nickname, color }) => ({ id, nickname, color }));

function apply(state, actor, command, rng) {
  const outcome = rules.applyCommand(state, actor, command, rng);
  if (!outcome.ok) throw new Error(`${command.type} rejected: ${outcome.error.code}`);
  return outcome.state;
}

/** Plays setup with seeded legal placements, then opens p1's action phase. */
function playedSetup(profileId, seed) {
  const rng = rules.seededRng(seed);
  let state = rules.createGame({ profileId, players: seats, setupMode: 'variable', rng });
  while (state.turn.phase === 'setup') {
    const setup = state.turn.setup;
    const actor = state.players[setup.order[setup.index]].id;
    if (setup.stage === 'building') {
      const legal = rules.legalBuildingVertices(state, actor, { setup: true });
      state = apply(state, actor, { type: 'setup.placeBuilding', vertex: legal[rng.int(legal.length)] }, rng);
    } else {
      const legal = rules.legalRoadEdges(state, actor, { setup: true, lastVertex: setup.lastVertex });
      state = apply(state, actor, { type: 'setup.placeRoad', edge: legal[rng.int(legal.length)] }, rng);
    }
  }
  state.turn.phase = 'action';
  state.turn.dice = [3, 5];
  return state;
}

const tb = (state) => state.moduleState.tradersBarbarians;

const SCENARIOS = {
  'tb-fishing': {
    profileId: 'tb-fishing-2025',
    seed: 21,
    dress(state) {
      const slot = tb(state)['tb-fishing'];
      slot.hands.p1 = [3, 2, 1, 1];
      slot.hands.p2 = [2, 2];
      slot.hands.p3 = [3];
      slot.supply.fish = [8, 7, 6];
      slot.discard = [1, 1, 1];
      slot.boot = 'p2';
      slot.supply.boot = 0;
      state.board.robber = slot.lake;
    },
  },
  'tb-rivers': {
    profileId: 'tb-rivers-2025',
    seed: 22,
    dress(state) {
      const rivers = tb(state)['tb-rivers'];
      const topology = rules.getTopology(state.board.layout.topologyId);
      // Two bridges: p1 and p2 each own one, next to their own settlement.
      rivers.bridgeSites.slice(0, 2).forEach((edge, index) => {
        const owner = state.players[index].id;
        const vertex = topology.edges[edge].vertices[0];
        if (!state.board.buildings[vertex]) state.board.buildings[vertex] = { player: owner, city: false };
        state.board.roads[edge] = { player: owner, ship: false, bridge: true };
      });
      const coins = tb(state)['tb-coins'];
      coins.gold = { p1: 7, p2: 3, p3: 1, p4: 3 };
      coins.supply = 100 - 14;
      state.players[0].resources = { lumber: 2, brick: 2, wool: 4, grain: 1, ore: 0 };
    },
  },
  'tb-merchant-trains': {
    profileId: 'tb-merchant-trains-2025',
    seed: 23,
    dress(state) {
      const trains = tb(state)['tb-merchant-trains'];
      const topology = rules.getTopology(state.board.layout.topologyId);
      // Two trains of three and two wagons running out from the watering hole.
      for (const [train, length] of [[0, 3], [2, 2]]) {
        let vertex = trains.starts[train].vertex;
        let edge = trains.starts[train].edge;
        for (let step = 0; step < length; step++) {
          trains.wagons.push({ edge, train });
          vertex = topology.edges[edge].vertices.find((v) => v !== vertex);
          edge = topology.vertices[vertex].edges.find((e) => !trains.wagons.some((w) => w.edge === e));
        }
      }
      trains.supply = 22 - trains.wagons.length;
    },
  },
  'tb-barbarian-attack': {
    profileId: 'tb-barbarian-attack-2025',
    seed: 24,
    dress(state) {
      const ba = tb(state)['tb-barbarian-attack'];
      const topology = rules.getTopology(state.board.layout.topologyId);
      // Barbarians on four coastal hexes, one of them conquered.
      ba.coastal.slice(0, 4).forEach((hex, index) => { ba.barbarians[hex] = [3, 2, 1, 1][index]; });
      ba.supply = 36 - Object.values(ba.barbarians).reduce((sum, count) => sum + count, 0);
      const edgesOf = (hex) => topology.edges.map((info, edge) => (info.hexes.includes(hex) ? edge : -1)).filter((edge) => edge >= 0);
      const castleEdges = edgesOf(ba.castle);
      ba.knights = [
        { player: 'p1', edge: castleEdges[0] },
        { player: 'p1', edge: edgesOf(ba.coastal[1])[2] },
        { player: 'p2', edge: edgesOf(ba.coastal[1])[4] },
        { player: 'p3', edge: edgesOf(ba.coastal[3])[1] },
      ];
      ba.prisoners = { p1: 3, p2: 1, p3: 0, p4: 2 };
      ba.deck = ba.deck.slice(4);
      ba.discard = ['knighthood', 'capture', 'treason', 'knighthood'];
      tb(state)['tb-coins'].gold = { p1: 5, p2: 3, p3: 0, p4: 6 };
      tb(state)['tb-coins'].supply = 86;
    },
  },
  'tb-traders-barbarians': {
    profileId: 'tb-traders-barbarians-2025',
    seed: 25,
    dress(state) {
      const slot = tb(state)['tb-traders-barbarians'];
      const topology = rules.getTopology(state.board.layout.topologyId);
      // Wagons on the way: p1 next to the quarry with tools, p2 on the castle plaza with marble.
      const quarry = slot.sites.find((site) => site.id === 'quarry');
      const castle = slot.sites.find((site) => site.id === 'castle');
      const corner = topology.edges[topology.vertices[quarry.plaza].edges[1]].vertices.find((v) => v !== quarry.plaza);
      slot.wagons.p1 = { ...slot.wagons.p1, vertex: corner, level: 3, cargo: 'tools', delivered: 2 };
      slot.wagons.p2 = { ...slot.wagons.p2, vertex: castle.plaza, level: 2, cargo: 'marble', delivered: 1 };
      slot.wagons.p3 = { ...slot.wagons.p3, cargo: 'glass' };
      // A road on an interior path of the quarry.
      state.board.roads[topology.vertices[quarry.plaza].edges[0]] = { player: 'p1', ship: false };
    },
  },
};

const out = { profiles: rules.PROFILES.map(protocol.profileView), scenarios: {} };
for (const [id, scenario] of Object.entries(SCENARIOS)) {
  const state = playedSetup(scenario.profileId, scenario.seed);
  scenario.dress(state);
  const view = rules.projectGame(state, 'p1', { hints: rules.actionHints(state, 'p1') });
  const snapshot = structuredClone(base.snapshot);
  snapshot.view = view;
  out.scenarios[id] = { profileId: scenario.profileId, topologyId: view.board.topologyId, snapshot };
}
process.stdout.write(JSON.stringify(out));
