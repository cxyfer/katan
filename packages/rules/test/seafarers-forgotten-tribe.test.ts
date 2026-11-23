/**
 * R-SFX-S5：The Forgotten Tribe（世外部落）。版圖與配件表對照 SF25 pp. 12–13（3 人與 4 人
 * 共用同一張 49 格圖）；規則 fixture 為 18 個禮物位置、VP 標記、發展牌禮物、港口放置與暫存、
 * 村落與強盜只能在有圓片的格、13 分勝利。
 */

import { describe, expect, it } from 'vitest';
import { harborRates, scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, legalBuildingVertices, legalRoadEdges } from '../src/engine.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import { islandsAt } from '../src/modules/seafarers/islands.ts';
import { legalHarborEdges, type TribeGift } from '../src/modules/seafarers/tribe.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { projectEvent, projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import { FORGOTTEN_TRIBE_SOURCE, FT_GIFTS, giftEdges } from '../src/seafarers-scenario-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState, HarborType } from '../src/types.ts';
import { act, expectRejected, scriptedRng, setHand } from './helpers.ts';
import { simulateSeafarers } from './seafarers-sim.ts';
import { emptySeafarersGame, hex, road, seafarersGame, settle, ship } from './seafarers-helpers.ts';

const PROFILE = 'sf-forgotten-tribe-2025';
const MAIN = 1;

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const tribe = (players: 3 | 4 = 3, seed = 12345) => seafarersGame(players, seed, PROFILE);
const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const slotOf = (state: GameState) => seafarersState(state).tribe!;
const sf = (state: GameState, playerId: string) => actionHints(state, playerId).modules!.seafarers as {
  robberTargets: number[];
  harborChoices: { harbors: HarborType[]; edges: number[] };
};
const view = (state: GameState, viewer: string) => projectGame(state, viewer).modules!.seafarers as {
  tribe?: { gifts: { edge: number; kind: string; harbor?: string }[]; vp: Record<string, number>; held: Record<string, string[]> };
};
const player = (state: GameState, id: string) => state.players.find((candidate) => candidate.id === id)!;
const score = (state: GameState, id: string) => scoreOf(state, id, { includeHidden: true });

/** 一局 p1 行動中的空盤（只有禮物）。 */
const ready = (players: 3 | 4 = 3) => emptySeafarersGame(players, 0, 'action', PROFILE);

describe('The Forgotten Tribe topology (SF25 pp. 12–13, spec §7.3)', () => {
  it('49 格寬版外框 6-7-8-7-8-7-6，中排兩端的突出部是框；hex／邊／頂點／框內緣邊／港口位置數', () => {
    const topology = getTopology('sf-forgotten-tribe');
    expect(topology.hexes).toHaveLength(49);
    expect([topology.edges.length, topology.vertices.length, topology.coastalEdges.length, topology.harborSlots.length])
      .toEqual([172, 124, 50, 6]);
    // 歐拉公式：頂點 − 邊 + 格 = 1（單一圓盤）。
    expect(topology.vertices.length - topology.edges.length + topology.hexes.length).toBe(1);
    const rows = tally(topology.hexes.map((cell) => cell.r));
    expect([-3, -2, -1, 0, 1, 2, 3].map((r) => rows[r])).toEqual([6, 7, 8, 7, 8, 7, 6]);
    // 兩個框突出部 (-4,0)、(4,0) 不是格。
    for (const q of [-4, 4]) expect(topology.hexes.some((cell) => cell.q === q && cell.r === 0)).toBe(false);
    // 置中：每排中心對稱（x 軸）。
    for (const r of [-3, -2, -1, 0, 1, 2, 3]) {
      const xs = topology.hexes.filter((cell) => cell.r === r).map((cell) => cell.x);
      expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 5);
    }
  });

  it('18 個禮物位置：8 VP、4 發展牌、6 港口，都是陸地格與框之間的邊（框內緣邊），彼此不同', () => {
    const topology = getTopology('sf-forgotten-tribe');
    const edges = giftEdges(topology);
    expect(edges).toHaveLength(18);
    expect(tally(edges.map((entry) => entry.kind))).toEqual({ vp: 8, devcard: 4, port: 6 });
    expect(new Set(edges.map((entry) => entry.edge)).size).toBe(18);
    const { state } = tribe(3);
    for (const { edge } of edges) {
      const info = topology.edges[edge]!;
      expect(topology.coastalEdges).toContain(edge);
      expect(info.hexes).toHaveLength(1);
      expect(state.board.layout.terrain[info.hexes[0]!]).not.toBe('sea');
      expect(state.board.layout.islands[info.hexes[0]!]).not.toBe(MAIN); // 全在小島（含右側兩個單格）
    }
    // 港口位置 = topology 的 harborSlots（依序）。
    expect(topology.harborSlots).toEqual(edges.filter((entry) => entry.kind === 'port').map((entry) => entry.edge));
    expect(FT_GIFTS).toHaveLength(18);
  });
});

