/**
 * Land Ho! 的固定狀態決策（E&P 計畫 §4.3、§4.6、§4.7）：harbour 與 settler 的優先序、供應感知的 settler 守衛、
 * `endWindow` 跳過 Movement、金幣報價的拒絕、`extraMove` 的條件（standard、差 1 步、有羊毛）與 easy 的差異。
 */

import { describe, expect, it } from 'vitest';
import { getTopology, type GameState, type Offer } from '@katan/rules';
import { turnContext } from '../src/heuristic.ts';
import { epGeometry, foundVertices } from '../src/modules/explorersPirates/geometry.ts';
import { fleetOf, voyagesOf } from '../src/modules/explorersPirates/movement.ts';
import { settlerWanted } from '../src/modules/explorersPirates/plans.ts';
import { explorersPiratesTrade } from '../src/modules/explorersPirates/trade.ts';
import { epHints, epView } from '../src/modules/explorersPirates/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotLevel } from '../src/types.ts';
import { enterMovement, slotOf, toAction } from './ep-fixtures.ts';
import { viewFor } from './harness.ts';

const PROFILE = 'ep-land-ho-2025';
const NONE = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };

function setup(): { state: GameState; me: string } {
  const { state, me } = toAction(PROFILE, 3, 1);
  const player = state.players.find((entry) => entry.id === me)!;
  player.resources = { ...NONE };
  slotOf(state).gold[me] = 0;
  return { state, me };
}

const hand = (state: GameState, me: string, resources: Partial<typeof NONE>): void => {
  state.players.find((entry) => entry.id === me)!.resources = { ...NONE, ...resources };
};

function decide(state: GameState, me: string, level: BotLevel = 'standard'): BotCommand | null {
  return createBotPolicy(level).decide(viewFor(state, me), { selfId: me, level, seed: 1, offerPhases: {} });
}

/** 在自己的行動視窗放一座沿海的聚落（可升級為 harbour）。 */
function addCoastalSettlement(state: GameState, me: string): number {
  const topo = getTopology(state.board.layout.topologyId);
  const g = epGeometry(viewFor(state, me), epView(viewFor(state, me)))!;
  const vertex = topo.vertices.findIndex((info, index) => !state.board.buildings[index]
    && info.hexes.some((hex) => state.board.layout.terrain[hex] === 'sea' && !g.fog.has(hex))
    && info.hexes.some((hex) => g.ep.startIsland.includes(hex))
    && info.edges.every((edge) => topo.edges[edge]!.vertices.every((end) => !state.board.buildings[end])));
  state.board.buildings[vertex] = { player: me, city: false };
  return vertex;
}

describe('Action sub-phase', () => {
  it('upgrades a harbour before founding a settler, and a settler before a ship', () => {
    const { state, me } = setup();
    const vertex = addCoastalSettlement(state, me);
    expect(vertex).toBeGreaterThanOrEqual(0);
    // 穀 3、礦 2、磚木羊各 1：harbour 付得起，settler 也付得起；沒有合法的 base 聚落。
    hand(state, me, { grain: 3, ore: 2, brick: 1, lumber: 1, wool: 1 });
    const view = viewFor(state, me);
    expect(view.hints!.legalSettlements).toEqual([]);
    expect(decide(state, me)).toEqual({ type: 'ep.buildHarbor', vertex });
    // 沒有礦：harbour 付不起，換 settler（放在空的 harbour，船上已有 settler）。
    hand(state, me, { grain: 1, brick: 1, lumber: 1, wool: 1 });
    const settler = decide(state, me);
    expect(settler).toMatchObject({ type: 'ep.buildSettler' });
    // 只剩木與羊：造船（只有一艘，目標 2 艘）。
    hand(state, me, { lumber: 1, wool: 1 });
    expect(decide(state, me)).toMatchObject({ type: 'ep.buildShip' });
  });

  it('does not build a settler without room in the supply', () => {
    const { state, me } = setup();
    hand(state, me, { grain: 1, brick: 1, lumber: 1, wool: 1 });
    const view = viewFor(state, me);
    const ep = epView(view)!;
    const g = epGeometry(view, ep)!;
    expect(settlerWanted(g, me)).toBe(true);
    // 供應只剩 1 座 plain，而船上已有 1 個 settler：再造一個沒有位置定居。
    const crowded = JSON.parse(JSON.stringify(ep)) as typeof ep;
    crowded.players[me]!.supply.settlements = 1;
    expect(settlerWanted(epGeometry(view, crowded)!, me)).toBe(false);
    crowded.players[me]!.supply.settlements = 2;
    expect(settlerWanted(epGeometry(view, crowded)!, me)).toBe(true);
    // 兩個 settler 都在場：`settlersLeft` 為 0，策略不會再造。
    slotOf(state).harbors.find((harbor) => harbor.player === me)!.cargo = ['settler'];
    expect(epHints(viewFor(state, me).hints)!.settlersLeft).toBe(0);
    expect(decide(state, me)).not.toMatchObject({ type: 'ep.buildSettler' });
  });

  it('skips the Movement phase when no ship has anything to do, and enters it otherwise', () => {
    const { state, me } = setup();
    // 有帶 settler 的船與霧格：進入 Movement。
    expect(decide(state, me)).toEqual({ type: 'ep.startMovement' });
    // 霧格都揭露完、船上沒有 settler：沒有航程，直接結束回合。
    const slot = slotOf(state);
    slot.fog = [];
    for (const ship of slot.ships) ship.cargo = [];
    expect(decide(state, me)).toEqual({ type: 'turn.end' });
  });

  it('never sends Action-only commands in Movement', () => {
    const { state, me } = setup();
    hand(state, me, { grain: 3, ore: 3, brick: 2, lumber: 2, wool: 2 });
    enterMovement(state, null);
    for (const level of ['standard', 'easy'] as const) {
      const command = decide(state, me, level);
      expect(['ep.moveShip', 'ep.found', 'ep.extraMove', 'ep.load', 'turn.end']).toContain(command?.type);
    }
  });
});

