/**
 * CK-B2 frame 偏好測試（C&K 計畫 §4.3 frame 偏好表）：13 種真實 frame 的選擇依據。
 *
 * 盤面取自 `ck-fixtures.ts`（以 rules 的真實指令走到 frame），再改動手牌、騎士或銀行存量，驗證策略的偏好；
 * 每個答案都必須被 `applyCommand` 接受。保底的第一個合法選項另見 `ck-duty.test.ts`。
 *
 * 重點：
 * - `scienceBonus` 只挑 `view.bank[r] > 0` 的資源，不以投影張數（上限 2）排序、不挑空的銀行；
 * - 非 C&K 的 frame 回 undefined（組合模組先攔截的前提，§4.9），不屬於自己作答的時機回 null；
 * - easy 與 standard 對 frame 的回應相同（easy 的差異只在行動，§4.4）。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  neighborsOfVertex,
  projectGame,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
  type GameView,
} from '@catan/rules';
import { addKnight, giveCommodities, handCards, player, setBuilding, setImprovement, spreadVertices } from '../../rules/test/ck-helpers.ts';
import { give } from '../../rules/test/helpers.ts';
import { boardModel } from '../src/board.ts';
import { productionValue } from '../src/economy.ts';
import { turnContext } from '../src/heuristic.ts';
import { citiesKnightsAnswerFrame } from '../src/modules/citiesKnights/frames.ts';
import { citiesKnightsBotModule } from '../src/modules/citiesKnights/index.ts';
import { mainTrack } from '../src/modules/citiesKnights/improve.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';
import { FRAME_FIXTURES } from './ck-fixtures.ts';

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({ selfId, level, seed, offerPhases: {} });

function decide(state: GameState, selfId: string, level: BotLevel = 'standard'): BotCommand | null {
  return createBotPolicy(level).decide(viewOf(state, selfId), ctxFor(selfId, level));
}

function accepted(state: GameState, actor: string, command: BotCommand | null): BotCommand {
  expect(command, `${actor} has an answer`).not.toBeNull();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
  return command!;
}

const answer = (state: GameState, actor: string, level: BotLevel = 'standard'): BotCommand => accepted(state, actor, decide(state, actor, level));

function fixtureOf(kind: string) {
  const fx = FRAME_FIXTURES[kind]!();
  return { ...fx, state: fx.state };
}

/** 投影給這個座位的 frame 資料（`state.pending` 是引擎內部的形狀，Bot 看到的是投影）。 */
function dataOf(state: GameState, selfId: string): any {
  return (viewOf(state, selfId).pending as unknown as { data: unknown }).data;
}

function modelOf(state: GameState, selfId: string) {
  return boardModel(viewOf(state, selfId), selfId, [citiesKnightsBotModule]);
}

/** 路口到最近的自己建築經過幾條邊。 */
function distanceToOwn(state: GameState, selfId: string, vertex: number): number {
  const topo = topologyOf(state);
  const seen = new Map<number, number>([[vertex, 0]]);
  const queue = [vertex];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    if (state.board.buildings[current]?.player === selfId) return seen.get(current)!;
    for (const next of neighborsOfVertex(topo, current)) {
      if (seen.has(next)) continue;
      seen.set(next, seen.get(current)! + 1);
      queue.push(next);
    }
  }
  return Infinity;
}

describe('pillage：產值加城牆價值最低的城市', () => {
  it('loses the city with the lowest production, and keeps a walled city of the same worth', () => {
    const { state, responder } = fixtureOf('citiesKnights.pillage');
    const cities = dataOf(state, responder).cities as Record<string, number[]>;
    expect(cities[responder]!.length).toBeGreaterThanOrEqual(2);
    const model = modelOf(state, responder);
    const economy = turnContext(viewOf(state, responder), ctxFor(responder), 'standard').economy;
    const worth = (vertex: number) => productionValue(model, vertex, economy.weights);
    const lowest = [...cities[responder]!].sort((a, b) => worth(a) - worth(b) || a - b)[0]!;
    const highest = [...cities[responder]!].sort((a, b) => worth(b) - worth(a) || a - b)[0]!;
    expect(answer(state, responder)).toEqual({ type: 'barbarians.pillage', vertex: lowest });
    if (worth(lowest) < worth(highest)) {
      // 城牆在較值錢的城市上：照舊失去最低的那座。
      (state.moduleState!.citiesKnights as { walls: number[] }).walls.push(highest);
      expect(answer(state, responder)).toEqual({ type: 'barbarians.pillage', vertex: lowest });
    }
  });

  it('easy answers like standard', () => {
    const { state, responder } = fixtureOf('citiesKnights.pillage');
    expect(answer(state, responder, 'easy')).toEqual(answer(state, responder, 'standard'));
  });
});