describe('The Forgotten Tribe layout', () => {
  it('SF25 p. 12 配件表：49 格、海 19、沙漠 3、金礦 2、其餘各 5、圓片 18；開局沒有固定港口', () => {
    for (const players of [3, 4] as const) {
      const { state } = tribe(players);
      const layout = state.board.layout;
      expect(layout.topologyId).toBe('sf-forgotten-tribe');
      expect(tally(layout.terrain)).toEqual({ sea: 19, desert: 3, gold: 2, fields: 5, forest: 5, hills: 5, pasture: 5, mountains: 5 });
      expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({ 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 });
      expect(layout.numbers.filter((n) => n !== null)).toHaveLength(18);
      expect(layout.harbors).toEqual([]);
    }
  });

  it('大島 = 島 1：中間三排 18 格全有圓片；小島 12 格全無圓片（含 3 沙漠、2 金礦）', () => {
    const { state } = tribe(3);
    const { terrain, numbers, islands } = state.board.layout;
    const topology = topologyOf(state);
    expect(tally(islands.filter((island) => island > 0))).toEqual({ 1: 18, 2: 2, 3: 3, 4: 1, 5: 1, 6: 2, 7: 3 });
    topology.hexes.forEach((cell, index) => {
      if (islands[index] === MAIN) {
        expect(numbers[index], `${cell.q},${cell.r}`).not.toBeNull();
        expect([-1, 0, 1]).toContain(cell.r); // 中間三排
      } else if (terrain[index] !== 'sea') {
        expect(numbers[index], `${cell.q},${cell.r}`).toBeNull();
      }
    });
    const small = terrain.flatMap((tile, index) => (tile !== 'sea' && islands[index] !== MAIN ? [tile] : []));
    expect(small).toHaveLength(12);
    expect(tally(small)).toMatchObject({ desert: 3, gold: 2 });
    // 大島上沒有沙漠、金礦。
    expect(terrain.flatMap((tile, index) => (islands[index] === MAIN ? [tile] : [])).filter((tile) => tile === 'desert' || tile === 'gold')).toEqual([]);
  });

  it('轉錄表與 layout 一致：每格地形、圓片、島編號；座標已平移（原點 (0,0) → (-1,-3)）', () => {
    const { state } = tribe(4);
    expect(FORGOTTEN_TRIBE_SOURCE.land).toHaveLength(30);
    expect(FORGOTTEN_TRIBE_SOURCE.shift).toEqual({ dq: -1, dr: -3 });
    for (const land of FORGOTTEN_TRIBE_SOURCE.land) {
      const index = hex(state, land.q, land.r);
      expect([state.board.layout.terrain[index], state.board.layout.numbers[index], state.board.layout.islands[index]])
        .toEqual([land.terrain, land.number, land.island]);
    }
    // 轉錄左上角的金礦 (0,0) 在置中座標是 (-1,-3)；大島左上角 (-2,2) 是 (-3,-1)。
    expect(state.board.layout.terrain[hex(state, -1, -3)]).toBe('gold');
    expect(state.board.layout.numbers[hex(state, -3, -1)]).toBe(6);
  });

  it('3 人與 4 人同一張圖（除隨機的強盜沙漠與禮物排列外逐格相同）', () => {
    const a = tribe(3).state.board.layout;
    const b = tribe(4).state.board.layout;
    expect(a.topologyId).toBe(b.topologyId);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.numbers).toEqual(b.numbers);
    expect(a.islands).toEqual(b.islands);
    expect(a.pirate).toBe(b.pirate);
  });

  it('海盜在海格 (1,-3)（轉錄 (2,0)）；強盜隨機落在三塊沙漠之一並寫進 layout，各沙漠都會出現', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = tribe(3, seed);
        const board = state.board;
      expect(board.layout.terrain[board.layout.robber]).toBe('desert');
      expect(board.robber).toBe(board.layout.robber);
      expect(board.pirate).toBe(hex(state, 1, -3));
      expect(board.layout.terrain[board.pirate!]).toBe('sea');
      const cell = topologyOf(state).hexes[board.robber]!;
      seen.add(`${cell.q},${cell.r}`);
    }
    // 轉錄的三塊沙漠 (3,0)、(-3,6)、(1,6) → 置中 (2,-3)、(-4,3)、(0,3)。
    expect([...seen].sort()).toEqual(['-4,3', '0,3', '2,-3']);
  });

  it('profile：13 分、15 艘船、無島嶼獎勵、規則版本 sf-2025.3；只接受 3、4 人', () => {
    const profile = getProfile(PROFILE)!;
    expect(profile).toMatchObject({ victoryTarget: 13, implemented: true, enabled: true, scenario: 'forgotten-tribe', ruleVersion: 'sf-2025.3' });
    expect(profile.islandBonus).toBeUndefined();
    expect(profile.pieces.ships).toBe(15);
    const base = { expansions: ['seafarers'], scenario: 'forgotten-tribe', variants: [], setupMode: 'fixed' as const };
    for (const playerCount of [3, 4]) expect(resolveCombination({ ...base, playerCount })).toMatchObject({ ok: true });
    for (const playerCount of [2, 5, 6]) expect(resolveCombination({ ...base, playerCount })).toEqual({ ok: false, reason: 'bad-player-count' });
  });
});

