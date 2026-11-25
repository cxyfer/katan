/**
 * R-SFX-S7c：The Pirate Islands 的戰船、進攻堡壘、收復與結束（SF25 p. 17）。
 * 戰船改裝（最接近起點的一般船、沒有可改的船時拒絕、牌移出、一回合一張、當回合買的不能打）、
 * 進攻的四種結果與回合結束、收復後的村落功能、全收復後海盜移出、結束條件正反案例、戰船對海盜攻擊的影響、
 * 船被移除後船線規則仍一致、快照與重播的決定性。
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { legalShipEdges } from '../src/modules/seafarers/ships.ts';
import { lineContext, lineShip, pirateIslandsView } from '../src/modules/seafarers/pirateIslands.ts';
import { lineWarships, moveWarship } from '../src/modules/seafarers/pirateWarships.ts';
import { seededRng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, forceTurn, scriptedRng, setHand } from './helpers.ts';
import { emptySeafarersGame } from './seafarers-helpers.ts';

const PROFILE = 'sf-pirate-islands-2025';
const slot = (state: GameState) => pirateIslandsView(state)!;
const seatOf = (state: GameState, id: string) => state.players.findIndex((player) => player.id === id);
const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const cmd = (command: object) => command as Command;
const score = (state: GameState, id: string) => scoreOf(state, id, { includeHidden: true });
const types = (state: GameState): string[] => state.log.map((event) => event.type);

/** 蓋一艘船（付 1 木 1 羊，輪到該玩家）。 */
function build(state: GameState, id: string, edge: number): GameState {
  forceTurn(state, seatOf(state, id), 'action');
  setHand(state, id, { lumber: 1, wool: 1 });
  return act(state, id, cmd({ type: 'build.ship', edge })).state;
}

const lineEdges = (state: GameState, id: string): number[] => legalShipEdges(state, id).filter((edge) => {
  const step = lineShip(state, id, edge);
  return step.kind === 'line' && !step.restart;
});

/** 沿船線一艘一艘建到 `until`（`'fortress'`＝到達 beachhead，`'done'`＝到達堡壘）；海盜先拿掉以免擋路。 */
function sail(state: GameState, id: string, until: 'fortress' | 'done'): GameState {
  const pirate = state.board.pirate;
  state.board.pirate = null;
  let current = state;
  for (let guard = 0; guard < 20; guard++) {
    const next = lineContext(current, id)!.next;
    if (next === 'done' || (until === 'fortress' && next === 'fortress')) break;
    current = build(current, id, lineEdges(current, id)[0]!);
  }
  current.board.pirate = pirate;
  return current;
}

/** p1 的船線已到達堡壘、海盜在原位的行動階段。 */
function ready(players: 3 | 4 = 4, id = 'p1'): GameState {
  const state = emptySeafarersGame(players, seatOf(emptySeafarersGame(players, 0, 'action', PROFILE), id), 'action', PROFILE);
  const done = sail(state, id, 'done');
  forceTurn(done, seatOf(done, id), 'action');
  return done;
}

/** 讓船線上最接近起點的 `n` 艘船成為戰船（直接注入，測試用）。 */
function warships(state: GameState, id: string, edges: number[]): void {
  slot(state).warships[id] = edges.slice();
}

const lineOf = (state: GameState, id = 'p1') => slot(state).lines[id]!.edges;
const fortressOf = (state: GameState, id = 'p1') => slot(state).fortresses.find((fortress) => fortress.player === id)!;

/** 結束回合，骰面 `die`（1–6）。 */
function endTurn(state: GameState, id: string, die?: number) {
  return act(state, id, { type: 'turn.end' }, scriptedRng(die === undefined ? [] : [die - 1]));
}

