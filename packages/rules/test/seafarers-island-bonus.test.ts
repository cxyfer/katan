/** 島嶼獎勵規則表（spec §5.1）：純函式與以 four-islands／new-world 規則驅動 claimIslands。 */

import { describe, expect, it } from 'vitest';
import { bonusIslands, claimIslands, islandsAt } from '../src/modules/seafarers/islands.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import type { ModuleContext } from '../src/modules/types.ts';
import { requireProfile } from '../src/profiles.ts';
import type { GameState } from '../src/types.ts';
import { emptySeafarersGame, settle } from './seafarers-helpers.ts';

const MAIN = { points: 2, skip: 'main' } as const;
const HOME = { points: 1, skip: 'home' } as const;

function ctxFor(profileId: string, events: unknown[] = []): ModuleContext {
  const profile = { ...requireProfile('sf-new-shores-2025'), islandBonus: requireProfile(profileId).islandBonus } as never;
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

describe('profile islandBonus', () => {
  const rule = (id: string) => requireProfile(id).islandBonus;

  it('每個劇本的模式', () => {
    for (const id of ['sf-new-shores-2025', 'sf-new-shores-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']) {
      expect(rule(id)).toEqual({ points: 2, skip: 'main' });
    }
    expect(rule('sf-four-islands-2025')).toEqual({ points: 2, skip: 'home' });
    expect(rule('sf-through-the-desert-2025')).toEqual({ points: 2, skip: 'main' });
    expect(rule('sf-wonders-of-catan-2025')).toEqual({ points: 1, skip: 'main' });
    expect(rule('sf-new-world-2025')).toEqual({ points: 1, skip: 'home' });
    for (const id of ['sf-fog-islands-2025', 'sf-forgotten-tribe-2025', 'sf-cloth-for-catan-2025', 'sf-pirate-islands-2025', 'base-2025']) {
      expect(rule(id)).toBeUndefined();
    }
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
    // 第 n 個「只碰到該島」的交叉點（不同的點，避免互相覆蓋）
    const extra = (id: number, n: number): number => {
      const found: number[] = [];
      state.board.buildings.forEach((_b, vertex) => {
        const ids = islandsAt(state, vertex);
        if (ids.length === 1 && ids[0] === id) found.push(vertex);
      });
      if (found.length <= n) throw new Error(`island ${id} has no vertex #${n}`);
      return found[n]!;
    };
    return { state, v: (id: number) => islands.get(id)!, extra, small, a: small[0]!, b: small[1]!, c: small[2]!, main: 1 };
  }

  it('home 劇本：設置不計分；別人島上第一個村落得分；home 不得分；同島第二個不重複', () => {
    const { state, extra, a, b, c, main } = setup();
    const events: unknown[] = [];
    const ctx = ctxFor('sf-four-islands-2025', events);
    const bonus = (id: string) => state.players.find((p) => p.id === id)!.bonusPoints;
    state.turn.phase = 'setup';
    state.turn.setup = { order: [0], index: 0 } as never;
    settle(state, 'p1', extra(main, 0));
    settle(state, 'p1', extra(a, 0)); // p1 的 home：主島 + a
    settle(state, 'p2', extra(b, 0)); // p2 的 home：b
    claimIslands(state, ctx); // 設置中：不記 home、不計分
    expect(seafarersState(state).home).toBeUndefined();
    state.turn.setup = null;
    claimIslands(state, ctx); // 設置最後一次 board change
    expect(seafarersState(state).home).toEqual({ p1: [main, a].sort((x, y) => x - y), p2: [b], p3: [] });
    expect(events).toEqual([]);
    expect([bonus('p1'), bonus('p2'), bonus('p3')]).toEqual([0, 0, 0]);

    state.turn.phase = 'action';
    // (b) p1 後來在自己的 home island a 再蓋一座：不得分
    settle(state, 'p1', extra(a, 1));
    claimIslands(state, ctx);
    expect(bonus('p1')).toBe(0);
    // (a) p2 到 p1 已有村落、且不是 p2 home 的島 a：仍得分
    settle(state, 'p2', extra(a, 2));
    claimIslands(state, ctx);
    expect(bonus('p2')).toBe(2);
    // p3 沒有 home：在 a（別人已在）得分，在 c 也得分
    settle(state, 'p3', extra(a, 3));
    settle(state, 'p3', extra(c, 0));
    claimIslands(state, ctx);
    expect(bonus('p3')).toBe(4);
    // (c) 同一非 home 島第二個村落不重複得分
    settle(state, 'p2', extra(a, 4));
    claimIslands(state, ctx);
    expect(bonus('p2')).toBe(2);
    expect(seafarersState(state).islands).toMatchObject({ p1: [], p2: [a], p3: [a, c].sort((x, y) => x - y) });
    expect(events).toHaveLength(3);
  });

  it('new-world 一座島 1 分', () => {
    const { state, v, a } = setup();
    const events: { params: { points: number } }[] = [];
    state.turn.phase = 'setup';
    state.turn.setup = null;
    settle(state, 'p1', v(1));
    claimIslands(state, ctxFor('sf-new-world-2025', events));
    state.turn.phase = 'action';
    settle(state, 'p2', v(a));
    claimIslands(state, ctxFor('sf-new-world-2025', events));
    expect(events.map((e) => e.params.points)).toEqual([1]);
    expect(state.players.find((p) => p.id === 'p2')!.bonusPoints).toBe(1);
  });

  it('主島劇本不記 home；無獎勵劇本什麼都不做', () => {
    const { state, v, a } = setup();
    const events: unknown[] = [];
    settle(state, 'p1', v(a));
    claimIslands(state, ctxFor('sf-fog-islands-2025', events));
    expect(events).toEqual([]);
    claimIslands(state, ctxFor('sf-wonders-of-catan-2025', events));
    expect(events).toHaveLength(1);
    expect(seafarersState(state).home).toBeUndefined();
  });
});