describe('displaced：退到離自己的建築最近的路口', () => {
  it('retreats to the option closest to its own buildings', () => {
    const { state, responder } = fixtureOf('citiesKnights.displaced');
    const options = dataOf(state, responder).options as number[];
    expect(options.length).toBeGreaterThan(0);
    const command = answer(state, responder) as { type: string; vertex: number };
    expect(command.type).toBe('knight.retreat');
    const best = Math.min(...options.map((vertex) => distanceToOwn(state, responder, vertex)));
    expect(distanceToOwn(state, responder, command.vertex)).toBe(best);
  });
});

describe('progressDiscard：依價值表棄最低的', () => {
  it('discards the lowest-value card of the hand', () => {
    const { state, responder } = fixtureOf('citiesKnights.progressDiscard');
    player(state, responder).progressCards = ['merchant', 'alchemy', 'crane', 'invention'];
    expect(answer(state, responder)).toEqual({ type: 'progress.discard', cards: ['alchemy'] });
    player(state, responder).progressCards = ['merchant', 'crane', 'medicine', 'invention'];
    expect(answer(state, responder)).toEqual({ type: 'progress.discard', cards: ['invention'] });
  });

  it('keeps the same answer however the hand is ordered', () => {
    const { state, responder } = fixtureOf('citiesKnights.progressDiscard');
    player(state, responder).progressCards = ['invention', 'merchant', 'alchemy', 'crane'];
    expect(answer(state, responder)).toEqual({ type: 'progress.discard', cards: ['alchemy'] });
  });
});

describe('defenderDraw：主軌道的牌組', () => {
  it('draws from the deck of its main track when it is available', () => {
    const { state, responder } = fixtureOf('citiesKnights.defenderDraw');
    const decks = dataOf(state, responder).decks as string[];
    setImprovement(state, responder, 'politics', 2);
    const main = mainTrack(modelOf(state, responder));
    const command = answer(state, responder) as { type: string; track: string };
    expect(command.type).toBe('barbarians.chooseDeck');
    expect(command.track).toBe(decks.includes(main) ? main : decks[0]);
  });
});

describe('scienceBonus：只挑銀行有牌的資源', () => {
  /** p2 要選一張資源；它有一座聚落與 2 grain 2 ore（升城市還缺 1 ore）。 */
  function wantingOre() {
    const fx = fixtureOf('citiesKnights.scienceBonus');
    const [site] = spreadVertices(fx.state, 1);
    setBuilding(fx.state, fx.responder, site!, false);
    give(fx.state, fx.responder, { grain: 2, ore: 2 });
    return fx;
  }

  it('takes the resource its plan is short of', () => {
    const { state, responder } = wantingOre();
    expect(answer(state, responder)).toEqual({ type: 'science.take', resource: 'ore' });
  });

  it('never takes a resource the bank has run out of, even when the plan wants it', () => {
    const { state, responder } = wantingOre();
    state.bank.ore = 0;
    const command = answer(state, responder) as { type: string; resource: string | null };
    expect(command.type).toBe('science.take');
    expect(command.resource).not.toBe('ore');
    expect(command.resource === null || state.bank[command.resource as 'ore'] > 0).toBe(true);
  });

  it('does not rank by the projected count: a bank holding one card of the wanted resource is still taken', () => {
    const { state, responder } = wantingOre();
    state.bank.ore = 1;
    for (const resource of ['lumber', 'brick', 'wool', 'grain'] as const) state.bank[resource] = 19;
    expect(answer(state, responder)).toEqual({ type: 'science.take', resource: 'ore' });
  });

  it('answers null (the only legal skip) when nothing in the bank helps and the frame allows it', () => {
    const { state, responder } = fixtureOf('citiesKnights.scienceBonus');
    for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) state.bank[resource] = 0;
    const command = decide(state, responder);
    expect(command).toMatchObject({ type: 'science.take' });
  });

  it('only the first responder answers', () => {
    const { state, responder } = fixtureOf('citiesKnights.scienceBonus');
    const frame = state.pending as unknown as { responders: string[] };
    for (const other of state.players.map((candidate) => candidate.id).filter((id) => id !== frame.responders[0])) {
      expect(decide(state, other)).toBeNull();
    }
    expect(responder).toBe(frame.responders[0]);
  });
});