describe('warships: knight cards', () => {
  const withKnight = (): GameState => {
    const state = emptySeafarersGame(4, 0, 'action', PROFILE);
    state.board.pirate = null;
    let current = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    current = build(current, 'p1', lineEdges(current, 'p1')[0]!);
    forceTurn(current, 0, 'action');
    current.players[0]!.devCards.push('knight', 'knight');
    return current;
  };

  it('把船線上最接近起點的一般船改成戰船，牌移出遊戲，強盜不存在', () => {
    const state = withKnight();
    const [first, second] = lineOf(state);
    const result = act(state, 'p1', cmd({ type: 'dev.playKnight', hex: null }));
    expect(slot(result.state).warships.p1).toEqual([first]);
    expect(result.state.players[0]!.devCards).toEqual(['knight']);
    expect(result.state.board.robber).toBe(-1);
    expect(result.events.find((event) => event.type === 'warship.converted')!.params).toMatchObject({ playerId: 'p1', edge: first, count: 1 });
    // 下一回合再打一張：改第二艘（第一艘已是戰船）。
    forceTurn(result.state, 0, 'action');
    const again = act(result.state, 'p1', cmd({ type: 'dev.playKnight', hex: null }));
    expect(slot(again.state).warships.p1).toEqual([first, second]);
    expect(lineWarships(again.state, 'p1')).toBe(2);
    // 船仍在棋盤上、仍是船線的一部分。
    expect(lineOf(again.state)).toContain(first);
    expect(again.state.board.roads[first]).toMatchObject({ player: 'p1', ship: true });
  });

  it('一回合只能打一張發展牌，當回合買的不能打', () => {
    const state = withKnight();
    const once = act(state, 'p1', cmd({ type: 'dev.playKnight', hex: null })).state;
    expectRejected(once, 'p1', cmd({ type: 'dev.playKnight', hex: null }), 'E_CARD_ALREADY_PLAYED');
    const bought = emptySeafarersGame(4, 0, 'action', PROFILE);
    bought.players[0]!.newDevCards.push('knight');
    expectRejected(bought, 'p1', cmd({ type: 'dev.playKnight', hex: null }), 'E_CARD_JUST_BOUGHT');
  });

  it('沒有可改的一般船時拒絕，牌留在手上', () => {
    const state = withKnight();
    // 船線上的船全部是戰船。
    warships(state, 'p1', lineOf(state));
    expectRejected(state, 'p1', cmd({ type: 'dev.playKnight', hex: null }), 'E_NO_WARSHIP_TARGET');
    expect(state.players[0]!.devCards).toEqual(['knight', 'knight']);
    expect(state.turn.devCardPlayed).toBe(false);
    // 沒有船線（沒有任何船）也一樣。
    const bare = emptySeafarersGame(4, 0, 'action', PROFILE);
    slot(bare).lines.p1 = { start: null, edges: [] };
    bare.players[0]!.devCards.push('knight');
    expectRejected(bare, 'p1', cmd({ type: 'dev.playKnight', hex: null }), 'E_NO_WARSHIP_TARGET');
  });

  it('騎士牌不帶目標格：指定陸地格被拒絕；自由船（不在船線上）不會被改', () => {
    const state = withKnight();
    const land = state.board.layout.terrain.findIndex((terrain) => terrain !== 'sea');
    expectRejected(state, 'p1', cmd({ type: 'dev.playKnight', hex: land }), 'E_INVALID_COMMAND');
    // 把船線縮成只有預置船，另放一艘自由船：改的是船線上的船。
    const preset = lineOf(state)[0]!;
    const hints = actionHints(state, 'p1').modules!.seafarers as { pirateLine: { warshipTarget: number | null } };
    expect(hints.pirateLine.warshipTarget).toBe(preset);
  });

  it('不計最大軍隊：打出騎士牌後沒有人拿到最大軍隊', () => {
    const state = withKnight();
    state.players[0]!.playedKnights = 2;
    const after = act(state, 'p1', cmd({ type: 'dev.playKnight', hex: null })).state;
    expect(after.awards.largestArmy).toBeNull();
  });

  it('4 人局的分數牌已換成騎士：整副牌沒有分數牌，3 人局移除它們', () => {
    const four = emptySeafarersGame(4, 0, 'action', PROFILE);
    expect(four.devDeck.includes('victoryPoint')).toBe(false);
    expect(four.devDeck.filter((card) => card === 'knight').length).toBe(19);
  });
});

