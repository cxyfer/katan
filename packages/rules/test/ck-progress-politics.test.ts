/**
 * R-CK progress cards, politics deck (CK25 pp. 9–10, 15–16; CK-FAQ 63,
 * 73–75, 82–94, 110, 114). Each card: timing, targets, effect, required
 * responses, information access, deck return and refusal boundary.
 */

import { describe, expect, it } from 'vitest';
import { projectEvent, projectGame } from '../src/project.ts';
import { ckState, ckView } from '../src/modules/citiesKnights/state.ts';
import type { GameState } from '../src/types.ts';
import {
  actCk,
  addKnight,
  bottomOf,
  cornersOf,
  edgeBetween,
  emptyCkGame,
  freePath,
  eventsOf,
  giveCommodities,
  handCards,
  hexWith,
  hints,
  moduleFrame,
  pathFrom,
  player,
  playCard,
  rejectCard,
  rejectCk,
  roadAlong,
  scripted,
  setBuilding,
  setImprovement,
  spreadVertices,
  totalHand,
} from './ck-helpers.ts';
import { give } from './helpers.ts';

describe('R-CK Diplomacy (CK25 p. 15; CK-FAQ 88–93)', () => {
  it('PC-DI1 removes another player\'s open road back to their supply', () => {
    const state = emptyCkGame(4);
    const path = pathFrom(state, spreadVertices(state, 1)[0]!, 2);
    setBuilding(state, 'p2', path[0]!, false);
    const [inner, outer] = roadAlong(state, 'p2', path);
    handCards(state, 'p1', ['diplomacy']);
    // Only the dead-end road is open: the inner one touches the building and another road.
    expect(hints(state, 'p1').progress[0].targets.edges).toEqual([outer]);
    expect(rejectCard(state, 'p1', 'diplomacy', { edge: inner })).toBe('E_ILLEGAL_TARGET');
    const played = playCard(state, 'p1', 'diplomacy', { edge: outer });
    expect(played.state.board.roads[outer!]).toBeNull();
    expect(played.state.pending).toBeNull();
    expect(eventsOf(played, 'ck.roadRemoved')[0]!.params).toMatchObject({ owner: 'p2', edge: outer });
    expect(bottomOf(played.state, 'politics')).toBe('diplomacy');
  });

  it('PC-DI2 a road joining two own buildings or a building and a knight is not open; an opponent piece between roads does not open them (FAQ 89)', () => {
    const state = emptyCkGame(4);
    const path = pathFrom(state, spreadVertices(state, 1)[0]!, 4);
    setBuilding(state, 'p2', path[0]!, false);
    const edges = roadAlong(state, 'p2', path);
    addKnight(state, { player: 'p2', vertex: path[4]!, level: 1, active: false });
    // An opponent knight interrupts the route in the middle.
    addKnight(state, { player: 'p3', vertex: path[2]!, level: 1, active: false });
    handCards(state, 'p1', ['diplomacy']);
    // Road 3–4 ends at the p2 knight, but the route from it is cut at path[2]: open.
    expect(hints(state, 'p1').progress[0].targets.edges).toEqual([edges[3]]);
    ckState(state).knights = ckState(state).knights.filter((knight) => knight.player !== 'p3');
    expect(hints(state, 'p1').progress[0]).toMatchObject({ playable: false, reason: 'no-target' });
  });

  it('PC-DI3 an own open road may be rebuilt for free at once; Longest Road is settled afterwards (FAQ 88)', () => {
    const state = emptyCkGame(4);
    const [start] = spreadVertices(state, 1);
    const mine = pathFrom(state, start!, 6);
    setBuilding(state, 'p1', mine[0]!, false);
    const myRoads = roadAlong(state, 'p1', mine.slice(0, 6));
    const theirs = freePath(state, 5, mine);
    setBuilding(state, 'p2', theirs[0]!, false);
    roadAlong(state, 'p2', theirs);
    state.awards.longestRoad = 'p1';
    handCards(state, 'p1', ['diplomacy']);
    const played = playCard(state, 'p1', 'diplomacy', { edge: myRoads[4] });
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.diplomacyRoad', responders: ['p1'] });
    expect(played.state.awards.longestRoad).toBe('p1');
    const view = projectGame(played.state, 'p1').pending as any;
    expect(view.data.edges).toContain(myRoads[4]);
    expect(rejectCk(played.state, 'p2', { type: 'progress.diplomacyRoad', edge: myRoads[4] })).toBe('E_NOT_ACTOR');
    const rebuilt = actCk(played.state, 'p1', { type: 'progress.diplomacyRoad', edge: myRoads[4] });
    expect(rebuilt.state.pending).toBeNull();
    expect(rebuilt.state.awards.longestRoad).toBe('p1');
    expect(player(rebuilt.state, 'p1').resources.lumber).toBe(0);
    // Declining leaves the route at 4 and p2's 5 takes the award.
    const declined = actCk(played.state, 'p1', { type: 'progress.diplomacyRoad', edge: null });
    expect(declined.state.awards.longestRoad).toBe('p2');
    expect(eventsOf(declined, 'ck.diplomacyRoadSkipped')).toHaveLength(1);
  });
});