describe('gold trades (rule 9)', () => {
  function offerState(): { state: GameState; actor: string; other: string } {
    const { state, me: actor } = setup();
    const other = state.players.find((player) => player.id !== actor)!.id;
    slotOf(state).gold[other] = 2;
    const offer: Offer = {
      id: 'o1', revision: 1, from: actor, to: 'all', give: { ore: 2, grain: 2 }, want: {}, windowId: state.windowId,
      giveGoods: {}, wantGoods: { gold: 2 }, status: 'open', responses: {}, agreedWith: null, createdSeq: state.seq,
    };
    state.offers.push(offer);
    state.players.find((player) => player.id === actor)!.resources = { ...NONE, ore: 3 };
    return { state, actor, other };
  }

  it('refuses an offer that would drop its gold below 1', () => {
    const { state, other } = offerState();
    expect(decide(state, other)).toEqual({ type: 'trade.respond', offerId: 'o1', response: 'declined' });
    expect(decide(state, other, 'easy')).toEqual({ type: 'trade.respond', offerId: 'o1', response: 'declined' });
  });

  it('accepts the same generous offer when it keeps 1 gold', () => {
    const { state, other } = offerState();
    state.offers[0]!.wantGoods = { gold: 1 };
    expect(decide(state, other)).toEqual({ type: 'trade.respond', offerId: 'o1', response: 'consented' });
  });

  it('values gold at 0.4 per coin received and 0.5 per coin paid, and knows no other good', () => {
    const { state, me } = setup();
    slotOf(state).gold[me] = 3;
    const turn = turnContext(viewFor(state, me), { selfId: me, level: 'standard', seed: 1, offerPhases: {} }, 'standard');
    const trade = explorersPiratesTrade;
    expect(trade.goods!(turn.view, me)).toEqual({ gold: 3 });
    expect(trade.goodValue!(turn, 'gold', 2, 'receive')).toBeCloseTo(0.8);
    expect(trade.goodValue!(turn, 'gold', 2, 'pay')).toBeCloseTo(1);
    expect(trade.goodValue!(turn, 'gold', 3, 'pay')).toBeNull();
    expect(trade.goodValue!(turn, 'fish', 1, 'receive')).toBeUndefined();
  });
});

describe('extra move', () => {
  const bestOf = (state: GameState, me: string) => {
    const view = viewFor(state, me);
    const turn = turnContext(view, { selfId: me, level: 'standard', seed: 1, offerPhases: {} }, 'standard');
    const ep = epView(view)!;
    const ship = ep.ships.find((entry) => entry.player === me)!;
    const g = epGeometry(view, ep)!;
    return { ship, g, voyages: voyagesOf(fleetOf(turn, g), ship, 4, false) };
  };

  /**
   * 沒有霧格、船上有 settler：只剩定居航程。把船移到眼前沒有可定居路口、最佳航程要走 3 步的海路邊，
   * 再讓這回合剩下 2 MP（差 1 步）。
   */
  function oneStepShort(): { state: GameState; me: string } {
    const { state, me } = setup();
    enterMovement(state, null);
    const slot = slotOf(state);
    slot.fog = [];
    const ship = slot.ships.find((entry) => entry.player === me)!;
    const topo = getTopology(state.board.layout.topologyId);
    for (let edge = 0; edge < topo.edges.length; edge++) {
      ship.edge = edge;
      const { voyages, g } = bestOf(state, me);
      if (foundVertices(g, edge, me).length > 0 || voyages[0]?.path.length !== 3) continue;
      slot.turn.ships[ship.id] = { used: 2, extra: false, done: false, tribute: false, chased: false };
      return { state, me };
    }
    throw new Error('no edge with a 3-step settling voyage');
  }

  it('buys it only as standard, with wool, when 1 step short', () => {
    const { state, me } = oneStepShort();
    hand(state, me, { wool: 3 });
    const ship = slotOf(state).ships.find((entry) => entry.player === me)!;
    expect(decide(state, me)).toEqual({ type: 'ep.extraMove', ship: ship.id });
    // easy 不買 extra move。
    expect(decide(state, me, 'easy')).toMatchObject({ type: 'ep.moveShip' });
    // 沒有羊毛：照常走一步。
    hand(state, me, {});
    expect(decide(state, me)).toMatchObject({ type: 'ep.moveShip' });
    // 已經買過：不重複買。
    slotOf(state).turn.ships[ship.id]!.extra = true;
    hand(state, me, { wool: 3 });
    expect(decide(state, me)).not.toMatchObject({ type: 'ep.extraMove' });
  });
});
