/** 賽後結算數據：引擎在轉移時累積的統計，以及僅在終局公開的 projection。 */

import { describe, expect, it } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { abandonGame } from '../src/engine.ts';
import { projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import { verticesOfHex } from '../src/topology.ts';
import { TERRAIN_RESOURCE, type GameState, type Resource } from '../src/types.ts';
import {
  act,
  forceTurn,
  newGame,
  placeBuilding,
  playableGame,
  runSetup,
  scriptedRng,
  setHand,
} from './helpers.ts';

function clearBuildings(state: GameState): void {
  state.board.buildings = state.board.buildings.map(() => null);
}

/** 一個點數為 6、有資源產出的地形格。 */
function sixHex(state: GameState): number {
  return state.board.layout.numbers.findIndex((value) => value === 6);
}

function hexResource(state: GameState, hex: number): Resource {
  return TERRAIN_RESOURCE[state.board.layout.terrain[hex]!]!;
}

function moveRobberToDesert(state: GameState): void {
  state.board.robber = state.board.layout.terrain.findIndex((terrain) => terrain === 'desert');
}

function rollSix(state: GameState): GameState {
  return act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 2])).state;
}

describe('game statistics', () => {
  it('starts complete and records the starting resources of setup', () => {
    const { state } = newGame({ players: 4 });
    expect(state.stats?.complete).toBe(true);
    const finished = runSetup(state, seededRng(3));
    const stats = finished.stats!;
    for (const player of finished.players) {
      const starting = Object.values(stats.players[player.id]!.startingResources).reduce((a, b) => a + b, 0);
      const hand = Object.values(player.resources).reduce((a, b) => a + b, 0);
      expect(starting).toBe(hand);
    }
    // 開局後第一個回合開始時會取樣一次分數。
    expect(stats.turns).toBe(1);
    expect(stats.timeline).toHaveLength(1);
    expect(stats.players['p1']!.turns).toBe(1);
  });

  it('counts dice rolls, production and robber-blocked production', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    clearBuildings(state);
    const topo = topologyOf(state);
    const hex = sixHex(state);
    const vertices = verticesOfHex(topo, hex);
    placeBuilding(state, 'p1', vertices[0]!, false);
    placeBuilding(state, 'p2', vertices[3]!, true);
    moveRobberToDesert(state);
    const resource = hexResource(state, hex);

    const produced = rollSix(state);
    expect(produced.stats!.dice[6]).toBe(1);
    expect(produced.stats!.players['p1']!.rolls).toBe(1);
    expect(produced.stats!.players['p1']!.produced[resource]).toBeGreaterThanOrEqual(1);
    expect(produced.stats!.players['p2']!.produced[resource]).toBeGreaterThanOrEqual(2);

    const blockedState = JSON.parse(JSON.stringify(state)) as GameState;
    blockedState.board.robber = hex;
    const blocked = rollSix(blockedState);
    const p2 = blocked.stats!.players['p2']!;
    expect(p2.blockedRolls).toBe(1);
    expect(p2.blockedResources[resource]).toBe(2);
    expect(blocked.stats!.players['p1']!.blockedResources[resource]).toBe(1);
  });

  it('records production withheld by a bank shortage', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    clearBuildings(state);
    const topo = topologyOf(state);
    const hex = sixHex(state);
    const vertices = verticesOfHex(topo, hex);
    placeBuilding(state, 'p1', vertices[0]!, false);
    placeBuilding(state, 'p2', vertices[3]!, false);
    moveRobberToDesert(state);
    const resource = hexResource(state, hex);
    state.bank[resource] = 1;
    const rolled = rollSix(state);
    expect(rolled.stats!.players['p1']!.starvedResources[resource]).toBe(1);
    expect(rolled.stats!.players['p2']!.starvedResources[resource]).toBe(1);
  });

  it('tracks spending, builds and drawn development cards by type', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { wool: 2, grain: 2, ore: 2 });
    state.devDeck = ['monopoly', 'knight'];
    let next = act(state, 'p1', { type: 'build.devCard' }, scriptedRng([0])).state;
    next = act(next, 'p1', { type: 'build.devCard' }, scriptedRng([0])).state;
    const stats = next.stats!.players['p1']!;
    expect(stats.devCardsBought).toMatchObject({ monopoly: 1, knight: 1, victoryPoint: 0 });
    expect(stats.spent).toEqual({ lumber: 0, brick: 0, wool: 2, grain: 2, ore: 2 });
  });

  it('tracks knights, robber moves, steals and the victim', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    clearBuildings(state);
    const topo = topologyOf(state);
    const hex = sixHex(state);
    placeBuilding(state, 'p2', verticesOfHex(topo, hex)[0]!, false);
    setHand(state, 'p2', { ore: 1 });
    state.players[0]!.devCards = ['knight'];
    const played = act(state, 'p1', { type: 'dev.playKnight', hex }).state;
    const stole = act(played, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0])).state;
    const thief = stole.stats!.players['p1']!;
    expect(thief.devCardsPlayed.knight).toBe(1);
    expect(thief.robberMoves).toBe(1);
    expect(thief.stolen.ore).toBe(1);
    expect(stole.stats!.players['p2']!.robbed.ore).toBe(1);
  });

  it('tracks discards on a seven', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    setHand(state, 'p1', { lumber: 8 });
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
    expect(rolled.stats!.players['p1']!.sevens).toBe(1);
    const discarded = act(rolled, 'p1', { type: 'pending.discard', resources: ['lumber', 'lumber', 'lumber', 'lumber'] }).state;
    expect(discarded.stats!.players['p1']!.discarded.lumber).toBe(4);
    expect(discarded.stats!.players['p1']!.peakHand).toBe(8);
  });

  it('tracks monopoly gains and losses', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p2', { wool: 3 });
    setHand(state, 'p3', { wool: 1 });
    setHand(state, 'p4', {});
    state.players[0]!.devCards = ['monopoly'];
    const next = act(state, 'p1', { type: 'dev.playMonopoly', resource: 'wool' }).state;
    expect(next.stats!.players['p1']!.monopolyGained.wool).toBe(4);
    expect(next.stats!.players['p1']!.devCardsPlayed.monopoly).toBe(1);
    expect(next.stats!.players['p2']!.monopolyLost.wool).toBe(3);
    expect(next.stats!.players['p3']!.monopolyLost.wool).toBe(1);
  });

  it('tracks bank and player trades from both sides', () => {
    const { state } = playableGame({ players: 4 });
    clearBuildings(state);
    setHand(state, 'p1', { lumber: 4, brick: 1 });
    setHand(state, 'p2', { ore: 2 });
    let next = act(state, 'p1', { type: 'trade.bank', give: 'lumber', receive: 'grain' }).state;
    const p1Bank = next.stats!.players['p1']!;
    expect(p1Bank.bankTrades).toBe(1);
    expect(p1Bank.bankGiven.lumber).toBe(4);
    expect(p1Bank.bankReceived.grain).toBe(1);

    next = act(next, 'p1', { type: 'trade.offer', to: 'p2', give: { brick: 1 }, want: { ore: 2 } }).state;
    const offerId = next.offers[0]!.id;
    next = act(next, 'p2', { type: 'trade.respond', offerId, response: 'consented' }).state;
    next = act(next, 'p1', { type: 'trade.settle', offerId }).state;
    const p1 = next.stats!.players['p1']!;
    const p2 = next.stats!.players['p2']!;
    expect(p1.playerTrades).toBe(1);
    expect(p1.tradeGiven.brick).toBe(1);
    expect(p1.tradeReceived.ore).toBe(2);
    expect(p2.playerTrades).toBe(1);
    expect(p2.tradeGiven.ore).toBe(2);
    expect(p2.tradeReceived.brick).toBe(1);
  });

  it('initialises incomplete statistics for snapshots written before they existed', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    delete state.stats;
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([0, 0])).state;
    expect(rolled.stats?.complete).toBe(false);
    expect(rolled.stats?.players['p1']!.rolls).toBe(1);
  });

  it('publishes statistics only after the game has a result', () => {
    const { state } = playableGame({ players: 4 });
    state.devDeck = ['victoryPoint'];
    setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    const bought = act(state, 'p1', { type: 'build.devCard' }, scriptedRng([0])).state;
    const during = projectGame(bought, 'p2');
    expect(during.stats).toBeUndefined();
    expect(JSON.stringify(during)).not.toContain('victoryPoint');

    const ended = abandonGame(bought);
    const after = projectGame(ended, 'p2');
    expect(after.stats?.players['p1']!.devCardsBought.victoryPoint).toBe(1);
    // 終局時再取樣一次，且包含隱藏的勝利分數卡。
    const last = after.stats!.timeline.at(-1)!;
    expect(last).toHaveLength(4);
    const firstSample = after.stats!.timeline[0]!;
    expect(last[0]).toBe(firstSample[0]! + 1);
  });

  it('samples the final scores when a player wins', () => {
    const { state } = playableGame({ players: 4 });
    state.players[0]!.bonusPoints = 10;
    forceTurn(state, 3, 'action');
    const ended = act(state, 'p4', { type: 'turn.end' }).state;
    expect(ended.result?.playerId).toBe('p1');
    const view = projectGame(ended, 'p3');
    expect(view.stats!.timeline.at(-1)![0]).toBeGreaterThanOrEqual(10);
  });
});
