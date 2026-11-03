#!/usr/bin/env node
/**
 * Test-only fixture patches for the live Traders & Barbarians harness
 * (`live.py`): reads `{ profileId, state, actor }` (a persisted game snapshot
 * right after setup) from stdin and prints `{ state, info }` — the snapshot
 * moved into the situation a profile's scenario-specific action needs, plus
 * the board indices the browser script should use. Indices come from the
 * rules package so Python never re-derives topology.
 *
 * Usage: node --experimental-strip-types scripts/traders-barbarians/patch.mjs < input.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const rules = await import(resolve(root, 'packages/rules/src/index.ts'));

const { profileId, state, actor } = JSON.parse(readFileSync(0, 'utf8'));
const topology = rules.getTopology(state.board.layout.topologyId);
const slot = (id) => state.moduleState.tradersBarbarians[id];
const player = (id) => state.players.find((entry) => entry.id === id);
const others = state.players.map((entry) => entry.id).filter((id) => id !== actor);
const hexCorners = (hex) => rules.verticesOfHex(topology, hex);
const hexOwners = (hex) => new Set(hexCorners(hex).map((vertex) => state.board.buildings[vertex]?.player).filter(Boolean));

/** The actor's action phase, nothing pending. */
function actionPhase() {
  state.turn.seat = state.players.findIndex((entry) => entry.id === actor);
  state.turn.phase = 'action';
  state.turn.dice = [3, 5];
  state.turn.devCardPlayed = false;
  state.pending = null;
}

const empty = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
const info = {};

/** Friendly Robber (alone or with Harbors): a 7 is being resolved by the actor. */
function friendlyRobber() {
  actionPhase();
  state.pending = { kind: 'moveRobber', actor, cause: 'seven', pirate: false };
  if (state.board.robber < 0) state.board.robber = state.board.layout.terrain.indexOf('desert');
  const legal = rules.legalRobberHexes(state, actor);
  const all = state.board.layout.terrain.map((_, hex) => hex);
  info.guarded = all.find((hex) => hex !== state.board.robber && !legal.includes(hex) && hexOwners(hex).size > 0);
  info.free = legal.find((hex) => hexOwners(hex).size === 0);
  info.legal = legal;
  if (profileId === 'tb-friendly-robber-harbors-2025') {
    // p2 holds Strongest Ports (+2 public VP): its hexes are no longer protected.
    const rival = others[0];
    slot('harbors').holder = rival;
    player(rival).resources = { ...empty, ore: 2 };
    const after = rules.legalRobberHexes(state, actor);
    info.rival = rival;
    info.rivalHex = after.find((hex) => hexOwners(hex).has(rival) && hexOwners(hex).size === 1)
      ?? after.find((hex) => hexOwners(hex).has(rival));
    info.guarded = all.find((hex) => hex !== state.board.robber && !after.includes(hex) && hexOwners(hex).size > 0);
    info.legal = after;
  }
}

/** Harbors of Catan: upgrading the second port building reaches 3 VP on ports. */
function harbors() {
  actionPhase();
  const ports = state.board.layout.harbors.map((harbor) => topology.edges[harbor.edge].vertices[0]);
  state.board.buildings[ports[0]] = { player: actor, city: true };
  state.board.buildings[ports[3]] = { player: actor, city: false };
  slot('harbors').holder = null;
  player(actor).resources = { ...empty, grain: 2, ore: 3 };
  info.upgrade = ports[3];
}

function fishing() {
  actionPhase();
  const fish = slot('tb-fishing');
  fish.hands[actor] = [3, 2];
  player(actor).resources = { ...empty };
  info.hand = [3, 2];
}

function rivers() {
  actionPhase();
  const site = slot('tb-rivers').bridgeSites[0];
  const [near] = topology.edges[site].vertices;
  state.board.buildings[near] = { player: actor, city: false };
  player(actor).resources = { ...empty, brick: 2, lumber: 1 };
  info.site = site;
}

function trains() {
  actionPhase();
  slot('tb-merchant-trains').collectedWindow = state.windowId;
  const starts = slot('tb-merchant-trains').starts;
  info.starts = starts.map((start) => start.edge);
}

function barbarians() {
  actionPhase();
  const ba = slot('tb-barbarian-attack');
  const hex = ba.coastal[3];
  ba.barbarians[hex] = 2;
  ba.deck = ['capture'];
  ba.discard = [];
  player(actor).resources = { ...empty, wool: 1, grain: 1, ore: 1 };
  const castleEdges = topology.edges.map((edge, index) => (edge.hexes.includes(ba.castle) ? index : -1)).filter((edge) => edge >= 0);
  ba.knights = [{ player: actor, edge: castleEdges[0] }];
  info.hex = hex;
  info.knight = castleEdges[0];
}

function traders() {
  actionPhase();
  const slotT = slot('tb-traders-barbarians');
  const quarry = slotT.sites.find((site) => site.id === 'quarry');
  const corner = topology.edges[topology.vertices[quarry.plaza].edges[1]].vertices.find((vertex) => vertex !== quarry.plaza);
  slotT.wagons[actor] = { ...slotT.wagons[actor], vertex: corner, level: 3, cargo: 'tools', delivered: 0 };
  info.plaza = quarry.plaza;
  info.corner = corner;
}

const PATCHES = {
  'tb-friendly-robber-2025': friendlyRobber,
  'tb-friendly-robber-harbors-2025': friendlyRobber,
  'tb-harbors-2025': harbors,
  'tb-fishing-2025': fishing,
  'tb-rivers-2025': rivers,
  'tb-merchant-trains-2025': trains,
  'tb-barbarian-attack-2025': barbarians,
  'tb-traders-barbarians-2025': traders,
};
if (!PATCHES[profileId]) throw new Error(`no live patch for ${profileId}`);
PATCHES[profileId]();
process.stdout.write(JSON.stringify({ state, info }));