describe('R-CK Encouragement (CK25 pp. 9, 15)', () => {
  it('PC-EC1 activates every own knight for free; they cannot act on this turn', () => {
    const state = emptyCkGame(4);
    const path = pathFrom(state, spreadVertices(state, 1)[0]!, 3);
    setBuilding(state, 'p1', path[0]!, false);
    roadAlong(state, 'p1', path);
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 1, active: false });
    addKnight(state, { player: 'p1', vertex: path[2]!, level: 2, active: true });
    handCards(state, 'p1', ['encouragement']);
    const played = playCard(state, 'p1', 'encouragement');
    expect(ckView(played.state).knights.every((knight) => knight.active)).toBe(true);
    expect(eventsOf(played, 'ck.knightsEncouraged')[0]!.params).toMatchObject({ vertices: [path[1]] });
    expect(player(played.state, 'p1').resources.grain).toBe(0);
    expect(rejectCk(played.state, 'p1', { type: 'knight.move', from: path[1], to: path[3] })).toBe('E_KNIGHT_JUST_ACTIVATED');
    // The knight that was already active may still act.
    actCk(played.state, 'p1', { type: 'knight.move', from: path[2], to: path[3] });
  });
});

describe('R-CK Espionage (CK25 pp. 10, 15; CK-FAQ 114)', () => {
  it('PC-ES1 only the spy sees the target\'s progress cards and may take one; VP cards are never there', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p1', ['espionage']);
    handCards(state, 'p2', ['taxation', 'crane']);
    ckState(state).progressVp.p2 = ['constitution'];
    const played = playCard(state, 'p1', 'espionage', { target: 'p2' });
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.espionage', responders: ['p1'] });
    expect((projectGame(played.state, 'p1').pending as any).data.cards).toEqual(['taxation', 'crane']);
    const bystander = JSON.stringify(projectGame(played.state, 'p3'));
    expect(bystander).not.toContain('"taxation"');
    expect(bystander).not.toContain('"crane"');
    expect(rejectCk(played.state, 'p1', { type: 'progress.takeProgress', card: 'constitution' })).toBe('E_CARD_NOT_HELD');
    const taken = actCk(played.state, 'p1', { type: 'progress.takeProgress', card: 'taxation' });
    expect(player(taken.state, 'p1').progressCards).toEqual(['taxation']);
    expect(player(taken.state, 'p2').progressCards).toEqual(['crane']);
    expect(ckView(taken.state).progressVp.p2).toEqual(['constitution']);
    const event = eventsOf(taken, 'ck.espionageTaken')[0]!;
    expect(projectEvent(event, 'p3').params).toEqual({ playerId: 'p1', victim: 'p2', took: true });
    expect(projectEvent(event, 'p2').params).toMatchObject({ card: 'taxation' });
    expect(bottomOf(taken.state, 'politics')).toBe('espionage');
  });

  it('PC-ES2 the spy may take nothing; an empty hand is only looked at', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p1', ['espionage', 'espionage']);
    handCards(state, 'p2', ['crane']);
    const played = playCard(state, 'p1', 'espionage', { target: 'p2' });
    const declined = actCk(played.state, 'p1', { type: 'progress.takeProgress', card: null });
    expect(player(declined.state, 'p2').progressCards).toEqual(['crane']);
    const empty = playCard(declined.state, 'p1', 'espionage', { target: 'p3' });
    expect(empty.state.pending).toBeNull();
    expect(eventsOf(empty, 'ck.espionageLooked')[0]!.params).toMatchObject({ victim: 'p3', count: 0 });
    expect(rejectCard(declined.state, 'p1', 'espionage', { target: 'p1' })).toBe('E_ILLEGAL_TARGET');
  });

  it('PC-ES3 a stolen card may exceed the limit until the end of the action phase (CK25 p. 10)', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p1', ['espionage', 'crane', 'mining', 'irrigation', 'medicine']);
    handCards(state, 'p2', ['wedding']);
    const played = playCard(state, 'p1', 'espionage', { target: 'p2' });
    const taken = actCk(played.state, 'p1', { type: 'progress.takeProgress', card: 'wedding' });
    expect(player(taken.state, 'p1').progressCards).toHaveLength(5);
    expect(rejectCk(taken.state, 'p1', { type: 'turn.end' })).toBe('E_PROGRESS_HAND_LIMIT');
  });
});