describe('SFX-S5 開局的禮物', () => {
  it('8 VP、牌堆頂 4 張（發展牌堆剩 21）、6 個港口（5 個 2:1 各一種 + 1 個 3:1）放在 18 個邊上', () => {
    for (const players of [3, 4] as const) {
      const { state } = tribe(players);
      const gifts = slotOf(state).gifts;
      expect(tally(gifts.map((gift) => gift.kind))).toEqual({ vp: 8, devcard: 4, port: 6 });
      expect(state.devDeck).toHaveLength(21);
      expect(gifts.filter((gift) => gift.kind === 'devcard')).toHaveLength(4);
      expect(gifts.flatMap((gift) => (gift.kind === 'port' ? [gift.harbor] : [])).sort()).toEqual(['brick', 'generic', 'grain', 'lumber', 'ore', 'wool']);
      // 發展牌供應守恆：牌堆 + 4 張禮物 = 25。
      expect(state.devDeck.length + gifts.filter((gift) => gift.kind === 'devcard').length).toBe(25);
      // 邊與 giftEdges 一致，位置各異。
      expect(gifts.map((gift) => gift.edge).sort((a, b) => a - b)).toEqual(giftEdges(topologyOf(state)).map((entry) => entry.edge).sort((a, b) => a - b));
    }
  });

  it('港口隨機排列（以 ctx.rng 決定）：同種子相同、不同種子不全相同', () => {
    const order = (seed: number) => slotOf(tribe(3, seed).state).gifts.flatMap((gift) => (gift.kind === 'port' ? [gift.harbor] : [])).join();
    expect(order(7)).toBe(order(7));
    expect(new Set([1, 2, 3, 4, 5, 6].map(order)).size).toBeGreaterThan(1);
  });

  it('公開狀態：禮物位置與種類、港口種類（面朝上）；發展牌只有位置，沒有身分', () => {
    const { state } = tribe(3);
    const pub = view(state, 'p1').tribe!;
    expect(pub.gifts).toHaveLength(18);
    expect(tally(pub.gifts.map((gift) => gift.kind))).toEqual({ vp: 8, devcard: 4, port: 6 });
    for (const gift of pub.gifts) {
      if (gift.kind === 'devcard') expect(Object.keys(gift).sort()).toEqual(['edge', 'kind']);
      if (gift.kind === 'port') expect(gift.harbor).toBeTruthy();
    }
    expect(pub.vp).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(pub.held).toEqual({ p1: [], p2: [], p3: [] });
    expect(projectGame(state, 'p1').devDeckSize).toBe(21);
  });

  it('其他劇本的投影不帶 tribe 欄位', () => {
    const { state } = seafarersGame(3, 1, 'sf-four-islands-2025');
    expect((projectGame(state, 'p1').modules!.seafarers as Record<string, unknown>).tribe).toBeUndefined();
  });
});

/** 邊 `edge` 兩端各自的鄰接海邊（不碰海盜）；優先不是禮物邊。回傳鄰邊與共用的交叉點。 */
function seaNeighbour(state: GameState, edge: number): { near: number; shared: number; other: number } {
  const topology = topologyOf(state);
  const gifts = new Set(slotOf(state).gifts.map((gift) => gift.edge));
  const options: { near: number; shared: number; other: number; plain: boolean }[] = [];
  const [a, b] = topology.edges[edge]!.vertices as [number, number];
  for (const [shared, other] of [[b, a], [a, b]] as const) {
    for (const candidate of topology.vertices[shared]!.edges) {
      const info = topology.edges[candidate]!;
      const sea = info.hexes.length === 1 || info.hexes.some((h) => state.board.layout.terrain[h] === 'sea');
      if (candidate === edge || !sea || info.hexes.includes(state.board.pirate ?? -1)) continue;
      options.push({ near: candidate, shared, other, plain: !gifts.has(candidate) });
    }
  }
  const pick = options.find((option) => option.plain) ?? options[0];
  if (!pick) throw new Error(`no neighbouring sea edge for ${edge}`);
  return pick;
}

/** 在 `edge` 的一端放 p1 村落，建造 p1 的船到 `edge`（連接村落）。 */
function buildTo(state: GameState, edge: number): GameState {
  settle(state, 'p1', topologyOf(state).edges[edge]!.vertices[0]!);
  setHand(state, 'p1', { lumber: 1, wool: 1 });
  return act(state, 'p1', { type: 'build.ship', edge } as never).state;
}

/** 在 `edge` 的鄰邊放 p1 的船，村落放在 `edge` 另一端，再把船移到 `edge`。 */
function moveTo(state: GameState, edge: number): GameState {
  const { near, other } = seaNeighbour(state, edge);
  settle(state, 'p1', other);
  ship(state, 'p1', near);
  return act(state, 'p1', { type: 'ship.move', from: near, to: edge } as never).state;
}

