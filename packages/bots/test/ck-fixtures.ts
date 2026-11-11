/**
 * C&K 的固定盤面：以 rules 的真實指令走到各種 pending frame，讓保底、經濟與投影形狀的測試都對著真實的
 * 投影，不是手寫的假資料（形狀由 `ck-model.test.ts` 鎖住，保底由 `ck-duty.test.ts` 驗證）。
 *
 * 場景都改寫自 `packages/rules/test/ck-*.test.ts` 的案例；每個 builder 回傳要作答的座位與狀態。
 * 沒有 `resolveRoll`：它是續行 frame（responders 為空），真實對局裡不會停在那裡。
 */

import {
  actionHints,
  neighborsOfVertex,
  projectGame,
  topologyOf,
  type GameState,
  type GameView,
} from '@catan/rules';
import {
  actCk,
  addKnight,
  emptyCkGame,
  freePath,
  giveCommodities,
  handCards,
  pathFrom,
  player,
  playCard,
  POLITICS,
  rollRng,
  roadAlong,
  setBuilding,
  setImprovement,
  SHIP,
  spreadVertices,
  TRADE,
} from '../../rules/test/ck-helpers.ts';
import { give } from '../../rules/test/helpers.ts';

export interface FrameFixture {
  readonly kind: string;
  readonly state: GameState;
  /** `responders[0]`：保底此刻要作答的座位。 */
  readonly responder: string;
}

export function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

/** p2 有兩座聚落、p3 一座：分數 p2 > p3 > p1 = p4（Guild Dues、Sabotage、Wedding 的對象）。 */
function rankedGame(): GameState {
  const state = emptyCkGame(4);
  const [a, b, c] = spreadVertices(state, 3);
  setBuilding(state, 'p2', a!, false);
  setBuilding(state, 'p2', b!, false);
  setBuilding(state, 'p3', c!, false);
  return state;
}

function fixture(kind: string, state: GameState): FrameFixture {
  const frame = state.pending as { kind: string; responders: string[] } | null;
  if (!frame || frame.kind !== kind) throw new Error(`expected a ${kind} frame, got ${frame?.kind ?? 'none'}`);
  return { kind, state, responder: frame.responders[0]! };
}

/** 一座城市沒有騎士：蠻族來襲，p1 被掠奪（有 2 座城市，p2 有騎士）。 */
function pillage(): FrameFixture {
  const state = emptyCkGame(4, 0, 'preroll');
  state.moduleState!.citiesKnights = { ...(state.moduleState!.citiesKnights as object), barbarian: 6 };
  const [a, b, c, k1] = spreadVertices(state, 4);
  setBuilding(state, 'p1', a!, true);
  setBuilding(state, 'p1', b!, true);
  setBuilding(state, 'p2', c!, true);
  addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: true });
  return fixture('citiesKnights.pillage', actCk(state, 'p1', { type: 'turn.roll' }, rollRng(6, 6, SHIP)).state);
}

/** p1 有道路網，一隻 2 級騎士擠走 p2 的 1 級騎士；p2 有退路。 */
function displaced(): FrameFixture {
  const state = emptyCkGame(4);
  const path = pathFrom(state, 20, 5);
  setBuilding(state, 'p1', path[0]!);
  roadAlong(state, 'p1', path);
  const offPath = (vertex: number, avoid: readonly number[]): number => {
    const next = neighborsOfVertex(topologyOf(state), vertex).find((candidate) => !avoid.includes(candidate));
    if (next === undefined) throw new Error(`no free neighbour of ${vertex}`);
    return next;
  };
  const w = offPath(path[3]!, path);
  const x = offPath(w, [...path, path[3]!]);
  setBuilding(state, 'p2', x);
  roadAlong(state, 'p2', [path[3]!, w, x]);
  addKnight(state, { player: 'p1', vertex: path[1]!, level: 2, active: true });
  addKnight(state, { player: 'p2', vertex: path[3]!, level: 1, active: true });
  return fixture('citiesKnights.displaced', actCk(state, 'p1', { type: 'knight.displace', from: path[1]!, to: path[3]! }).state);
}

/** 非行動者 p3 被抽到第 5 張進步卡，要在生產之前棄 1 張。 */
function progressDiscard(): FrameFixture {
  const state = emptyCkGame(4, 1, 'preroll');
  state.progressDecks.science = ['alchemy', 'crane', 'invention', 'printing', 'mining'];
  state.progressDecks.politics = ['espionage', 'wedding'];
  setImprovement(state, 'p3', 'politics', 5);
  player(state, 'p3').progressCards = ['diplomacy', 'intrigue', 'sabotage', 'treason'];
  const [city] = spreadVertices(state, 1);
  setBuilding(state, 'p3', city!, true);
  return fixture('citiesKnights.progressDiscard', actCk(state, 'p2', { type: 'turn.roll' }, rollRng(5, 6, POLITICS)).state);
}