describe('R-CK Intrigue (CK25 pp. 10, 15)', () => {
  function intrigueGame() {
    const state = emptyCkGame(4);
    const [start] = spreadVertices(state, 1);
    const path = pathFrom(state, start!, 4);
    setBuilding(state, 'p1', path[0]!, false);
    roadAlong(state, 'p1', path.slice(0, 3));
    setBuilding(state, 'p2', path[4]!, false);
    roadAlong(state, 'p2', path.slice(2));
    addKnight(state, { player: 'p2', vertex: path[2]!, level: 3, active: true });
    handCards(state, 'p1', ['intrigue']);
    return { state, path };
  }

  it('PC-IT1 displaces any opponent knight on the player\'s route, without a knight; the owner retreats it', () => {
    const { state, path } = intrigueGame();
    expect(hints(state, 'p1').progress[0].targets.vertices).toEqual([path[2]]);
    const played = playCard(state, 'p1', 'intrigue', { vertex: path[2] });
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.displaced', responders: ['p2'] });
    expect(ckView(played.state).knights).toHaveLength(0);
    const retreated = actCk(played.state, 'p2', { type: 'knight.retreat', vertex: path[3] });
    expect(ckView(retreated.state).knights).toEqual([expect.objectContaining({ player: 'p2', vertex: path[3], level: 3, active: true })]);
    expect(retreated.state.board.buildings[path[2]!]).toBeNull();
  });

  it('PC-IT2 a knight with nowhere to go returns to the supply; a knight off the player\'s routes is no target', () => {
    const { state, path } = intrigueGame();
    state.board.roads[edgeBetween(state, path[2]!, path[3]!)] = null;
    state.board.roads[edgeBetween(state, path[3]!, path[4]!)] = null;
    state.board.roads[edgeBetween(state, path[1]!, path[2]!)] = { player: 'p2', ship: false };
    expect(hints(state, 'p1').progress[0]).toMatchObject({ playable: false, reason: 'no-target' });
    state.board.roads[edgeBetween(state, path[1]!, path[2]!)] = { player: 'p1', ship: false };
    const played = playCard(state, 'p1', 'intrigue', { vertex: path[2] });
    expect(played.state.pending).toBeNull();
    expect(eventsOf(played, 'ck.knightRemoved')[0]!.params).toMatchObject({ playerId: 'p2', level: 3 });
  });
});

/** p2 and p3 have more points than p1 (2 and 1 settlements); p4 has none. */
function rankedGame(): GameState {
  const state = emptyCkGame(4);
  const [a, b, c] = spreadVertices(state, 3);
  setBuilding(state, 'p2', a!, false);
  setBuilding(state, 'p2', b!, false);
  setBuilding(state, 'p3', c!, false);
  return state;
}

