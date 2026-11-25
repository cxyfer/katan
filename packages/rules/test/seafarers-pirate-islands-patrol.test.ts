/**
 * R-SFX-S7b：The Pirate Islands 的巡弋海盜與攻擊（SF25 p. 16）。
 * 移動步數（較小的骰、雙骰同點、繞回航道起點）、攻擊判定（相鄰、多人、城市額外棄牌、手牌不足、平手、
 * 玩家較強時的選牌 frame）、時間順序（先移動與攻擊，再收資源，再處理 7）、7 的偷牌（任一玩家、可不偷、無對象）、
 * 重播的決定性，以及其他劇本不受影響（D7 的完整回歸在 seafarers-exports.test.ts）。
 * 戰船要到 S7c 才有指令，這裡以注入 `warships` 資料測試戰力比較。
 */

import { describe, expect, it } from 'vitest';
import { topologyOf, totalCards } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { attackedPlayers, pirateDie, routeAdvance } from '../src/modules/seafarers/pirateCruise.ts';
import { pirateIslandsView, warshipCount } from '../src/modules/seafarers/pirateIslands.ts';
import { projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import { RESOURCES, type GameEvent, type GameState, type Resource } from '../src/types.ts';
import { act, expectRejected, forceTurn, scriptedRng, setHand } from './helpers.ts';
import { emptySeafarersGame, settle } from './seafarers-helpers.ts';

const PROFILE = 'sf-pirate-islands-2025';
/** 不讓任何格產出（圓片全拿掉），這樣手牌的變化只來自海盜、棄牌與偷牌。 */
const ready = (players: 3 | 4 = 4, seat = 0) => {
  const state = emptySeafarersGame(players, seat, 'preroll', PROFILE);
  state.board.layout.numbers = state.board.layout.numbers.map(() => null);
  return state;
};
const route = (state: GameState) => pirateIslandsView(state)!.route;
const seatOf = (state: GameState, id: string) => state.players.findIndex((player) => player.id === id);
const cmd = (command: object) => command as Command;

/** 航道第 `index` 格的海格上，沒有被建築佔用的交叉點。 */
function freeVertex(state: GameState, hex: number): number {
  const vertex = topologyOf(state).vertices.findIndex((candidate, index) => candidate.hexes.includes(hex) && !state.board.buildings[index]);
  expect(vertex).toBeGreaterThanOrEqual(0);
  return vertex;
}

/** 擲骰（`dice` 是骰面 1–6），`extra` 是之後引擎抽隨機數的腳本（棄牌）。 */
function roll(state: GameState, playerId: string, dice: [number, number], extra: number[] = []): { state: GameState; events: GameEvent[] } {
  forceTurn(state, seatOf(state, playerId), 'preroll');
  return act(state, playerId, { type: 'turn.roll' }, scriptedRng([dice[0] - 1, dice[1] - 1, ...extra]));
}

const types = (state: GameState): string[] => state.log.map((event) => event.type);
const total = (state: GameState, id: string) => totalCards(state.players.find((player) => player.id === id)!);

/** 把海盜放到航道第 `index` 格（測試用：模擬之前已走到那裡）。 */
function pirateAt(state: GameState, index: number): void {
  state.board.pirate = route(state)[index]!;
}

describe('pirate movement', () => {
  it('起點是航道第一格，步數是較小的骰', () => {
    const state = ready();
    expect(state.board.pirate).toBe(route(state)[0]);
    // 骰 2 與 5 → 較小的 2；航道第 2 格沒有任何建築。
    const rolled = roll(state, 'p1', [2, 5]);
    // 2 + 5 = 7：另外會處理 7，但海盜先移動
    expect(rolled.state.board.pirate).toBe(route(state)[2]);
    const moved = rolled.events.find((event) => event.type === 'pirate.cruised')!;
    expect(moved.params).toMatchObject({ from: route(state)[0], to: route(state)[2], steps: 2, dice: [2, 5] });
  });

  it('兩顆骰相同時取該點數', () => {
    const state = ready();
    const rolled = roll(state, 'p1', [3, 3]);
    expect(rolled.state.board.pirate).toBe(route(state)[3]);
    expect(rolled.events.find((event) => event.type === 'pirate.cruised')!.params.steps).toBe(3);
  });

  it('跨過航道終點時繞回起點（14 格一圈）', () => {
    const state = ready();
    pirateAt(state, 12);
    // 4 步：12 → 16 mod 14 = 2
    expect(roll(state, 'p1', [4, 6]).state.board.pirate).toBe(route(state)[2]);
    pirateAt(state, 13);
    expect(roll(state, 'p2', [5, 4]).state.board.pirate).toBe(route(state)[3]);
  });

  it('輔助函式：步數、繞回、戰力', () => {
    expect(pirateDie([6, 2])).toBe(2);
    expect(pirateDie([4, 4])).toBe(4);
    const r = Array.from({ length: 14 }, (_, i) => 100 + i);
    expect(routeAdvance(r, 13, 1)).toBe(0);
    expect(routeAdvance(r, 0, 6)).toBe(6);
    expect(routeAdvance(r, 10, 6)).toBe(2);
  });

  it('連續擲骰沿航道前進，走滿一圈回到同一格，永遠停在航道上', () => {
    let state = ready();
    const rolls: [number, number][] = [[1, 6], [2, 3], [4, 6], [3, 3], [5, 6], [2, 6], [1, 2]];
    const visited: number[] = [];
    let index = 0;
    for (const dice of rolls) {
      state = roll(state, 'p1', dice).state;
      // 7 之外的結果可能有 frame：全部以不偷、不選的方式結束
      state.pending = null;
      delete state.pendingQueue;
      index = (index + Math.min(...dice)) % 14;
      expect(state.board.pirate).toBe(route(state)[index]);
      visited.push(index);
    }
    expect(new Set(visited.map((i) => route(state)[i])).size).toBeGreaterThan(3);
  });

  it('船不能放在海盜所在格的邊上，也不能移到那裡（基礎規則仍成立）', () => {
    const state = ready(4, 0);
    const pirate = route(state)[6]!;
    state.board.pirate = pirate;
    forceTurn(state, 0, 'action');
    const hints = actionHints(state, 'p1').modules!.seafarers as { legalShips: number[] };
    const topo = topologyOf(state);
    for (const edge of hints.legalShips) expect(topo.edges[edge]!.hexes).not.toContain(pirate);
  });

  it('其他玩家的船在海盜走過去之後不受影響（只有新放與移動受限）', () => {
    const state = ready();
    const ships = state.board.roads.filter((road) => road?.ship).length;
    const rolled = roll(state, 'p1', [1, 2]).state;
    expect(rolled.board.roads.filter((road) => road?.ship).length).toBe(ships);
  });
});

describe('pirate attacks', () => {
  /** 航道上 route[9] 在 p1 預置村落旁（4 人局），route[7] 往前 2 步。 */
  const attackSetup = () => {
    const state = ready();
    pirateAt(state, 7);
    return state;
  };

  it('相鄰的玩家被攻擊：海盜較強，隨機棄 1 張，回到供應堆', () => {
    const state = attackSetup();
    expect(attackedPlayers(state, route(state)[9]!, 'p1')).toEqual(['p1']);
    setHand(state, 'p1', { lumber: 2, brick: 1 });
    const bankBefore = RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);
    // 骰 2、4 → 步數 2、海盜戰力 2；棄牌抽第 0 張（lumber）
    const rolled = roll(state, 'p1', [2, 4], [0]);
    expect(rolled.state.board.pirate).toBe(route(state)[9]);
    expect(rolled.state.players[0]!.resources).toMatchObject({ lumber: 1, brick: 1 });
    expect(RESOURCES.reduce((sum, resource) => sum + rolled.state.bank[resource], 0)).toBe(bankBefore + 1);
    const attacked = rolled.events.find((event) => event.type === 'pirate.attacked')!;
    expect(attacked.params).toMatchObject({ playerId: 'p1', strength: 2, warships: 0, result: 'lost', cities: 0, count: 1, owed: 1 });
    // 只有受害者看得到被棄的牌
    expect(attacked.private).toEqual({ to: ['p1'], params: { resources: { lumber: 1 } } });
  });

  it('沒有相鄰建築的格不攻擊', () => {
    const state = ready();
    setHand(state, 'p1', { lumber: 3 });
    const rolled = roll(state, 'p1', [2, 4]);
    expect(types(rolled.state)).not.toContain('pirate.attacked');
    expect(total(rolled.state, 'p1')).toBe(3);
  });

  it('每擁有一座城市多棄 1 張（城市不一定相鄰）', () => {
    const state = attackSetup();
    settle(state, 'p1', freeVertex(state, route(state)[1]!), true);
    settle(state, 'p1', freeVertex(state, route(state)[2]!), true);
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 1 });
    // 1 + 2 座城市 = 3 張；依序抽第 0、0、0 張（lumber、brick、wool）
    const rolled = roll(state, 'p1', [2, 4], [0, 0, 0]);
    expect(rolled.state.players[0]!.resources).toEqual({ lumber: 0, brick: 0, wool: 0, grain: 1, ore: 1 });
    const attacked = rolled.events.find((event) => event.type === 'pirate.attacked')!;
    expect(attacked.params).toMatchObject({ cities: 2, count: 3, owed: 3 });
  });

  it('手牌不夠就全棄；沒有牌也照樣記錄攻擊', () => {
    const poor = attackSetup();
    settle(poor, 'p1', freeVertex(poor, route(poor)[1]!), true);
    setHand(poor, 'p1', { grain: 1 });
    const rolled = roll(poor, 'p1', [2, 4], [0]);
    expect(total(rolled.state, 'p1')).toBe(0);
    expect(rolled.events.find((event) => event.type === 'pirate.attacked')!.params).toMatchObject({ count: 1, owed: 2 });
    const empty = attackSetup();
    setHand(empty, 'p1', {});
    const none = roll(empty, 'p1', [2, 4]);
    expect(none.events.find((event) => event.type === 'pirate.attacked')!.params).toMatchObject({ result: 'lost', count: 0, owed: 1 });
  });

  it('多位玩家同時相鄰：每一位都處理，從擲骰者起依座位順序', () => {
    const state = attackSetup();
    const hex = route(state)[9]!;
    // p1 已在旁；再讓 p2、p4 在同一格旁各有一座村落（直接放，不走距離規則）
    const spare = topologyOf(state).vertices.map((vertex, index) => (vertex.hexes.includes(hex) && !state.board.buildings[index] ? index : -1)).filter((index) => index >= 0);
    settle(state, 'p2', spare[0]!);
    settle(state, 'p4', spare[1]!);
    expect(attackedPlayers(state, hex, 'p2')).toEqual(['p2', 'p4', 'p1']);
    expect(attackedPlayers(state, hex, 'p1')).toEqual(['p1', 'p2', 'p4']);
    expect(attackedPlayers(state, hex, 'p3')).toEqual(['p4', 'p1', 'p2']);
    for (const id of ['p1', 'p2', 'p4']) setHand(state, id, { lumber: 3 });
    const rolled = roll(state, 'p2', [2, 4], [0, 0, 0]);
    const order = rolled.events.filter((event) => event.type === 'pirate.attacked').map((event) => event.params.playerId);
    expect(order).toEqual(['p2', 'p4', 'p1']);
    for (const id of ['p1', 'p2', 'p4']) expect(total(rolled.state, id)).toBe(2);
  });

  it('未收復的堡壘是海盜的，不算被攻擊的建築；收復後才算', () => {
    const state = ready();
    const slot = pirateIslandsView(state)!;
    const fortress = slot.fortresses[0]!;
    const hex = topologyOf(state).vertices[fortress.vertex]!.hexes.find((candidate) => state.board.layout.terrain[candidate] !== 'sea')!;
    // 找一個與堡壘相鄰的海格（海盜不在航道上也能判斷）
    const sea = topologyOf(state).vertices[fortress.vertex]!.hexes.filter((candidate) => state.board.layout.terrain[candidate] === 'sea');
    expect(hex).toBeDefined();
    for (const candidate of sea) expect(attackedPlayers(state, candidate, fortress.player)).toEqual([]);
    fortress.lairs = 0;
    for (const candidate of sea) expect(attackedPlayers(state, candidate, fortress.player)).toEqual([fortress.player]);
    // 預置的航道上，沒有任何一格與堡壘相鄰（版圖資料）
    const fresh = ready();
    const vertices = pirateIslandsView(fresh)!.fortresses.map((entry) => entry.vertex);
    for (const hexIndex of route(fresh)) {
      for (const vertex of vertices) expect(topologyOf(fresh).vertices[vertex]!.hexes).not.toContain(hexIndex);
    }
  });

  it('預置村落所在的航道格：每位玩家各有一格會被攻擊', () => {
    const state = ready();
    const owners = route(state).map((hex) => attackedPlayers(state, hex, 'p1'));
    expect(owners.filter((list) => list.length > 0).flat().sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('玩家較強：排選牌 frame，先選完才收資源；供應堆少一張', () => {
    const state = attackSetup();
    pirateIslandsView(state)!.warships.p1 = [1, 2, 3];
    expect(warshipCount(state, 'p1')).toBe(3);
    // 骰 2、4 → 戰力 2 < 3
    const rolled = roll(state, 'p1', [2, 4]);
    expect(rolled.state.pending).toMatchObject({ kind: 'seafarers.pirateGift', responders: ['p1'] });
    expect(types(rolled.state)).not.toContain('production.resolved');
    expect(rolled.events.find((event) => event.type === 'pirate.attacked')!.params).toMatchObject({ result: 'won', strength: 2, warships: 3 });
    const hints = actionHints(rolled.state, 'p1').modules!.seafarers as { pirateGift: Resource[]; sevenSteal: string[] };
    expect(hints.pirateGift).toEqual([...RESOURCES]);
    expect((actionHints(rolled.state, 'p2').modules!.seafarers as { pirateGift: Resource[] }).pirateGift).toEqual([]);
    // 公開的 frame：只有海盜戰力
    const view = projectGame(rolled.state, 'p3').pending as { kind: string; data: object };
    expect(view).toMatchObject({ kind: 'seafarers.pirateGift', data: { strength: 2 } });

    const bank = rolled.state.bank.ore;
    const picked = act(rolled.state, 'p1', cmd({ type: 'pirate.gift', resource: 'ore' }));
    expect(picked.state.players[0]!.resources.ore).toBe(1);
    expect(picked.state.bank.ore).toBe(bank - 1);
    expect(picked.state.pending).toBeNull();
    expect(picked.events.map((event) => event.type)).toEqual(['pirate.gifted', 'production.resolved']);
  });

  it('選牌的錯誤：非當事人、不存在的資源、供應堆沒有那種牌', () => {
    const state = attackSetup();
    pirateIslandsView(state)!.warships.p1 = [1, 2, 3];
    const rolled = roll(state, 'p1', [2, 4]).state;
    expectRejected(rolled, 'p2', cmd({ type: 'pirate.gift', resource: 'ore' }), 'E_NOT_ACTOR');
    expectRejected(rolled, 'p1', cmd({ type: 'pirate.gift', resource: 'gold' }), 'E_INVALID_SELECTION');
    expectRejected(rolled, 'p1', cmd({ type: 'pirate.gift' }), 'E_INVALID_SELECTION');
    rolled.bank.ore = 0;
    expectRejected(rolled, 'p1', cmd({ type: 'pirate.gift', resource: 'ore' }), 'E_BANK_EMPTY');
    // 選牌 frame 還沒答完，其他指令照一般規則被擋
    expectRejected(rolled, 'p1', { type: 'turn.end' }, 'E_PENDING_EFFECT');
    expect(actionHints(rolled, 'p1').modules!.seafarers as { pirateGift: Resource[] }).toMatchObject({ pirateGift: ['lumber', 'brick', 'wool', 'grain'] });
  });

  it('供應堆完全沒牌：什麼都拿不到，記錄後繼續', () => {
    const state = attackSetup();
    pirateIslandsView(state)!.warships.p1 = [1, 2, 3];
    for (const resource of RESOURCES) state.bank[resource] = 0;
    const rolled = roll(state, 'p1', [2, 4]);
    expect(rolled.state.pending).toBeNull();
    expect(rolled.events.map((event) => event.type)).toContain('pirate.gifted');
    expect(rolled.events.find((event) => event.type === 'pirate.gifted')!.params).toEqual({ playerId: 'p1', resource: null });
    expect(rolled.events.map((event) => event.type).indexOf('pirate.gifted')).toBeLessThan(rolled.events.map((event) => event.type).indexOf('production.resolved'));
  });

  it('平手：什麼也不發生', () => {
    const state = attackSetup();
    pirateIslandsView(state)!.warships.p1 = [1, 2];
    setHand(state, 'p1', { lumber: 2 });
    const rolled = roll(state, 'p1', [2, 4]);
    expect(rolled.state.pending).toBeNull();
    expect(total(rolled.state, 'p1')).toBe(2);
    expect(rolled.events.find((event) => event.type === 'pirate.attacked')!.params).toMatchObject({ result: 'tie', strength: 2, warships: 2 });
  });

  it('贏與輸混在同一格：輸的立刻棄牌，贏的依序選牌，全部答完才收資源', () => {
    const state = attackSetup();
    const hex = route(state)[9]!;
    const spare = topologyOf(state).vertices.map((vertex, index) => (vertex.hexes.includes(hex) && !state.board.buildings[index] ? index : -1)).filter((index) => index >= 0);
    settle(state, 'p2', spare[0]!);
    settle(state, 'p4', spare[1]!);
    const slot = pirateIslandsView(state)!;
    slot.warships.p1 = [1, 2, 3];
    slot.warships.p4 = [4, 5, 6, 7];
    for (const id of ['p1', 'p2', 'p4']) setHand(state, id, { lumber: 2 });
    // 擲骰者 p1：順序 p1（贏）、p2（輸）、p4（贏）
    const rolled = roll(state, 'p1', [2, 4], [0]);
    expect(total(rolled.state, 'p2')).toBe(1);
    expect(rolled.state.pending).toMatchObject({ kind: 'seafarers.pirateGift', responders: ['p1'] });
    expect(rolled.state.pendingQueue?.map((frame) => frame.kind)).toEqual(['seafarers.pirateGift', 'seafarers.pirateResume']);
    expectRejected(rolled.state, 'p4', cmd({ type: 'pirate.gift', resource: 'wool' }), 'E_NOT_ACTOR');
    const first = act(rolled.state, 'p1', cmd({ type: 'pirate.gift', resource: 'wool' }));
    expect(first.state.pending).toMatchObject({ kind: 'seafarers.pirateGift', responders: ['p4'] });
    expect(types(first.state)).not.toContain('production.resolved');
    const second = act(first.state, 'p4', cmd({ type: 'pirate.gift', resource: 'grain' }));
    expect(second.state.pending).toBeNull();
    expect(second.state.pendingQueue).toBeUndefined();
    expect(second.state.players[0]!.resources.wool).toBe(1);
    expect(second.state.players[3]!.resources.grain).toBe(1);
    expect(types(second.state).lastIndexOf('production.resolved')).toBeGreaterThan(types(second.state).lastIndexOf('pirate.gifted'));
  });

  it('攻擊在收資源之前：紀錄的順序是移動、攻擊、收資源', () => {
    const state = attackSetup();
    setHand(state, 'p1', { lumber: 1 });
    // 骰 2 + 4 = 6：全盤生產 6 的格；棄牌（唯一的牌）一定先發生
    const rolled = roll(state, 'p1', [2, 4], [0]);
    const order = types(rolled.state);
    expect(order.lastIndexOf('pirate.cruised')).toBeLessThan(order.lastIndexOf('pirate.attacked'));
    expect(order.lastIndexOf('pirate.attacked')).toBeLessThan(order.lastIndexOf('production.resolved'));
  });
});

/** 圓片沒有被拿掉的版圖：4 號圓片的田野（東島）在紅方預置村落旁，擲出 4 時紅方產 1 張小麥。 */
const realBoard = () => emptySeafarersGame(4, 0, 'preroll', PROFILE);

describe('the attack comes before production, with real production (2 + 2)', () => {
  it('an empty-handed red has nothing to lose, then produces 1 grain: the hand ends with 1 grain, not an early grant', () => {
    const state = realBoard();
    pirateAt(state, 7);
    setHand(state, 'p1', {});
    const rolled = roll(state, 'p1', [2, 2]);
    const order = rolled.events.map((event) => event.type);
    expect(order.indexOf('pirate.attacked')).toBeLessThan(order.indexOf('production.resolved'));
    expect(rolled.events.find((event) => event.type === 'pirate.attacked')!.params).toMatchObject({ result: 'lost', count: 0, owed: 1 });
    // 若資源在攻擊前就發出，紅方會先有 1 張小麥而被棄掉：最後會是 0 張。
    expect(rolled.state.players[0]!.resources.grain).toBe(1);
    expect(total(rolled.state, 'p1')).toBe(1);
  });

  it('red holding 1 grain loses it first, then produces 1 grain: statistics match the hand', () => {
    const state = realBoard();
    pirateAt(state, 7);
    setHand(state, 'p1', { grain: 1 });
    const rolled = roll(state, 'p1', [2, 2], [0]);
    expect(rolled.state.players[0]!.resources.grain).toBe(1);
    const stats = rolled.state.stats!.players.p1!;
    expect(stats.discarded.grain).toBe(1);
    expect(stats.produced.grain).toBe(1);
    // 手牌 = 起始 1 + 生產 1 - 被海盜奪走 1
    expect(1 + stats.produced.grain - stats.discarded.grain).toBe(total(rolled.state, 'p1'));
  });

  it('a card taken from the supply for beating the pirate counts as income, and the 7’s steal as stolen/robbed', () => {
    const state = realBoard();
    pirateAt(state, 7);
    pirateIslandsView(state)!.warships.p1 = [1, 2, 3];
    setHand(state, 'p1', {});
    const rolled = roll(state, 'p1', [2, 2]);
    const picked = act(rolled.state, 'p1', cmd({ type: 'pirate.gift', resource: 'ore' })).state;
    const stats = picked.stats!.players.p1!;
    expect(stats.supplyPicks).toMatchObject({ ore: 1 });
    expect(stats.produced.grain).toBe(1);
    expect(picked.players[0]!.resources).toMatchObject({ ore: 1, grain: 1 });
    expect(total(picked, 'p1')).toBe(stats.supplyPicks!.ore + stats.produced.grain);
    // 其他劇本沒有這個欄位
    const other = emptySeafarersGame(3, 0, 'preroll', 'sf-forgotten-tribe-2025');
    expect(act(other, 'p1', { type: 'turn.roll' }, scriptedRng([1, 1])).state.stats?.players.p1?.supplyPicks).toBeUndefined();
  });
});

describe('passing a hex does not attack (SF25: only where the pirate ends)', () => {
  it('4 + 6 from route[7] passes P1’s village at route[9] and stops at route[11], which touches no building', () => {
    const state = ready();
    pirateAt(state, 7);
    expect(attackedPlayers(state, route(state)[9]!, 'p1')).toEqual(['p1']);
    expect(attackedPlayers(state, route(state)[11]!, 'p1')).toEqual([]);
    setHand(state, 'p1', { lumber: 2, brick: 1 });
    const rolled = roll(state, 'p1', [4, 6]);
    expect(rolled.state.board.pirate).toBe(route(state)[11]);
    expect(rolled.events.map((event) => event.type)).not.toContain('pirate.attacked');
    expect(rolled.state.players[0]!.resources).toMatchObject({ lumber: 2, brick: 1 });
    expect(rolled.state.pending).toBeNull();
  });
});

describe('restart with an answer pending (spec §11.3)', () => {
  const restore = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;

  it('2 + 5: the gift frame survives a restart, the queued continuation runs once, and the 7’s steal survives another', () => {
    const state = ready();
    pirateAt(state, 7);
    pirateIslandsView(state)!.warships.p1 = [1, 2, 3];
    setHand(state, 'p1', {});
    setHand(state, 'p2', { grain: 2 });
    const rolled = roll(state, 'p1', [2, 5]).state;
    expect(rolled.pending).toMatchObject({ kind: 'seafarers.pirateGift', responders: ['p1'] });
    expect(rolled.pendingQueue?.map((frame) => frame.kind)).toEqual(['seafarers.pirateResume']);
    // 重啟：只剩序列化的狀態。
    const afterRestart = restore(rolled);
    expectRejected(afterRestart, 'p2', cmd({ type: 'pirate.gift', resource: 'ore' }), 'E_NOT_ACTOR');
    const picked = act(afterRestart, 'p1', cmd({ type: 'pirate.gift', resource: 'ore' }));
    // 續接只跑一次：剛好一個 7 的偷牌 frame，沒有重複的移動、攻擊或棄牌。
    expect(picked.state.pending).toMatchObject({ kind: 'seafarers.sevenSteal', responders: ['p1'] });
    expect(picked.state.pendingQueue).toBeUndefined();
    const log = types(picked.state);
    expect(log.filter((type) => type === 'pirate.cruised')).toHaveLength(1);
    expect(log.filter((type) => type === 'pirate.attacked')).toHaveLength(1);
    expect(log.filter((type) => type === 'pirate.gifted')).toHaveLength(1);
    expect(picked.state.board.pirate).toBe(route(state)[9]);
    // 偷牌 frame 再重啟一次，然後偷 p2。
    const again = restore(picked.state);
    const stolen = act(again, 'p1', cmd({ type: 'seven.steal', victim: 'p2' }), scriptedRng([0]));
    expect(stolen.state.pending).toBeNull();
    expect(stolen.state.players[0]!.resources).toMatchObject({ ore: 1, grain: 1 });
    expect(stolen.state.players[1]!.resources.grain).toBe(1);
    expect(stolen.state.turn.phase).toBe('action');
    // 沒有重啟的路徑得到相同的結果。
    const direct = act(act(rolled, 'p1', cmd({ type: 'pirate.gift', resource: 'ore' })).state, 'p1', cmd({ type: 'seven.steal', victim: 'p2' }), scriptedRng([0]));
    expect(JSON.stringify(direct.state)).toBe(JSON.stringify(stolen.state));
  });
});

describe('resolving a 7', () => {
  const bigHands = (state: GameState) => {
    setHand(state, 'p2', { lumber: 3, brick: 3, wool: 2, grain: 2 });
    setHand(state, 'p3', { lumber: 2 });
    setHand(state, 'p4', {});
  };

  it('先海盜、再棄牌、最後擲骰者可偷任一位有牌的玩家（不看格子）', () => {
    const state = ready();
    bigHands(state);
    setHand(state, 'p1', { ore: 1 });
    const rolled = roll(state, 'p1', [3, 4]);
    expect(rolled.state.pending).toMatchObject({ kind: 'discard' });
    expect(rolled.state.board.pirate).toBe(route(state)[3]);
    expect(types(rolled.state).indexOf('pirate.cruised')).toBeLessThan(types(rolled.state).indexOf('discard.required'));
    // p2 有 10 張，棄一半
    const discarded = act(rolled.state, 'p2', { type: 'pending.discard', resources: ['lumber', 'lumber', 'lumber', 'brick', 'brick'] } as never);
    expect(discarded.state.pending).toMatchObject({ kind: 'seafarers.sevenSteal', responders: ['p1'] });
    const hints = actionHints(discarded.state, 'p1').modules!.seafarers as { sevenSteal: string[] };
    // 有牌的其他玩家：p2（5 張）、p3（2 張）；p4 沒牌
    expect(hints.sevenSteal).toEqual(['p2', 'p3']);
    expect(projectGame(discarded.state, 'p4').pending).toMatchObject({ kind: 'seafarers.sevenSteal', data: { victims: ['p2', 'p3'] } });
    expectRejected(discarded.state, 'p1', cmd({ type: 'seven.steal', victim: 'p4' }), 'E_NO_ELIGIBLE_VICTIM');
    expectRejected(discarded.state, 'p1', cmd({ type: 'seven.steal', victim: 'p1' }), 'E_NO_ELIGIBLE_VICTIM');
    expectRejected(discarded.state, 'p2', cmd({ type: 'seven.steal', victim: 'p3' }), 'E_NOT_ACTOR');
    const stolen = act(discarded.state, 'p1', cmd({ type: 'seven.steal', victim: 'p3' }), scriptedRng([1]));
    expect(stolen.state.players[2]!.resources.lumber).toBe(1);
    expect(stolen.state.players[0]!.resources.lumber).toBe(1);
    expect(stolen.state.pending).toBeNull();
    const event = stolen.events.find((entry) => entry.type === 'seven.stole')!;
    expect(event.params).toEqual({ playerId: 'p1', victim: 'p3' });
    expect(event.private).toEqual({ to: ['p1', 'p3'], params: { resource: 'lumber' } });
    expect(stolen.state.stats?.players.p1?.stolen.lumber).toBe(1);
  });

  it('沒有人要棄牌時直接進入偷牌；可以選擇不偷', () => {
    const state = ready();
    setHand(state, 'p2', { grain: 1 });
    const rolled = roll(state, 'p1', [3, 4]);
    expect(rolled.state.pending).toMatchObject({ kind: 'seafarers.sevenSteal', responders: ['p1'] });
    const skipped = act(rolled.state, 'p1', cmd({ type: 'seven.steal', victim: null }));
    expect(skipped.state.pending).toBeNull();
    expect(skipped.state.players[1]!.resources.grain).toBe(1);
    expect(skipped.events.map((event) => event.type)).toEqual(['seven.stealSkipped']);
  });

  it('沒有任何玩家有牌時跳過偷牌（沒有 frame）', () => {
    const state = ready();
    setHand(state, 'p1', { lumber: 4 });
    const rolled = roll(state, 'p1', [3, 4]);
    expect(rolled.state.pending).toBeNull();
    expect(rolled.state.turn.phase).toBe('action');
  });

  it('偷牌 frame 沒答完不能結束回合；也沒有強盜可以移', () => {
    const state = ready();
    setHand(state, 'p2', { grain: 1 });
    const rolled = roll(state, 'p1', [3, 4]).state;
    expectRejected(rolled, 'p1', { type: 'turn.end' }, 'E_PENDING_EFFECT');
    expectRejected(rolled, 'p1', { type: 'pending.moveRobber', hex: 0 } as never, 'E_PENDING_EFFECT');
    expect(rolled.board.robber).toBe(-1);
  });

  it('7 與攻擊同時：攻擊先棄牌，再依剩下的手牌棄一半', () => {
    const state = ready();
    pirateAt(state, 7);
    // 骰 2、5（共 7）：步數 2 → route[9]，p1 被攻擊
    setHand(state, 'p1', { lumber: 5, brick: 5 });
    const rolled = roll(state, 'p1', [2, 5], [0]);
    expect(rolled.state.players[0]!.resources).toEqual({ lumber: 4, brick: 5, wool: 0, grain: 0, ore: 0 });
    // 9 張 → 棄 4
    expect(rolled.state.pending).toMatchObject({ kind: 'discard', required: { p1: 4 } });
  });

  it('擲骰者自己在被攻擊後，贏的選牌先於 7 的棄牌', () => {
    const state = ready();
    pirateAt(state, 7);
    pirateIslandsView(state)!.warships.p1 = [1, 2, 3];
    setHand(state, 'p2', { lumber: 4, brick: 4 });
    const rolled = roll(state, 'p1', [2, 5]);
    expect(rolled.state.pending).toMatchObject({ kind: 'seafarers.pirateGift' });
    expect(types(rolled.state)).not.toContain('discard.required');
    const picked = act(rolled.state, 'p1', cmd({ type: 'pirate.gift', resource: 'wool' }));
    expect(picked.state.pending).toMatchObject({ kind: 'discard', required: { p2: 4 } });
  });
});

describe('determinism', () => {
  const play = (seed: number): GameState => {
    let state = ready();
    setHand(state, 'p1', { lumber: 3, brick: 3, wool: 3 });
    const rng = seededRng(seed);
    for (let turn = 0; turn < 12; turn += 1) {
      const id = state.players[turn % 4]!.id;
      forceTurn(state, turn % 4, 'preroll');
      const outcome = applyCommand(state, id, { type: 'turn.roll' }, rng);
      if (!outcome.ok) throw new Error(outcome.error.code);
      state = outcome.state;
      // 還有 frame：以最簡單的合法答案結束
      for (let guard = 0; state.pending && guard < 10; guard += 1) {
        const pending = state.pending;
        let next: Command;
        if (pending.kind === 'discard') {
          const actor = Object.keys(pending.required).find((who) => !pending.submitted[who])!;
          const hand = state.players.find((player) => player.id === actor)!.resources;
          const picks: Resource[] = [];
          for (const resource of RESOURCES) for (let i = 0; i < hand[resource] && picks.length < pending.required[actor]!; i += 1) picks.push(resource);
          const result = applyCommand(state, actor, { type: 'pending.discard', resources: picks } as never, rng);
          if (!result.ok) throw new Error(result.error.code);
          state = result.state;
          continue;
        }
        const frame = pending as { kind: string; responders: string[] };
        next = frame.kind === 'seafarers.sevenSteal' ? cmd({ type: 'seven.steal', victim: null }) : cmd({ type: 'pirate.gift', resource: 'lumber' });
        const result = applyCommand(state, frame.responders[0]!, next, rng);
        if (!result.ok) throw new Error(result.error.code);
        state = result.state;
      }
    }
    return state;
  };

  it('同樣的種子與指令得到完全相同的狀態與紀錄；海盜位置在狀態裡', () => {
    const first = play(99);
    const second = play(99);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(route(first)).toContain(first.board.pirate);
    const other = play(100);
    expect(route(other)).toContain(other.board.pirate);
  });

  it('從序列化的快照接著擲骰，與沒有中斷的結果一致', () => {
    const state = ready();
    pirateAt(state, 7);
    const resumed = JSON.parse(JSON.stringify(state)) as GameState;
    const a = roll(state, 'p1', [2, 4], [0]);
    const b = roll(resumed, 'p1', [2, 4], [0]);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });
});

describe('other scenarios are unaffected (D7)', () => {
  it('其他 Seafarers 劇本的海盜不會自己走，7 照舊移強盜', () => {
    const state = emptySeafarersGame(3, 0, 'preroll', 'sf-forgotten-tribe-2025');
    const pirate = state.board.pirate;
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([1, 3]));
    expect(rolled.state.turn.dice).toEqual([2, 4]);
    expect(rolled.state.board.pirate).toBe(pirate);
    expect(rolled.events.map((event) => event.type)).not.toContain('pirate.cruised');
    const seven = act(emptySeafarersGame(3, 0, 'preroll', 'sf-forgotten-tribe-2025'), 'p1', { type: 'turn.roll' }, scriptedRng([3, 2]));
    expect(seven.state.pending?.kind).toBe('moveRobber');
  });
});