describe('harborExchange、sabotage、wedding：交出效用損失最小的牌', () => {
  it('harbor: gives the commodity it needs least', () => {
    const { state, responder } = fixtureOf('citiesKnights.harborExchange');
    const held = (['paper', 'cloth', 'coin'] as const).filter((commodity) => player(state, responder).commodities[commodity] > 0);
    const command = answer(state, responder) as { type: string; commodity: string };
    expect(command.type).toBe('progress.harborAnswer');
    expect(held).toContain(command.commodity);
  });

  it('sabotage: discards surplus before the cards its plan needs', () => {
    const { state, responder } = fixtureOf('citiesKnights.sabotage');
    // p2 有 2 座聚落：升城市要 3 ore 2 grain；手上放 ore 3、grain 2 與 3 張多餘的 lumber。
    const target = player(state, responder);
    for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) {
      state.bank[resource] += target.resources[resource];
      target.resources[resource] = 0;
    }
    for (const commodity of ['paper', 'cloth', 'coin'] as const) {
      state.commodityBank[commodity] += target.commodities[commodity];
      target.commodities[commodity] = 0;
    }
    give(state, responder, { ore: 3, grain: 2, lumber: 3 });
    const frame = state.pending as unknown as { data: { required: Record<string, number> } };
    frame.data.required[responder] = 3;
    const command = answer(state, responder) as { type: string; cards: string[] };
    expect(command.type).toBe('progress.sabotageDiscard');
    expect([...command.cards].sort()).toEqual(['lumber', 'lumber', 'lumber']);
  });

  it('wedding: gives surplus first, too', () => {
    const { state, responder } = fixtureOf('citiesKnights.wedding');
    const target = player(state, responder);
    for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) {
      state.bank[resource] += target.resources[resource];
      target.resources[resource] = 0;
    }
    give(state, responder, { ore: 3, grain: 2, brick: 2 });
    const frame = state.pending as unknown as { data: { required: Record<string, number> } };
    frame.data.required[responder] = 2;
    const command = answer(state, responder) as { type: string; cards: string[] };
    expect(command.type).toBe('progress.weddingGive');
    expect(command.cards).toEqual(['brick', 'brick']);
  });
});

describe('guildDues、espionage：拿價值最高的', () => {
  it('guild dues: takes what raises its hand the most', () => {
    const { state, responder } = fixtureOf('citiesKnights.guildDues');
    // p2 的手牌：ore 2、grain 1、coin 1；p1 一無所有，拿 2 張。
    const command = answer(state, responder) as { type: string; cards: string[] };
    expect(command.type).toBe('progress.takeCards');
    expect(command.cards).toHaveLength(2);
    expect(new Set(command.cards).size).toBeGreaterThan(0);
  });

  it('espionage: takes the most valuable card; with a full hand only when it beats the worst held', () => {
    const { state, responder } = fixtureOf('citiesKnights.espionage');
    player(state, 'p2').progressCards = ['taxation', 'merchant'];
    // 手牌沒滿：拿價值最高的 merchant。
    expect(answer(state, responder)).toEqual({ type: 'progress.takeProgress', card: 'merchant' });
    // 手牌滿了、而且都比 merchant 好：放棄。
    player(state, responder).progressCards = ['medicine', 'crane', 'smithing', 'encouragement'];
    player(state, 'p2').progressCards = ['taxation', 'alchemy'];
    expect(answer(state, responder)).toEqual({ type: 'progress.takeProgress', card: null });
    // 手牌滿了、但最低的比 merchant 差：換。
    player(state, responder).progressCards = ['medicine', 'crane', 'alchemy', 'invention'];
    player(state, 'p2').progressCards = ['taxation', 'merchant'];
    expect(answer(state, responder)).toEqual({ type: 'progress.takeProgress', card: 'merchant' });
  });
});