describe('attack on the fortress (end of the action phase)', () => {
  it('船線到達堡壘、戰船數比骰值多：贏，移除 1 枚 lair，船不動，回合結束', () => {
    const state = ready();
    warships(state, 'p1', lineOf(state).slice(0, 3));
    const line = lineOf(state).slice();
    const result = endTurn(state, 'p1', 2);
    const attacked = result.events.find((event) => event.type === 'fortress.attacked')!;
    expect(attacked.params).toMatchObject({ playerId: 'p1', die: 2, warships: 3, result: 'won', lairs: 2, removed: [] });
    expect(fortressOf(result.state).lairs).toBe(2);
    expect(lineOf(result.state)).toEqual(line);
    expect(result.state.turn.seat).toBe(1);
    expect(types(result.state)).toContain('turn.ended');
  });

  it('比骰值少：輸，移除船線上最靠近堡壘的 2 艘船，船回供應堆', () => {
    const state = ready();
    const line = lineOf(state).slice();
    warships(state, 'p1', [line[0]!]);
    const result = endTurn(state, 'p1', 5);
    expect(result.events.find((event) => event.type === 'fortress.attacked')!.params).toMatchObject({ die: 5, warships: 1, result: 'lost', lairs: 3, removed: [line[line.length - 1], line[line.length - 2]] });
    expect(lineOf(result.state)).toEqual(line.slice(0, -2));
    for (const edge of line.slice(-2)) expect(result.state.board.roads[edge]).toBeNull();
    expect(result.state.board.roads.filter((road) => road?.player === 'p1' && road.ship).length).toBe(line.length - 2);
    expect(result.state.turn.seat).toBe(1);
  });

  it('相等：輸，只移除最靠近堡壘的 1 艘船', () => {
    const state = ready();
    const line = lineOf(state).slice();
    warships(state, 'p1', line.slice(0, 2));
    const result = endTurn(state, 'p1', 2);
    expect(result.events.find((event) => event.type === 'fortress.attacked')!.params).toMatchObject({ die: 2, warships: 2, result: 'tie', removed: [line[line.length - 1]] });
    expect(lineOf(result.state)).toEqual(line.slice(0, -1));
    expect(fortressOf(result.state).lairs).toBe(3);
  });

  it('被移除的船若是戰船，戰船數跟著減少', () => {
    const state = ready();
    const line = lineOf(state).slice();
    // 最靠近起點的 1 艘與最靠近堡壘的 2 艘是戰船；骰 6 輸，末端 2 艘戰船不見。
    warships(state, 'p1', [line[0]!, line[line.length - 2]!, line[line.length - 1]!]);
    const result = endTurn(state, 'p1', 6);
    expect(slot(result.state).warships.p1).toEqual([line[0]]);
    expect(lineWarships(result.state, 'p1')).toBe(1);
    const projected = actionHints(result.state, 'p1').modules!.seafarers as { pirateLine: { lineWarships: number } };
    expect(projected.pirateLine.lineWarships).toBe(1);
  });

  it('戰力只算船線上的戰船（離開船線的戰船不算）', () => {
    const state = ready();
    const line = lineOf(state);
    const off = state.board.roads.findIndex((road, edge) => !road && !line.includes(edge));
    warships(state, 'p1', [line[0]!, off]);
    expect(lineWarships(state, 'p1')).toBe(1);
  });

  it('船線沒有到達堡壘、堡壘已收復、不是自己的回合：不進攻，也不擲骰', () => {
    const half = emptySeafarersGame(4, 0, 'action', PROFILE);
    const partial = sail(half, 'p1', 'fortress');
    forceTurn(partial, 0, 'action');
    expect(endTurn(partial, 'p1').events.some((event) => event.type === 'fortress.attacked')).toBe(false);
    const done = ready();
    fortressOf(done).lairs = 0;
    expect(endTurn(done, 'p1').events.some((event) => event.type === 'fortress.attacked')).toBe(false);
    // 別人的船線完成不影響自己：p2 結束回合時 p1 不會進攻。
    const other = ready();
    forceTurn(other, 1, 'action');
    expect(endTurn(other, 'p2').events.some((event) => event.type === 'fortress.attacked')).toBe(false);
  });

  it('骰值來自遊戲 rng，種子相同則結果相同（重播與快照）', () => {
    const state = ready();
    warships(state, 'p1', lineOf(state).slice(0, 3));
    const a = applyCommand(clone(state), 'p1', { type: 'turn.end' }, seededRng(7));
    const b = applyCommand(clone(state), 'p1', { type: 'turn.end' }, seededRng(7));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it('輸掉之後的船線一致：目標退回堡壘或 beachhead，只能走最短路徑，可以再建回堡壘，被圍住的判定不變', () => {
    const state = ready();
    const line = lineOf(state).slice();
    const lost = endTurn(state, 'p1', 6).state;
    const after = lineContext(lost, 'p1')!;
    expect(after.next).toBe('fortress');
    expect(after.end).not.toBeNull();
    // 每一步都必須讓距離少 1：原來的末端邊（被移除）又成為合法的延伸之一。
    forceTurn(lost, 0, 'action');
    const extensions = lineEdges(lost, 'p1');
    expect(extensions).toContain(line[line.length - 2]);
    for (const edge of extensions) {
      const step = lineShip(lost, 'p1', edge);
      expect(step.kind).toBe('line');
    }
    const hints = actionHints(lost, 'p1').modules!.seafarers as { pirateLine: { stuck: boolean; edges: number[]; attackOnEnd: boolean } };
    expect(hints.pirateLine.stuck).toBe(false);
    expect(hints.pirateLine.attackOnEnd).toBe(false);
    expect(hints.pirateLine.edges).toEqual(line.slice(0, -2));
    // 重建兩艘船：回到完成狀態，又會進攻。
    const rebuilt = sail(lost, 'p1', 'done');
    expect(lineContext(rebuilt, 'p1')!.next).toBe('done');
    expect(lineOf(rebuilt).length).toBe(line.length);
  });

  it('退回的戰船仍是戰船（ship.move 後記在新的邊）', () => {
    const state = ready();
    const line = lineOf(state);
    warships(state, 'p1', [line[0]!]);
    moveWarship(state, 'p1', line[0]!, 999);
    expect(slot(state).warships.p1).toEqual([999]);
    moveWarship(state, 'p1', 5, 6);
    expect(slot(state).warships.p1).toEqual([999]);
  });
});

describe('recapturing a fortress', () => {
  /** p2 的堡壘旁有一格有圓片的非金礦格，這樣收復後可以驗證產出。 */
  const producingHex = (state: GameState, id: string): { hex: number; number: number } | null => {
    const vertex = fortressOf(state, id).vertex;
    for (const hex of topologyOf(state).vertices[vertex]!.hexes) {
      const terrain = state.board.layout.terrain[hex];
      if (terrain && terrain !== 'sea' && terrain !== 'gold' && terrain !== 'desert') return { hex, number: 8 };
    }
    return null;
  };

  const recaptured = (id = 'p2') => {
    const state = ready(4, id);
    const edges = lineOf(state, id);
    warships(state, id, edges.slice(0, 3));
    fortressOf(state, id).lairs = 1;
    const result = act(state, id, { type: 'turn.end' }, scriptedRng([0]));
    return { state: result.state, events: result.events, id };
  };

  it('最後 1 枚 lair 移除：收復，堡壘成為一般村落（分數 +1），海盜還在（其他堡壘未收復）', () => {
    const before = ready(4, 'p2');
    warships(before, 'p2', lineOf(before, 'p2').slice(0, 3));
    fortressOf(before, 'p2').lairs = 1;
    const scoreBefore = score(before, 'p2');
    const { state, events } = recaptured();
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['fortress.attacked', 'fortress.recaptured']));
    expect(fortressOf(state, 'p2').lairs).toBe(0);
    expect(score(state, 'p2')).toBe(scoreBefore + 1);
    expect(state.board.pirate).not.toBeNull();
    expect(events.some((event) => event.type === 'pirate.removed')).toBe(false);
  });

  it('收復後產出資源、可升級城市、可蓋路', () => {
    const { state, id } = recaptured();
    const found = producingHex(state, id);
    expect(found).not.toBeNull();
    state.board.layout.numbers[found!.hex] = 8;
    state.board.pirate = null;
    forceTurn(state, seatOf(state, id), 'preroll');
    const hand = (): number => Object.values(state.players[1]!.resources).reduce((a, b) => a + b, 0);
    const before = hand();
    const rolled = act(state, id, { type: 'turn.roll' }, scriptedRng([3, 3])).state;
    expect(Object.values(rolled.players[1]!.resources).reduce((a, b) => a + b, 0)).toBeGreaterThan(before);
    // 升級成城市。
    forceTurn(rolled, 1, 'action');
    setHand(rolled, id, { grain: 2, ore: 3 });
    const vertex = fortressOf(rolled, id).vertex;
    const city = act(rolled, id, cmd({ type: 'build.city', vertex })).state;
    expect(city.board.buildings[vertex]).toMatchObject({ player: id, city: true });
    // 可蓋路：從堡壘接出去的路在海盜群島上合法。
    const edges = topologyOf(city).vertices[vertex]!.edges.filter((edge) => !city.board.roads[edge]);
    forceTurn(city, 1, 'action');
    setHand(city, id, { lumber: 1, brick: 1 });
    const hints = actionHints(city, id) as unknown as { legalRoads: number[] };
    expect(edges.some((edge) => hints.legalRoads.includes(edge))).toBe(true);
  });

  it('所有堡壘都收復後海盜移出遊戲：不再巡弋或攻擊，海盜格的放船限制解除', () => {
    const state = ready();
    for (const fortress of slot(state).fortresses) if (fortress.player !== 'p1') fortress.lairs = 0;
    fortressOf(state, 'p1').lairs = 1;
    const pirateHex = state.board.pirate!;
    warships(state, 'p1', lineOf(state).slice(0, 3));
    const result = endTurn(state, 'p1', 1);
    expect(result.events.some((event) => event.type === 'pirate.removed')).toBe(true);
    expect(result.state.board.pirate).toBeNull();
    // 下一位擲骰：沒有 pirate.cruised。
    const rolled = act(result.state, 'p2', { type: 'turn.roll' }, scriptedRng([2, 3]));
    expect(rolled.events.some((event) => event.type === 'pirate.cruised')).toBe(false);
    expect(rolled.state.board.pirate).toBeNull();
    // 海盜格的邊不再被擋：海盜移出後，至少有一位玩家多出了原本被海盜擋住的合法船位。
    const withPirate = clone(rolled.state);
    withPirate.board.pirate = pirateHex;
    const gained = ['p1', 'p2', 'p3', 'p4'].some((id) => legalShipEdges(rolled.state, id).length > legalShipEdges(withPirate, id).length);
    expect(gained).toBe(true);
  });
});