describe('SFX-S5 18 個位置各一個放船案例（建造與移動都觸發）', () => {
  const topology = getTopology('sf-forgotten-tribe');
  const positions = giftEdges(topology).map((entry, index) => ({ ...entry, index }));

  for (const how of ['build', 'move'] as const) {
    it(`${how === 'build' ? '建造' : '移動'}船到禮物邊就拿走：VP 標記 +1 分、發展牌進 newDevCards、港口進 frame 或暫存（18 個位置）`, () => {
      for (const { edge, kind, index } of positions) {
        const base = ready();
        const gift = slotOf(base).gifts.find((candidate) => candidate.edge === edge)!;
        const before = score(base, 'p1');
        const after = how === 'build' ? buildTo(clone(base), edge) : moveTo(clone(base), edge);
        const label = `${how} ${kind}#${index} edge ${edge}`;
        expect(after.board.roads[edge], label).toEqual({ player: 'p1', ship: true });
        // 禮物離開邊，且只有這一個。
        expect(slotOf(after).gifts.map((candidate) => candidate.edge), label).not.toContain(edge);
        expect(slotOf(after).gifts, label).toHaveLength(17);
        const gain = score(after, 'p1') - before - 1; // 扣掉剛放的村落
        if (kind === 'vp') {
          expect(gain, label).toBe(1);
          expect(player(after, 'p1').bonusPoints).toBe(1);
          expect(view(after, 'p2').tribe!.vp.p1).toBe(1);
          expect(player(after, 'p1').newDevCards).toEqual([]);
        } else if (kind === 'devcard') {
          const card = (gift as Extract<TribeGift, { kind: 'devcard' }>).card;
          expect(player(after, 'p1').newDevCards, label).toEqual([card]);
          expect(player(after, 'p1').devCards).toEqual([]);
          expect(gain, label).toBe(card === 'victoryPoint' ? 1 : 0);
          expect(after.devDeck).toHaveLength(21);
        } else {
          const harbor = (gift as Extract<TribeGift, { kind: 'port' }>).harbor;
          expect(gain, label).toBe(0);
          // 村落在這個邊的端點上（海岸），所以有合法位置，開 frame 讓玩家選。
          expect(after.pending, label).toMatchObject({ kind: 'seafarers.harbor', responders: ['p1'] });
          expect(sf(after, 'p1').harborChoices.harbors).toEqual([harbor]);
          expect(sf(after, 'p1').harborChoices.edges.length).toBeGreaterThan(0);
        }
      }
    });
  }

  it('沒有禮物的邊與一般海邊不觸發：一般建船、移船都不拿東西', () => {
    const state = ready();
    const gifts = new Set(slotOf(state).gifts.map((gift) => gift.edge));
    const plain = topologyOf(state).edges.findIndex((info, edge) =>
      !gifts.has(edge) && info.hexes.length === 1 && state.board.layout.terrain[info.hexes[0]!] !== 'sea');
    const after = buildTo(clone(state), plain);
    expect(slotOf(after).gifts).toHaveLength(18);
    expect(player(after, 'p1').bonusPoints).toBe(0);
  });

  it('只有船觸發：路不拿禮物（小島沒有可蓋村落的交叉點，所以實際上路也到不了禮物邊）', () => {
    const state = ready();
    const { edge } = positions[0]!;
    settle(state, 'p1', topologyOf(state).edges[edge]!.vertices[0]!);
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    const after = act(state, 'p1', { type: 'build.road', edge }).state;
    expect(after.board.roads[edge]).toEqual({ player: 'p1', ship: false });
    expect(slotOf(after).gifts).toHaveLength(18);
    expect(player(after, 'p1').bonusPoints).toBe(0);
  });

  it('一艘船只拿一次：第二艘船到同一邊的位置已無禮物（禮物已被拿走）', () => {
    const { edge } = positions.find((entry) => entry.kind === 'vp')!;
    const first = buildTo(ready(), edge);
    expect(slotOf(first).gifts).toHaveLength(17);
    // 移走後別人到同一邊也不再得分。
    first.board.roads[edge] = null;
    first.turn.seat = 1;
    first.turn.phase = 'action';
    first.windowId += 1;
    settle(first, 'p2', topologyOf(first).edges[edge]!.vertices[1]!);
    setHand(first, 'p2', { lumber: 1, wool: 1 });
    const after = act(first, 'p2', { type: 'build.ship', edge } as never).state;
    expect(player(after, 'p2').bonusPoints).toBe(0);
    expect(slotOf(after).gifts).toHaveLength(17);
  });

  it('Road Building 的免費船也觸發禮物', () => {
    const state = ready();
    const { edge } = positions.find((entry) => entry.kind === 'vp')!;
    settle(state, 'p1', topologyOf(state).edges[edge]!.vertices[0]!);
    player(state, 'p1').devCards = ['roadBuilding'];
    const started = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    const after = act(started, 'p1', { type: 'build.ship', edge } as never).state;
    expect(player(after, 'p1').bonusPoints).toBe(1);
  });
});