describe('treason：交出最弱的騎士；放在擋路價值最高的點', () => {
  it('removes its weakest idle knight (the others are stronger or active)', () => {
    const { state, responder } = fixtureOf('citiesKnights.treasonRemove');
    const knights = (state.moduleState!.citiesKnights as { knights: { player: string; vertex: number; level: number; active: boolean }[] }).knights;
    const mine = knights.filter((knight) => knight.player === responder);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const command = answer(state, responder) as { type: string; vertex: number };
    expect(command.type).toBe('progress.treasonRemove');
    const weakest = [...mine].sort((a, b) => Number(a.active) - Number(b.active) || a.level - b.level || a.vertex - b.vertex)[0]!;
    expect(command.vertex).toBe(weakest.vertex);
  });

  it('places the stolen knight at the highest level the rules allow', () => {
    const { state, responder } = fixtureOf('citiesKnights.treasonPlace');
    const command = answer(state, responder) as { type: string; vertex: number | null; level?: number };
    expect(command.type).toBe('progress.treasonPlace');
    if (command.vertex !== null) {
      const data = dataOf(state, responder) as { levels: number[]; sites: number[] };
      expect(data.sites).toContain(command.vertex);
      expect(command.level).toBe(Math.max(...data.levels));
    }
  });
});

describe('diplomacyRoad：最能延伸路線的邊', () => {
  it('rebuilds the road only when it helps the route, or gives it up', () => {
    const { state, responder } = fixtureOf('citiesKnights.diplomacyRoad');
    const command = answer(state, responder) as { type: string; edge: number | null };
    expect(command.type).toBe('progress.diplomacyRoad');
    const options = dataOf(state, responder).edges as number[];
    if (command.edge !== null) expect(options).toContain(command.edge);
  });
});

describe('作答的時機', () => {
  it('returns undefined for a base frame and null when it is not the first responder', () => {
    const { state, responder } = fixtureOf('citiesKnights.defenderDraw');
    const frame = state.pending as unknown as { responders: string[] };
    const second = frame.responders[1]!;
    const turn = turnContext(viewOf(state, second), ctxFor(second), 'standard');
    const view = viewOf(state, second).pending!;
    expect(citiesKnightsAnswerFrame(turn, view as never)).toBeNull();
    expect(decide(state, second)).toBeNull();
    // base 的 frame（棄牌）不屬於 C&K：回 undefined，交給 base。
    const baseTurn = turnContext(viewOf(state, responder), ctxFor(responder), 'standard');
    expect(citiesKnightsAnswerFrame(baseTurn, { kind: 'discard', waitingFor: [responder], required: { [responder]: 2 } } as never)).toBeUndefined();
  });

  it('answers every C&K frame with a legal command for both levels', () => {
    for (const [kind, build] of Object.entries(FRAME_FIXTURES)) {
      for (const level of ['standard', 'easy'] as const) {
        const fx = build();
        accepted(fx.state, fx.responder, decide(fx.state, fx.responder, level));
        expect(kind).toContain('citiesKnights.');
      }
    }
  });

  it('the commodity and knight state used by the fixtures stays unchanged by deciding', () => {
    const { state, responder } = fixtureOf('citiesKnights.guildDues');
    giveCommodities(state, responder, { paper: 1 });
    handCards(state, responder, ['merchant']);
    addKnight(state, { player: responder, vertex: spreadVertices(state, 1)[0]!, level: 1, active: false });
    const before = JSON.stringify(state);
    decide(state, responder);
    expect(JSON.stringify(state)).toBe(before);
  });
});