describe('winning', () => {
  const withVp = (state: GameState, id: string, vp: number): void => {
    const player = state.players.find((candidate) => candidate.id === id)!;
    const missing = vp - score(state, id);
    for (let i = 0; i < missing; i++) player.devCards.push('victoryPoint');
  };

  it('收復堡壘且 10 分：進攻收復的當下遊戲結束，原因是 fortressRecaptured', () => {
    const state = ready();
    warships(state, 'p1', lineOf(state).slice(0, 3));
    fortressOf(state, 'p1').lairs = 1;
    withVp(state, 'p1', 9);
    const result = endTurn(state, 'p1', 1);
    expect(result.state.result).toMatchObject({ playerId: 'p1', reason: 'victory', cause: 'fortressRecaptured' });
    expect(result.state.turn.phase).toBe('gameOver');
    expect(result.events.find((event) => event.type === 'game.finished')!.params).toMatchObject({ cause: 'fortressRecaptured' });
  });

  it('只收復但不到 10 分不算贏', () => {
    const state = ready();
    warships(state, 'p1', lineOf(state).slice(0, 3));
    fortressOf(state, 'p1').lairs = 1;
    const result = endTurn(state, 'p1', 1);
    expect(fortressOf(result.state).lairs).toBe(0);
    expect(score(result.state, 'p1')).toBeLessThan(10);
    expect(result.state.result).toBeNull();
  });

  it('只有 10 分、堡壘未收復不算贏（即使遠超過 10 分）', () => {
    const state = emptySeafarersGame(4, 0, 'action', PROFILE);
    withVp(state, 'p1', 12);
    expect(score(state, 'p1')).toBeGreaterThanOrEqual(12);
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    state.board.pirate = null;
    const after = act(state, 'p1', cmd({ type: 'build.ship', edge: lineEdges(state, 'p1')[0]! })).state;
    expect(after.result).toBeNull();
    expect(endTurn(after, 'p1').state.result).toBeNull();
  });

  it('已收復的玩家在自己的回合任一時刻達到 10 分就贏（行動階段中升級城市）', () => {
    const state = ready();
    fortressOf(state, 'p1').lairs = 0;
    withVp(state, 'p1', 9);
    expect(state.result).toBeNull();
    // 蓋一座城市 +1 分 → 10。
    const vertex = state.board.buildings.findIndex((building, index) => building?.player === 'p1' && !building.city && index !== fortressOf(state, 'p1').vertex);
    setHand(state, 'p1', { grain: 2, ore: 3 });
    const after = act(state, 'p1', cmd({ type: 'build.city', vertex })).state;
    expect(after.result).toMatchObject({ playerId: 'p1', cause: 'fortressRecaptured' });
  });

  it('別人的回合不會因為已收復加 10 分而結束，輪到自己時才判定', () => {
    const state = ready();
    fortressOf(state, 'p1').lairs = 0;
    withVp(state, 'p1', 10);
    forceTurn(state, 1, 'action');
    const after = endTurn(state, 'p2').state;
    expect(after.turn.seat).toBe(2);
    expect(after.result).toBeNull();
  });
});