describe('R-CK Sabotage (CK25 p. 16; CK-FAQ 110)', () => {
  it('PC-SA1 players with as many or more points discard half their cards, choosing them; forced hands go at once', () => {
    const state = rankedGame();
    give(state, 'p2', { ore: 3, wool: 2 });
    giveCommodities(state, 'p2', { coin: 1 });
    give(state, 'p3', { grain: 3 });
    give(state, 'p4', { brick: 4 });
    handCards(state, 'p1', ['sabotage']);
    const played = playCard(state, 'p1', 'sabotage');
    // p4 has as many points as p1 (0); p3's single kind is discarded without a prompt.
    expect(eventsOf(played, 'ck.sabotageRequired')[0]!.params).toMatchObject({ required: { p2: 3, p3: 1, p4: 2 } });
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.sabotage', responders: ['p2'] });
    expect(player(played.state, 'p3').resources.grain).toBe(2);
    expect(player(played.state, 'p4').resources.brick).toBe(2);
    expect(rejectCk(played.state, 'p2', { type: 'progress.sabotageDiscard', cards: ['ore'] })).toBe('E_INVALID_DISCARD_COUNT');
    const bankOre = played.state.bank.ore;
    const done = actCk(played.state, 'p2', { type: 'progress.sabotageDiscard', cards: ['ore', 'ore', 'coin'] });
    expect(done.state.pending).toBeNull();
    expect(done.state.bank.ore).toBe(bankOre + 2);
    expect(totalHand(done.state, 'p2')).toBe(3);
    expect(totalHand(done.state, 'p1')).toBe(0);
    expect(projectEvent(eventsOf(done, 'ck.sabotageDiscarded')[0]!, 'p1').params).toEqual({ playerId: 'p2', count: 3 });
  });

  it('PC-SA2 the player and poorer or one-card hands are spared; no victim still plays the card', () => {
    const state = rankedGame();
    setBuilding(state, 'p1', spreadVertices(state, 1)[0]!, true);
    give(state, 'p1', { ore: 4 });
    give(state, 'p2', { ore: 1 });
    give(state, 'p3', { ore: 4 });
    handCards(state, 'p1', ['sabotage']);
    const played = playCard(state, 'p1', 'sabotage');
    expect(eventsOf(played, 'ck.sabotageRequired')[0]!.params).toMatchObject({ required: {} });
    expect(played.state.pending).toBeNull();
    expect(player(played.state, 'p1').resources.ore).toBe(4);
  });
});

describe('R-CK Taxation (CK25 pp. 7, 16; CK-FAQ 63, 73–75)', () => {
  it('PC-TX1 only after the first barbarian attack', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p1', ['taxation']);
    expect(hints(state, 'p1').progress[0]).toMatchObject({ playable: false, reason: 'robber-inactive' });
    expect(rejectCard(state, 'p1', 'taxation', { hex: 0 })).toBe('E_ROBBER_INACTIVE');
  });

  it('PC-TX2 moves the robber and steals one random card from each other player with a building there', () => {
    const state = emptyCkGame(4);
    ckState(state).attacks = 1;
    const hex = hexWith(state, 'fields');
    const corners = cornersOf(state, hex);
    setBuilding(state, 'p2', corners[0]!, false);
    setBuilding(state, 'p2', corners[2]!, true);
    setBuilding(state, 'p3', corners[4]!, false);
    give(state, 'p2', { ore: 2 });
    giveCommodities(state, 'p3', { coin: 1 });
    handCards(state, 'p1', ['taxation']);
    expect(rejectCard(state, 'p1', 'taxation', { hex: state.board.robber })).toBe('E_ROBBER_SAME_HEX');
    const played = playCard(state, 'p1', 'taxation', { hex }, scripted([1, 0]));
    expect(played.state.board.robber).toBe(hex);
    expect(player(played.state, 'p1')).toMatchObject({ resources: { ore: 1 }, commodities: { coin: 1 } });
    const stole = eventsOf(played, 'ck.taxationStole');
    expect(stole.map((event) => event.params.victim)).toEqual(['p2', 'p3']);
    expect(projectEvent(stole[0]!, 'p4').params).toEqual({ playerId: 'p1', victim: 'p2' });
    expect(projectEvent(stole[0]!, 'p2').params).toMatchObject({ card: 'ore' });
    expect(played.state.board.pirate).toBe(state.board.pirate);
    expect(bottomOf(played.state, 'politics')).toBe('taxation');
  });

  it('PC-TX3 an empty hex is a legal destination (FAQ 75); no steal from oneself', () => {
    const state = emptyCkGame(4);
    ckState(state).attacks = 1;
    const hex = hexWith(state, 'pasture');
    setBuilding(state, 'p1', cornersOf(state, hex)[0]!, false);
    give(state, 'p1', { ore: 1 });
    handCards(state, 'p1', ['taxation']);
    const played = playCard(state, 'p1', 'taxation', { hex });
    expect(eventsOf(played, 'ck.taxationStole')).toHaveLength(0);
  });
});