/** p2 與 p4 平手，依序抽牌（p4 先）。 */
function defenderDraw(): FrameFixture {
  const state = emptyCkGame(4, 2, 'preroll');
  state.moduleState!.citiesKnights = { ...(state.moduleState!.citiesKnights as object), barbarian: 6 };
  const [k1, k2, k3] = spreadVertices(state, 3);
  addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: true });
  addKnight(state, { player: 'p4', vertex: k2!, level: 1, active: true });
  addKnight(state, { player: 'p1', vertex: k3!, level: 1, active: false });
  state.progressDecks.trade = ['merchant', 'guildDues'];
  state.progressDecks.politics = ['wedding'];
  return fixture('citiesKnights.defenderDraw', actCk(state, 'p3', { type: 'turn.roll' }, rollRng(6, 6, SHIP)).state);
}

/** 科學 3 級的 p2 這次什麼都沒拿到，可以任選一張資源。 */
function scienceBonus(): FrameFixture {
  const state = emptyCkGame(4, 0, 'preroll');
  setImprovement(state, 'p2', 'science', 3);
  return fixture('citiesKnights.scienceBonus', actCk(state, 'p1', { type: 'turn.roll' }, rollRng(5, 6, TRADE)).state);
}

/** p1 對持有兩種 commodity 的 p2 提出 Commercial Harbor：p2 要選一種。 */
function harborExchange(): FrameFixture {
  const state = emptyCkGame(4);
  give(state, 'p1', { ore: 2, wool: 1 });
  giveCommodities(state, 'p2', { paper: 1, coin: 1 });
  giveCommodities(state, 'p3', { cloth: 2 });
  handCards(state, 'p1', ['commercialHarbor']);
  const played = playCard(state, 'p1', 'commercialHarbor');
  return fixture(
    'citiesKnights.harborExchange',
    actCk(played.state, 'p1', { type: 'progress.harborOffer', to: 'p2', resource: 'ore' }).state,
  );
}

/** p1 看 p2 的手牌（ore 2、grain 1、coin 1）拿 2 張。 */
function guildDues(): FrameFixture {
  const state = rankedGame();
  give(state, 'p2', { ore: 2, grain: 1 });
  giveCommodities(state, 'p2', { coin: 1 });
  handCards(state, 'p1', ['guildDues']);
  return fixture('citiesKnights.guildDues', playCard(state, 'p1', 'guildDues', { target: 'p2' }).state);
}

function espionage(): FrameFixture {
  const state = emptyCkGame(4);
  handCards(state, 'p1', ['espionage']);
  handCards(state, 'p2', ['taxation', 'crane']);
  return fixture('citiesKnights.espionage', playCard(state, 'p1', 'espionage', { target: 'p2' }).state);
}

/** p2 要棄 3 張（ore 3、wool 2、coin 1 的一半），p3、p4 的單一種類先自動棄掉。 */
function sabotage(): FrameFixture {
  const state = rankedGame();
  give(state, 'p2', { ore: 3, wool: 2 });
  giveCommodities(state, 'p2', { coin: 1 });
  give(state, 'p3', { grain: 3 });
  give(state, 'p4', { brick: 4 });
  handCards(state, 'p1', ['sabotage']);
  return fixture('citiesKnights.sabotage', playCard(state, 'p1', 'sabotage').state);
}

/** p2 要給 p1 兩張，p3 一張（單一種類，自動給）。 */
function wedding(): FrameFixture {
  const state = rankedGame();
  give(state, 'p2', { ore: 2, wool: 1 });
  give(state, 'p3', { grain: 1 });
  give(state, 'p4', { brick: 3 });
  handCards(state, 'p1', ['wedding']);
  return fixture('citiesKnights.wedding', playCard(state, 'p1', 'wedding').state);
}

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

/** p1 讓 p2 自己選一隻騎士移除。 */
function treasonRemove(): FrameFixture {
  const { state } = treasonGame();
  return fixture('citiesKnights.treasonRemove', playCard(state, 'p1', 'treason', { target: 'p2' }).state);
}

/** p2 移除了 3 級騎士，p1 要放置（或放棄）。 */
function treasonPlace(): FrameFixture {
  const { state, theirs } = treasonGame();
  const played = playCard(state, 'p1', 'treason', { target: 'p2' });
  return fixture(
    'citiesKnights.treasonPlace',
    actCk(played.state, 'p2', { type: 'progress.treasonRemove', vertex: theirs[1] }).state,
  );
}

/** p1 拆自己的一條路，可以免費重建。 */
function diplomacyRoad(): FrameFixture {
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
  return fixture('citiesKnights.diplomacyRoad', playCard(state, 'p1', 'diplomacy', { edge: myRoads[4] }).state);
}

/** 13 種真實 frame（不含只負責續行的 resolveRoll），依 kind 索引。 */
export const FRAME_FIXTURES: Readonly<Record<string, () => FrameFixture>> = {
  'citiesKnights.pillage': pillage,
  'citiesKnights.displaced': displaced,
  'citiesKnights.progressDiscard': progressDiscard,
  'citiesKnights.defenderDraw': defenderDraw,
  'citiesKnights.scienceBonus': scienceBonus,
  'citiesKnights.harborExchange': harborExchange,
  'citiesKnights.guildDues': guildDues,
  'citiesKnights.espionage': espionage,
  'citiesKnights.sabotage': sabotage,
  'citiesKnights.wedding': wedding,
  'citiesKnights.treasonRemove': treasonRemove,
  'citiesKnights.treasonPlace': treasonPlace,
  'citiesKnights.diplomacyRoad': diplomacyRoad,
};