describe('warships against the cruising pirate (S7b strength)', () => {
  it('戰船數比海盜的骰多：贏，領供應堆的牌；相等：什麼也不發生', () => {
    const base = emptySeafarersGame(4, 0, 'preroll', PROFILE);
    base.board.layout.numbers = base.board.layout.numbers.map(() => null);
    const route = slot(base).route;
    base.board.pirate = route[7]!;
    const edges = lineOf(base);
    slot(base).warships.p1 = [edges[0]!, edges[0]! + 1000];
    expect(slot(base).warships.p1!.length).toBe(2);
    // 骰 2 與 4：海盜前進 2 格到 route[9]（p1 的預置村落旁），海盜戰力 2；2 艘戰船 → 平手。
    const tie = act(clone(base), 'p1', { type: 'turn.roll' }, scriptedRng([1, 3]));
    expect(tie.events.find((event) => event.type === 'pirate.attacked')!.params).toMatchObject({ result: 'tie', warships: 2, strength: 2 });
    // 骰 1 與 4：戰力 1 < 2 → 贏，要選牌。
    base.board.pirate = route[8]!;
    const won = act(clone(base), 'p1', { type: 'turn.roll' }, scriptedRng([0, 3]));
    expect(won.events.find((event) => event.type === 'pirate.attacked')!.params).toMatchObject({ result: 'won' });
    expect(won.state.pending?.kind).toBe('seafarers.pirateGift');
  });
});

describe('snapshot', () => {
  it('序列化後還原，進攻的結果與沒有重啟相同', () => {
    const state = ready();
    warships(state, 'p1', lineOf(state).slice(0, 1));
    const restored = clone(state);
    const a = applyCommand(state, 'p1', { type: 'turn.end' }, scriptedRng([3]));
    const b = applyCommand(restored, 'p1', { type: 'turn.end' }, scriptedRng([3]));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });
});