describe('R-CK Treason (CK25 p. 16; CK-FAQ 82–87)', () => {
  function treasonGame() {
    const state = emptyCkGame(4);
    const [a] = spreadVertices(state, 1);
    const mine = pathFrom(state, a!, 2);
    setBuilding(state, 'p1', mine[0]!, false);
    roadAlong(state, 'p1', mine);
    const theirs = freePath(state, 3, mine);
    setBuilding(state, 'p2', theirs[0]!, false);
    roadAlong(state, 'p2', theirs);
    addKnight(state, { player: 'p2', vertex: theirs[1]!, level: 3, active: true });
    addKnight(state, { player: 'p2', vertex: theirs[2]!, level: 1, active: false });
    handCards(state, 'p1', ['treason']);
    return { state, mine, theirs };
  }

  it('PC-TR1 the chosen player removes a knight of their choice; the player places one of the same or lower strength with its status', () => {
    const { state, mine, theirs } = treasonGame();
    expect(hints(state, 'p1').progress[0].targets.players).toEqual(['p2']);
    expect(rejectCard(state, 'p1', 'treason', { target: 'p3' })).toBe('E_ILLEGAL_TARGET');
    const played = playCard(state, 'p1', 'treason', { target: 'p2' });
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.treasonRemove', responders: ['p2'] });
    expect(rejectCk(played.state, 'p2', { type: 'progress.treasonRemove', vertex: mine[1] })).toBe('E_ILLEGAL_TARGET');
    const removed = actCk(played.state, 'p2', { type: 'progress.treasonRemove', vertex: theirs[1] });
    expect(moduleFrame(removed.state)).toMatchObject({ kind: 'citiesKnights.treasonPlace', responders: ['p1'] });
    expect((projectGame(removed.state, 'p1').pending as any).data).toMatchObject({ level: 3, active: true, levels: [1, 2, 3] });
    // A mighty knight without the Fortress (CK25 p. 16).
    expect(player(removed.state, 'p1').improvements.politics).toBe(0);
    const placed = actCk(removed.state, 'p1', { type: 'progress.treasonPlace', vertex: mine[1], level: 3 });
    expect(ckView(placed.state).knights).toContainEqual({ player: 'p1', vertex: mine[1], level: 3, active: true });
    // An active knight placed this way may act at once (FAQ 83).
    actCk(placed.state, 'p1', { type: 'knight.move', from: mine[1], to: mine[2] });
    expect(bottomOf(placed.state, 'politics')).toBe('treason');
  });

  it('PC-TR2 one knight goes without a prompt; the player may decline or have nothing to place', () => {
    const { state, mine, theirs } = treasonGame();
    ckState(state).knights = ckState(state).knights.filter((knight) => knight.vertex !== theirs[1]);
    const played = playCard(state, 'p1', 'treason', { target: 'p2' });
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.treasonPlace' });
    expect(rejectCk(played.state, 'p1', { type: 'progress.treasonPlace', vertex: mine[1], level: 2 })).toBe('E_INVALID_SELECTION');
    const declined = actCk(played.state, 'p1', { type: 'progress.treasonPlace', vertex: null });
    expect(declined.state.pending).toBeNull();
    expect(ckView(declined.state).knights).toHaveLength(0);
    // Both basic knights already on the board: nothing to place (FAQ 82, 85).
    const full = treasonGame();
    ckState(full.state).knights = ckState(full.state).knights.filter((knight) => knight.vertex !== full.theirs[1]);
    addKnight(full.state, { player: 'p1', vertex: full.mine[1]!, level: 1, active: false });
    addKnight(full.state, { player: 'p1', vertex: full.mine[2]!, level: 1, active: false });
    const none = playCard(full.state, 'p1', 'treason', { target: 'p2' });
    expect(none.state.pending).toBeNull();
    expect(eventsOf(none, 'ck.treasonNoPlace')).toHaveLength(1);
    expect(ckView(none.state).knights.filter((knight) => knight.player === 'p2')).toHaveLength(0);
  });
});