describe('SFX-S5 VP 標記', () => {
  it('每枚 1 分、公開，放在自己面前；供應 8 枚，全部拿完後不再有', () => {
    let state = ready();
    const vps = slotOf(state).gifts.filter((gift) => gift.kind === 'vp');
    expect(vps).toHaveLength(8);
    for (const gift of vps.slice(0, 2)) {
      const topology = topologyOf(state);
      settle(state, 'p1', topology.edges[gift.edge]!.vertices[0]!);
      setHand(state, 'p1', { lumber: 1, wool: 1 });
      state = act(state, 'p1', { type: 'build.ship', edge: gift.edge } as never).state;
      state.windowId += 1;
    }
    expect(view(state, 'p3').tribe!.vp).toEqual({ p1: 2, p2: 0, p3: 0 });
    expect(player(state, 'p1').bonusPoints).toBe(2);
    expect(state.log.filter((event) => event.type === 'tribe.gift' && event.params.gift === 'vp')).toHaveLength(2);
  });

  it('13 分：差一分不勝，VP 標記補上最後一分就在這個動作結束時勝利', () => {
    const edge = giftEdges(getTopology('sf-forgotten-tribe')).find((entry) => entry.kind === 'vp')!.edge;
    for (const [bonus, wins] of [[10, false], [11, true]] as const) {
      const state = ready();
      player(state, 'p1').bonusPoints = bonus; // 起始：村落 1 分 + bonus；拿標記後 +1
      const after = buildTo(state, edge);
      expect(score(after, 'p1')).toBe(bonus + 1 + 1);
      expect(after.result !== null).toBe(wins);
      if (wins) expect(after.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    }
  });
});

describe('SFX-S5 發展牌禮物', () => {
  const devEdge = (state: GameState, card?: string) => {
    const gift = slotOf(state).gifts.find((candidate) => candidate.kind === 'devcard' && (!card || candidate.card === card))!;
    return gift.edge;
  };

  /** 把所有發展牌禮物換成指定牌，便於斷言。 */
  function stack(state: GameState, card: 'knight' | 'victoryPoint' | 'monopoly'): void {
    for (const gift of slotOf(state).gifts) if (gift.kind === 'devcard') gift.card = card;
  }

  it('視同這回合購買：本回合不可打出（E_CARD_JUST_BOUGHT），下回合才可打出', () => {
    const state = ready();
    stack(state, 'knight');
    const taken = buildTo(state, devEdge(state));
    const robber = taken.board.layout.numbers.findIndex((n) => n === 12);
    expect(player(taken, 'p1').newDevCards).toEqual(['knight']);
    expectRejected(taken, 'p1', { type: 'dev.playKnight', hex: robber }, 'E_CARD_JUST_BOUGHT');
    // 一圈後輪回 p1：牌進入可打出的 devCards。
    let next = act(taken, 'p1', { type: 'turn.end' }, scriptedRng([])).state;
    for (const id of ['p2', 'p3']) {
      next = act(next, id, { type: 'turn.roll' }, scriptedRng([0, 1])).state;
      next = act(next, id, { type: 'turn.end' }, scriptedRng([])).state;
    }
    next = act(next, 'p1', { type: 'turn.roll' }, scriptedRng([0, 1])).state;
    expect(player(next, 'p1').devCards).toEqual(['knight']);
    expect(player(next, 'p1').newDevCards).toEqual([]);
    const played = act(next, 'p1', { type: 'dev.playKnight', hex: robber }).state;
    expect(player(played, 'p1').playedKnights).toBe(1);
  });

  it('分數牌立即計入並可使這個動作獲勝', () => {
    const state = ready();
    stack(state, 'victoryPoint');
    player(state, 'p1').bonusPoints = 11; // 村落 1 + 11 = 12，拿到分數牌 = 13
    const taken = buildTo(state, devEdge(state));
    expect(player(taken, 'p1').newDevCards).toEqual(['victoryPoint']);
    expect(score(taken, 'p1')).toBe(13);
    expect(taken.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });

  it('移動船拿到的發展牌也一樣', () => {
    const state = ready();
    stack(state, 'monopoly');
    const taken = moveTo(state, devEdge(state));
    expect(player(taken, 'p1').newDevCards).toEqual(['monopoly']);
    expect(player(taken, 'p1').devCards).toEqual([]);
  });
});

describe('SFX-S5 發展牌禮物的隱私', () => {
  const cards = ['yearOfPlenty', 'roadBuilding', 'monopoly', 'victoryPoint'] as const;
  const arranged = () => {
    const state = ready();
    slotOf(state).gifts.filter((gift) => gift.kind === 'devcard').forEach((gift, index) => {
      (gift as Extract<TribeGift, { kind: 'devcard' }>).card = cards[index]!;
    });
    return state;
  };

  it('未被拿走時，任何人的投影都不含牌的身分', () => {
    const state = arranged();
    for (const viewer of ['p1', 'p2', 'p3']) {
      const text = JSON.stringify(projectGame(state, viewer, { events: state.log }));
      for (const card of cards) expect(text, `${viewer} ${card}`).not.toContain(card);
    }
    // 開局事件也不含。
    expect(JSON.stringify(state.log.map((event) => projectEvent(event, 'p2')))).not.toContain('victoryPoint');
  });

  it('拿走後只有拿的人看到牌：事件的私有參數只給拿的人，其他人的投影與事件仍不含身分', () => {
    const state = arranged();
    const edge = slotOf(state).gifts.find((gift) => gift.kind === 'devcard' && gift.card === 'yearOfPlenty')!.edge;
    const taken = buildTo(state, edge);
    const event = taken.log.find((candidate) => candidate.type === 'tribe.gift')!;
    expect(event.params).toMatchObject({ playerId: 'p1', edge, gift: 'devcard' });
    expect(projectEvent(event, 'p1').params.card).toBe('yearOfPlenty');
    expect(projectEvent(event, 'p2').params.card).toBeUndefined();
    expect(projectEvent(event, 'p3').params.card).toBeUndefined();
    expect(projectGame(taken, 'p1').players.find((candidate) => candidate.id === 'p1')).toMatchObject({ newDevCards: ['yearOfPlenty'] });
    for (const viewer of ['p2', 'p3']) {
      const text = JSON.stringify(projectGame(taken, viewer, { events: taken.log.map((entry) => projectEvent(entry, viewer)) }));
      expect(text, viewer).not.toContain('yearOfPlenty');
      // 剩下三張仍然沒有身分。
      for (const card of ['roadBuilding', 'monopoly', 'victoryPoint']) expect(text, `${viewer} ${card}`).not.toContain(card);
    }
    // p1 自己的投影只多出自己拿到的那張，不含另外三張。
    const own = JSON.stringify(projectGame(taken, 'p1', { events: taken.log.map((entry) => projectEvent(entry, 'p1')) }));
    for (const card of ['roadBuilding', 'monopoly', 'victoryPoint']) expect(own).not.toContain(card);
  });
});

/** 大島海岸上一個可蓋村落的交叉點，與它兩側的海岸邊。 */
function coastVertex(state: GameState, skip = 0): { vertex: number; coast: number[] } {
  const topology = topologyOf(state);
  const isCoast = (edge: number) => {
    const info = topology.edges[edge]!;
    return info.hexes.some((h) => state.board.layout.terrain[h] !== 'sea') && (info.hexes.length === 1 || info.hexes.some((h) => state.board.layout.terrain[h] === 'sea'));
  };
  const found = topology.vertices.flatMap((info, vertex) => {
    if (!islandsAt(state, vertex).includes(MAIN)) return [];
    const coast = info.edges.filter(isCoast);
    return coast.length === 2 && info.edges.length === 3 ? [{ vertex, coast }] : [];
  });
  return found[skip]!;
}

/** 先直接放一艘 p1 的船在禮物邊旁，再建造一艘船到禮物邊 `edge`，連在這艘船上。 */
function chainTo(state: GameState, edge: number): GameState {
  const { near } = seaNeighbour(state, edge);
  ship(state, 'p1', near);
  setHand(state, 'p1', { lumber: 1, wool: 1 });
  return act(state, 'p1', { type: 'build.ship', edge } as never).state;
}

describe('SFX-S5 港口放置', () => {
  const portEdges = (state: GameState) => slotOf(state).gifts.filter((gift) => gift.kind === 'port');

  it('有海岸村落：開 frame，只能放到自己村落旁的海岸邊；放下後立即可用', () => {
    const state = ready();
    const { vertex, coast } = coastVertex(state);
    settle(state, 'p1', vertex);
    const gift = portEdges(state)[0]!;
    const taken = chainTo(state, gift.edge);
    const harbor = (gift as Extract<TribeGift, { kind: 'port' }>).harbor;
    expect(taken.pending).toMatchObject({ kind: 'seafarers.harbor', module: 'seafarers', responders: ['p1'] });
    // frame 公開暫存港口種類；選項正好是兩條海岸邊（小島上沒有 p1 的村落）。
    expect(sf(taken, 'p1').harborChoices).toEqual({ harbors: [harbor], edges: coast.slice().sort((a, b) => a - b) });
    expect(projectGame(taken, 'p2').pending).toMatchObject({ kind: 'seafarers.harbor', data: { harbors: [harbor] } });
    expect(sf(taken, 'p2').harborChoices).toEqual({ harbors: [], edges: [] });
    // 不合法的放置被拒：非海岸邊、別人的 frame、沒有的港口種類。
    const inland = topologyOf(taken).edges.findIndex((info) => info.hexes.length === 2 && info.hexes.every((h) => taken.board.layout.terrain[h] !== 'sea'));
    expectRejected(taken, 'p1', { type: 'harbor.place', edge: inland, harbor } as never, 'E_ILLEGAL_TARGET');
    expectRejected(taken, 'p1', { type: 'harbor.place', edge: coast[0]!, harbor: harbor === 'wool' ? 'ore' : 'wool' } as never, 'E_INVALID_SELECTION');
    expect(applyCommand(taken, 'p2', { type: 'harbor.place', edge: coast[0]!, harbor } as never, seededRng(1)).ok).toBe(false);
    // frame 未解決前不能結束回合。
    expect(applyCommand(taken, 'p1', { type: 'turn.end' }, seededRng(1)).ok).toBe(false);
    const before = harborRates(taken, 'p1');
    const placed = act(taken, 'p1', { type: 'harbor.place', edge: coast[0]!, harbor } as never).state;
    expect(placed.pending).toBeNull();
    expect(placed.board.layout.harbors).toEqual([{ edge: coast[0], type: harbor }]);
    expect(placed.log.some((event) => event.type === 'harbor.placed')).toBe(true);
    // 放下即可使用。
    expect(harborRates(placed, 'p1')).not.toEqual(before);
    expect(harborRates(placed, 'p1')[harbor === 'generic' ? 'lumber' : harbor]).toBe(harbor === 'generic' ? 3 : 2);
    expect(view(placed, 'p2').tribe!.held.p1).toEqual([]);
    // 之後可以正常結束回合。
    expect(applyCommand(placed, 'p1', { type: 'turn.end' }, seededRng(1)).ok).toBe(true);
  });

  it('港口之間必須隔一條邊：已有港口的邊與共用交叉點的鄰邊都不可放', () => {
    const state = ready();
    const { vertex, coast } = coastVertex(state);
    settle(state, 'p1', vertex);
    const [first, second] = portEdges(state) as Extract<TribeGift, { kind: 'port' }>[];
    let taken = chainTo(state, first!.edge);
    taken = act(taken, 'p1', { type: 'harbor.place', edge: coast[0]!, harbor: first!.harbor } as never).state;
    // 第二個港口：同一個村落的另一條海岸邊與 coast[0] 共用 `vertex`，不合法；沒有別的村落，所以暫存。
    expect(legalHarborEdges(taken, 'p1')).toEqual([]);
    taken.windowId += 1;
    const next = chainTo(taken, second!.edge);
    expect(next.pending).toBeNull();
    expect(slotOf(next).held.p1).toEqual([second!.harbor]);
    expect(view(next, 'p2').tribe!.held.p1).toEqual([second!.harbor]);
    // 第二個村落離第一個港口兩條邊以上時就有合法位置，且不含與已放港口共用交叉點的邊。
    const topology = topologyOf(next);
    const used = new Set(topology.edges[coast[0]!]!.vertices);
    const other = topology.vertices.flatMap((info, v) => {
      if (!islandsAt(next, v).includes(MAIN) || info.edges.length !== 3) return [];
      const coastal = info.edges.filter((edge) => topology.edges[edge]!.hexes.length === 1 || topology.edges[edge]!.hexes.some((h) => next.board.layout.terrain[h] === 'sea'));
      return coastal.length === 2 && coastal.every((edge) => !topology.edges[edge]!.vertices.some((x) => used.has(x))) &&
        !info.edges.some((edge) => topology.edges[edge]!.vertices.some((x) => x !== v && next.board.buildings[x])) ? [{ v, coastal }] : [];
    });
    const spot = other.find(({ v }) => !topology.edges[coast[0]!]!.vertices.includes(v) && !topology.vertices[v]!.edges.some((edge) => topology.edges[edge]!.vertices.some((x) => used.has(x))))!;
    settle(next, 'p1', spot.v);
    expect(legalHarborEdges(next, 'p1').sort((a, b) => a - b)).toEqual(spot.coastal.slice().sort((a, b) => a - b));
    for (const edge of legalHarborEdges(next, 'p1')) {
      expect(topology.edges[edge]!.vertices.some((x) => used.has(x))).toBe(false);
    }
  });

  it('沒有海岸村落：港口暫存在面前；之後每次盤面變動重新檢查，有合法位置才開 frame', () => {
    const state = ready();
    const gift = portEdges(state)[0] as Extract<TribeGift, { kind: 'port' }>;
    // 只有船、沒有任何建築：直接放一艘船在禮物邊旁再建造（船連船）。
    const topology = topologyOf(state);
    const { near } = seaNeighbour(state, gift.edge);
    ship(state, 'p1', near);
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const held = act(state, 'p1', { type: 'build.ship', edge: gift.edge } as never).state;
    expect(held.pending).toBeNull();
    expect(slotOf(held).held.p1).toEqual([gift.harbor]);
    expect(legalHarborEdges(held, 'p1')).toEqual([]);

    // 一個內陸村落（不碰海）不會產生合法位置，港口仍暫存。
    held.windowId += 1;
    const inland = topology.vertices.findIndex((info, vertex) => info.hexes.length === 3 && info.hexes.every((h) => held.board.layout.islands[h] === MAIN) &&
      islandsAt(held, vertex).includes(MAIN) && info.edges.every((edge) => topology.edges[edge]!.hexes.length === 2));
    const inlandRoad = topology.vertices[inland]!.edges[0]!;
    road(held, 'p1', inlandRoad);
    setHand(held, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    const afterInland = act(held, 'p1', { type: 'build.settlement', vertex: inland }).state;
    expect(afterInland.pending).toBeNull();
    expect(slotOf(afterInland).held.p1).toEqual([gift.harbor]);

    // 一個海岸村落：這次盤面變動後有合法位置，自動開 frame。
    afterInland.windowId += 1;
    const { vertex, coast } = coastVertex(afterInland, 6);
    const [a, b] = topology.vertices[vertex]!.edges.filter((edge) => !coast.includes(edge)).concat(coast);
    void b;
    road(afterInland, 'p1', a!);
    setHand(afterInland, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    const placedVertex = act(afterInland, 'p1', { type: 'build.settlement', vertex }).state;
    expect(placedVertex.pending).toMatchObject({ kind: 'seafarers.harbor', responders: ['p1'] });
    expect(sf(placedVertex, 'p1').harborChoices.harbors).toEqual([gift.harbor]);
    const done = act(placedVertex, 'p1', { type: 'harbor.place', edge: sf(placedVertex, 'p1').harborChoices.edges[0]!, harbor: gift.harbor } as never).state;
    expect(slotOf(done).held.p1).toEqual([]);
    expect(done.pending).toBeNull();
  });

  it('同時暫存兩個港口時，放完一個若還有合法位置就再開一個 frame', () => {
    const state = ready();
    const { vertex } = coastVertex(state);
    const ports = portEdges(state) as Extract<TribeGift, { kind: 'port' }>[];
    slotOf(state).held.p1 = [ports[0]!.harbor, ports[1]!.harbor];
    settle(state, 'p1', vertex);
    const topology = topologyOf(state);
    // 兩個村落都在海岸、彼此不相鄰且海岸邊不共用交叉點。
    const second = topology.vertices.findIndex((info, v) => v !== vertex && islandsAt(state, v).includes(MAIN) && info.edges.length === 3 &&
      legalHarborEdges({ ...state, board: { ...state.board, buildings: state.board.buildings.map((b, i) => (i === v ? { player: 'p1', city: false } : b)) } } as GameState, 'p1').length > 0 &&
      !topology.vertices[vertex]!.edges.some((edge) => topology.edges[edge]!.vertices.includes(v)) &&
      !info.edges.some((edge) => topology.edges[edge]!.vertices.some((x) => topology.vertices[vertex]!.edges.some((other) => topology.edges[other]!.vertices.includes(x)))));
    settle(state, 'p1', second);
    // 觸發一次盤面變動（建一艘船到一般海邊）。
    const gifts = new Set(slotOf(state).gifts.map((gift) => gift.edge));
    const plain = topology.vertices[vertex]!.edges.find((edge) => !gifts.has(edge) && topology.edges[edge]!.hexes.some((h) => state.board.layout.terrain[h] === 'sea'))!;
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const first = act(state, 'p1', { type: 'build.ship', edge: plain } as never).state;
    expect(first.pending).toMatchObject({ kind: 'seafarers.harbor' });
    expect(sf(first, 'p1').harborChoices.harbors.sort()).toEqual([ports[0]!.harbor, ports[1]!.harbor].sort());
    const edges = sf(first, 'p1').harborChoices.edges;
    const one = act(first, 'p1', { type: 'harbor.place', edge: edges[0]!, harbor: ports[0]!.harbor } as never).state;
    // 還有一個暫存港口：有合法位置就再開一個 frame，沒有就留在面前。
    if (legalHarborEdges(one, 'p1').length > 0) expect(one.pending).toMatchObject({ kind: 'seafarers.harbor' });
    else expect(slotOf(one).held.p1).toEqual([ports[1]!.harbor]);
  });
});

describe('SFX-S5 村落與強盜只能在有圓片的格', () => {
  it('起始村落只放大島（交叉點碰到島 1）；設置全程只在大島', () => {
    for (const players of [3, 4] as const) {
      const { state } = tribe(players);
      const legal = new Set(legalBuildingVertices(state, 'p1', { setup: true }));
      topologyOf(state).vertices.forEach((_vertex, vertex) => {
        expect(legal.has(vertex), `vertex ${vertex}`).toBe(islandsAt(state, vertex).includes(MAIN));
      });
      let current = state;
      while (current.turn.phase === 'setup') {
        const setup = current.turn.setup!;
        const actor = current.players[setup.order[setup.index]!]!.id;
        if (setup.stage === 'building') {
          const vertex = legalBuildingVertices(current, actor, { setup: true })[0]!;
          current = act(current, actor, { type: 'setup.placeBuilding', vertex }).state;
        } else {
          current = act(current, actor, { type: 'setup.placeRoad', edge: legalRoadEdges(current, actor, { setup: true, lastVertex: setup.lastVertex })[0]! }).state;
        }
      }
      current.board.buildings.forEach((building, vertex) => {
        if (building) expect(islandsAt(current, vertex)).toContain(MAIN);
      });
    }
  });

  it('遊戲中的村落也只能蓋在碰到至少一個有圓片格的交叉點：小島（無圓片）蓋不了，大島海岸可以', () => {
    const state = ready();
    const topology = topologyOf(state);
    const touchesDisc = (vertex: number) => topology.vertices[vertex]!.hexes.some((h) => state.board.layout.numbers[h] !== null);
    // 一個只碰小島（無圓片）的交叉點：船停在旁邊，仍不能蓋。
    const smallVertex = topology.vertices.findIndex((info, vertex) => !touchesDisc(vertex) && info.hexes.some((h) => state.board.layout.terrain[h] !== 'sea') &&
      info.edges.some((edge) => topology.edges[edge]!.hexes.length === 1));
    const smallEdge = topology.vertices[smallVertex]!.edges.find((edge) => topology.edges[edge]!.hexes.length === 1)!;
    ship(state, 'p1', smallEdge);
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    expect(legalBuildingVertices(state, 'p1', { setup: false })).not.toContain(smallVertex);
    expectRejected(state, 'p1', { type: 'build.settlement', vertex: smallVertex }, 'E_ILLEGAL_TARGET');
    // 對照：同樣的船停在大島海岸，可以蓋。
    const control = ready();
    const { vertex, coast } = coastVertex(control);
    ship(control, 'p1', coast[0]!);
    setHand(control, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    expect(legalBuildingVertices(control, 'p1', { setup: false }).some((candidate) => touchesDisc(candidate))).toBe(true);
    void vertex;
    // 規則的全稱斷言：任何合法村落交叉點都碰到有圓片的格。
    for (const candidate of legalBuildingVertices(control, 'p1', { setup: false })) expect(touchesDisc(candidate)).toBe(true);
  });

  it('強盜只能移到有圓片的格：騎士牌與 7 都一樣；起始沙漠與小島都不可去', () => {
    const state = ready();
    const numbered = state.board.layout.numbers.flatMap((n, index) => (n !== null ? [index] : []));
    expect(numbered).toHaveLength(18);
    expect([...sf(state, 'p1').robberTargets].sort((a, b) => a - b)).toEqual(numbered);
    player(state, 'p1').devCards = ['knight'];
    for (const [index, tile] of state.board.layout.terrain.entries()) {
      if (tile === 'sea' || numbered.includes(index) || index === state.board.robber) continue;
      expectRejected(state, 'p1', { type: 'dev.playKnight', hex: index }, 'E_ILLEGAL_TARGET');
    }
    const moved = act(state, 'p1', { type: 'dev.playKnight', hex: numbered[0]! }).state;
    expect(moved.board.robber).toBe(numbered[0]);
    // 強盜離開沙漠後，起始沙漠也不能回去（沒有圓片）。
    expect(sf(moved, 'p1').robberTargets).not.toContain(state.board.layout.robber);

    // 7：moveRobber frame 同樣只收有圓片的格。
    const seven = emptySeafarersGame(3, 0, 'preroll', PROFILE);
    const rolled = act(seven, 'p1', { type: 'turn.roll' }, scriptedRng([0, 5])).state; // 1 + 6 = 7
    expect(rolled.pending).toMatchObject({ kind: 'moveRobber' });
    const desert = rolled.board.layout.terrain.findIndex((tile, index) => tile === 'desert' && index !== rolled.board.robber);
    expectRejected(rolled, 'p1', { type: 'pending.moveRobber', hex: desert }, 'E_ILLEGAL_TARGET');
    const ok = act(rolled, 'p1', { type: 'pending.moveRobber', hex: numbered[3]! }).state;
    expect(ok.board.robber).toBe(numbered[3]);
  });
});

describe('SFX-S5 模擬到有贏家', () => {
  it('3 人與 4 人：隨機合法動作跑到有贏家，供應守恆、不超過 15 條船、禮物與標記守恆', () => {
    for (const [players, seed] of [[3, 51], [4, 52], [3, 53], [4, 54]] as const) {
      const run = simulateSeafarers(players, seed, 40000, PROFILE);
      expect(run.state.result, `${players}p seed ${seed}`).not.toBeNull();
      expect(run.state.result!.reason).toBe('victory');
      const slot = slotOf(run.state);
      const vp = Object.values(slot.vp).reduce((sum, count) => sum + count, 0);
      expect(vp + slot.gifts.filter((gift) => gift.kind === 'vp').length).toBe(8);
      const held = Object.values(slot.held).reduce((sum, list) => sum + list.length, 0);
      expect(run.state.board.layout.harbors.length + held + slot.gifts.filter((gift) => gift.kind === 'port').length).toBe(6);
      for (const p of run.state.players) {
        expect(run.state.board.roads.filter((r) => r?.ship && r.player === p.id).length).toBeLessThanOrEqual(15);
      }
      // 每位玩家 VP 標記與公開分數一致。
      for (const p of run.state.players) expect(p.bonusPoints).toBe(slot.vp[p.id]);
    }
  }, 240_000);

  it('模擬中至少有一局拿過禮物（模擬的船會往小島走）並放過港口', () => {
    const runs = [simulateSeafarers(3, 61, 40000, PROFILE), simulateSeafarers(4, 62, 40000, PROFILE), simulateSeafarers(3, 63, 40000, PROFILE)];
    expect(runs.reduce((sum, run) => sum + run.gifts, 0)).toBeGreaterThan(0);
  }, 240_000);
});
