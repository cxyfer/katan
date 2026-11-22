/** 島嶼獎勵規則表（spec §5.1）：純函式與以 four-islands／new-world 規則驅動 claimIslands。 */

import { describe, expect, it } from 'vitest';
import { bonusIslands, claimIslands, islandBonusRule, islandsAt, ISLAND_BONUS_RULES } from '../src/modules/seafarers/islands.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import type { ModuleContext } from '../src/modules/types.ts';
import { requireProfile } from '../src/profiles.ts';
import type { GameState } from '../src/types.ts';
import { emptySeafarersGame, settle } from './seafarers-helpers.ts';

const MAIN = { points: 2, skip: 'main' } as const;
const HOME = { points: 1, skip: 'home' } as const;

function ctxFor(scenario: string | null, events: unknown[] = []): ModuleContext {
  const profile = { ...requireProfile('sf-new-shores-2025'), scenario } as never;
  return { profile, kit: { emit: (_s: GameState, type: string, params: unknown) => events.push({ type, params }) } } as never;
}

/** 新海岸版圖上，每座島各挑一個只碰到該島的交叉點。 */
function pureVertices(state: GameState): Map<number, number> {
  const out = new Map<number, number>();
  state.board.buildings.forEach((_b, vertex) => {
    const ids = islandsAt(state, vertex);
    if (ids.length === 1 && !out.has(ids[0]!)) out.set(ids[0]!, vertex);
  });
  return out;
}

describe('island bonus rule table', () => {
  it('每個劇本的模式', () => {
    expect(ISLAND_BONUS_RULES['new-shores']).toEqual({ points: 2, skip: 'main' });
    expect(ISLAND_BONUS_RULES['four-islands']).toEqual({ points: 2, skip: 'home' });
    expect(ISLAND_BONUS_RULES['through-the-desert']).toEqual({ points: 2, skip: 'main' });
    expect(ISLAND_BONUS_RULES['wonders-of-catan']).toEqual({ points: 1, skip: 'main' });
    expect(ISLAND_BONUS_RULES['new-world']).toEqual({ points: 1, skip: 'home' });
    for (const none of ['fog-islands', 'forgotten-tribe', 'cloth-for-catan', 'pirate-islands', 'tb-fishing']) {
      expect(ISLAND_BONUS_RULES[none]).toBeUndefined();
    }
    expect(islandBonusRule({ profile: { scenario: null } } as never)).toBeUndefined();
  });

  it('主島排除', () => {
    expect(bonusIslands(MAIN, [1])).toEqual([]);
    expect(bonusIslands(MAIN, [2, 3])).toEqual([2, 3]);
  });

  it('home 排除：只排除該玩家自己的 home islands', () => {
    expect(bonusIslands(HOME, [1, 2], [1])).toEqual([2]);
    expect(bonusIslands(HOME, [1, 2], [2])).toEqual([1]);
    expect(bonusIslands(HOME, [1], [])).toEqual([1]);
  });

  it('多島交叉點：排除後其餘各算一次（S4 沙漠與外地之間歸外地）', () => {
    expect(bonusIslands(MAIN, [1, 5])).toEqual([5]);
    expect(bonusIslands(MAIN, [3, 5])).toEqual([3, 5]);
  });
});

describe('claimIslands with scenario rules', () => {
  function setup() {
    const state = emptySeafarersGame(3);
    const islands = pureVertices(state);
    const small = [...islands.keys()].filter((id) => id !== 1);
    return { state, v: (id: number) => islands.get(id)!, small, a: small[0]!, b: small[1]!, main: 1 };
  }

  it('home 劇本：設置階段不計分，結束時記 home，之後 home 不得分、其他島得分', () => {
    const { state, v, a, b, main, small } = setup();
    const events: unknown[] = [];
    const ctx = ctxFor('four-islands', events);
    state.turn.phase = 'setup';
    state.turn.setup = { order: [0], index: 0 } as never;
    settle(state, 'p1', v(main));
    settle(state, 'p1', v(a));
    settle(state, 'p2', v(b));
    claimIslands(state, ctx); // 設置中：不記 home、不計分
    expect(seafarersState(state).home).toBeUndefined();
    state.turn.setup = null;
    claimIslands(state, ctx); // 設置最後一次 board change
    expect(seafarersState(state).home).toEqual({ p1: [main, a].sort((x, y) => x - y), p2: [b], p3: [] });
    expect(events).toEqual([]);
    state.turn.phase = 'action';
    const bonus = (id: string) => state.players.find((p) => p.id === id)!.bonusPoints;
    settle(state, 'p3', v(a)); // p3 沒有 home：得分；別人已在該島也一樣
    settle(state, 'p2', v(small[2]!));
    claimIslands(state, ctx);
    expect(bonus('p1')).toBe(0); // p1 的 home 不計分
    expect([bonus('p2'), bonus('p3')]).toEqual([2, 2]);
    expect(seafarersState(state).islands).toMatchObject({ p1: [], p2: [small[2]], p3: [a] });
    expect(events).toHaveLength(2);
    // 各算各的：再蓋同島不重複
    claimIslands(state, ctx);
    expect(events).toHaveLength(2);
  });

  it('new-world 一座島 1 分', () => {
    const { state, v, a } = setup();
    const events: { params: { points: number } }[] = [];
    state.turn.phase = 'setup';
    state.turn.setup = null;
    settle(state, 'p1', v(1));
    claimIslands(state, ctxFor('new-world', events));
    state.turn.phase = 'action';
    settle(state, 'p2', v(a));
    claimIslands(state, ctxFor('new-world', events));
    expect(events.map((e) => e.params.points)).toEqual([1]);
    expect(state.players.find((p) => p.id === 'p2')!.bonusPoints).toBe(1);
  });

  it('主島劇本不記 home；無獎勵劇本什麼都不做', () => {
    const { state, v, a } = setup();
    const events: unknown[] = [];
    settle(state, 'p1', v(a));
    claimIslands(state, ctxFor('fog-islands', events));
    expect(events).toEqual([]);
    claimIslands(state, ctxFor('wonders-of-catan', events));
    expect(events).toHaveLength(1);
    expect(seafarersState(state).home).toBeUndefined();
  });
});