describe('R-CK Wedding (CK25 p. 16)', () => {
  it('PC-WE1 each richer player gives 2 cards of their choice; fewer cards go at once', () => {
    const state = rankedGame();
    give(state, 'p2', { ore: 2, wool: 1 });
    give(state, 'p3', { grain: 1 });
    give(state, 'p4', { brick: 3 });
    handCards(state, 'p1', ['wedding']);
    const played = playCard(state, 'p1', 'wedding');
    expect(eventsOf(played, 'ck.weddingRequired')[0]!.params).toMatchObject({ required: { p2: 2, p3: 1 } });
    expect(player(played.state, 'p1').resources.grain).toBe(1);
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.wedding', responders: ['p2'] });
    expect(rejectCk(played.state, 'p2', { type: 'progress.weddingGive', cards: ['ore', 'ore', 'wool'] })).toBe('E_INVALID_DISCARD_COUNT');
    const given = actCk(played.state, 'p2', { type: 'progress.weddingGive', cards: ['wool', 'ore'] });
    expect(player(given.state, 'p1').resources).toMatchObject({ grain: 1, ore: 1, wool: 1 });
    expect(player(given.state, 'p4').resources.brick).toBe(3);
    const gift = eventsOf(given, 'ck.weddingGift')[0]!;
    expect(projectEvent(gift, 'p3').params).toEqual({ playerId: 'p2', to: 'p1', count: 2 });
    expect(projectEvent(gift, 'p1').params).toMatchObject({ cards: ['wool', 'ore'] });
    expect(bottomOf(given.state, 'politics')).toBe('wedding');
  });

  it('PC-WE2 nobody richer: played without effect', () => {
    const state = emptyCkGame(4);
    give(state, 'p2', { ore: 3 });
    handCards(state, 'p1', ['wedding']);
    const played = playCard(state, 'p1', 'wedding');
    expect(played.state.pending).toBeNull();
    expect(totalHand(played.state, 'p1')).toBe(0);
  });
});

describe('R-CK card timing for every non-Alchemy card (CK25 p. 10; CK-FAQ 95, 99)', () => {
  it('PC-TI1 cards wait for the own action phase with nothing pending, and only from the hand', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    handCards(state, 'p1', ['wedding']);
    expect(rejectCard(state, 'p1', 'wedding')).toBe('E_WRONG_PHASE');
    state.turn.phase = 'action';
    expect(rejectCard(state, 'p2', 'wedding')).toBe('E_NOT_YOUR_TURN');
    expect(rejectCard(state, 'p1', 'sabotage')).toBe('E_CARD_NOT_HELD');
    expect(rejectCard(state, 'p1', 'constitution')).toBe('E_INVALID_SELECTION');
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    expect(rejectCard(state, 'p1', 'wedding')).toBe('E_PENDING_EFFECT');
  });

  it('PC-TI2 paired player 2 plays cards in their action phase (CK56-25 p. 4)', () => {
    const state = emptyCkGame(6, 3, 'action');
    state.turn.pairedActor = 2;
    handCards(state, 'p4', ['resourceMonopoly']);
    give(state, 'p1', { wool: 2 });
    const played = playCard(state, 'p4', 'resourceMonopoly', { kind: 'wool' });
    expect(player(played.state, 'p4').resources.wool).toBe(2);
  });

  it('PC-TI3 a card drawn this turn may be played this turn (CK25 p. 10)', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    setImprovement(state, 'p1', 'politics', 5);
    state.progressDecks.politics.unshift(state.progressDecks.politics.splice(state.progressDecks.politics.indexOf('wedding'), 1)[0]!);
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, scripted([0, 0, 5]));
    expect(player(rolled.state, 'p1').progressCards).toEqual(['wedding']);
    playCard(rolled.state, 'p1', 'wedding');
  });
});
