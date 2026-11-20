/**
 * Traders 策略的固定盤面測試（T&B 計畫 §4.2 Traders 列、§4.4；S7）。每個主要決策一個情境，斷言選擇合理而且引擎接受：
 *
 * - 路線：有貨時沿 MP 最短路徑走到需要它的據點並送達；
 * - 過路費與準備金：gold 只剩準備金時不走收費路線（除非這一次移動就能送達），沒有 gold 時只走不收費的路線；
 * - 加速：差 1–2 MP 送不到時 standard 花 1 grain 加速並送達，easy 不加速；
 * - 升級：能讓這回合多送一次貨時 standard 升級，easy 沒有升級計畫；
 * - 蠻族騎士卡：standard 在 preroll 打出，移走自己路線上的蠻族、放到有手牌的對手道路上；easy 不在 preroll 打；
 * - 擲出 7 的 `tbBarbarian`：同一套挑選，偷到對手的牌；
 * - Swift Journey：一次移動送不到、兩次送得到時 standard 打出，回合結束時用兩次移動送達；
 * - 每個 frame 最多 12 個指令，之後改送 `tb.wagonStop`；
 * - 不為最長道路鋪路（`awards`）。
 *
 * 盤面由 rules 的測試工具建構：`tbPlayable` 走完 setup，再清空道路與建築，直接改車隊、蠻族與手牌。
 */

import { describe, expect, it } from 'vitest';
import { topologyOf, TRADERS_BARBARIANS, type Command, type GameState, type GameView } from '@catan/rules';
import { act, give, placeRoad, scriptedRng, setHand } from '../../rules/test/helpers.ts';
import { clearBoard, tbPlayable } from '../../rules/test/tb-helpers.ts';
import { longestRoadAwarded } from '../src/economy.ts';
import { turnContext } from '../src/heuristic.ts';
import { UPGRADE_PLAN, wagonLeg, WAGON_FRAME_COMMANDS, type WagonLeg } from '../src/modules/tradersBarbarians/traders.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotLevel } from '../src/types.ts';
import { viewFor } from './harness.ts';

const PROFILE = 'tb-traders-barbarians-2025';
const WAGON_FRAME = 'tradersBarbarians.tbWagon';

interface Slot {
  sites: { id: string; plaza: number }[];
  barbarians: number[];
  wagons: Record<string, { vertex: number; level: number; cargo: string | null; delivered: number }>;
  stacks: Record<string, string[]>;
}

function slotOf(state: GameState): Slot {
  return (state.moduleState![TRADERS_BARBARIANS] as Record<string, Slot>)['tb-traders-barbarians']!;
}

function setGold(state: GameState, playerId: string, amount: number): void {
  const coins = (state.moduleState![TRADERS_BARBARIANS] as Record<string, { gold: Record<string, number>; supply: number }>)['tb-coins']!;
  coins.supply += coins.gold[playerId]! - amount;
  coins.gold[playerId] = amount;
}

/** setup 之後、清空道路與建築的 3 人局；p1 在 `phase`，手牌清空。 */
function board(phase: 'preroll' | 'action' = 'action'): GameState {
  const state = tbPlayable(PROFILE, { players: 3, seed: 11, phase });
  clearBoard(state);
  for (const player of state.players) setHand(state, player.id, {});
  return state;
}

function decide(state: GameState, playerId: string, level: BotLevel = 'standard', view?: GameView): BotCommand | null {
  return createBotPolicy(level).decide(view ?? viewFor(state, playerId), { selfId: playerId, level, seed: 5, offerPhases: {} });
}

function legOf(state: GameState, playerId = 'p1', reach?: number): WagonLeg | null {
  return wagonLeg(viewFor(state, playerId), topologyOf(state), playerId, reach);
}

const quarry = (state: GameState): number => slotOf(state).sites.find((site) => site.id === 'quarry')!.plaza;

/** 兩端都不在 quarry 格上的邊（放蠻族用，不影響 quarry 附近的路線），依編號遞增。 */
function farEdges(state: GameState): number[] {
  const topo = topologyOf(state);
  const hex = topo.vertices[quarry(state)]!.hexes[0]!;
  return topo.edges.flatMap((info, edge) =>
    info.vertices.some((vertex) => topo.vertices[vertex]!.hexes.includes(hex)) ? [] : [edge],
  );
}

/** 載著 `cargo` 的 p1 車隊，放在第一個讓路線 MP 落在 `[min, max]`、而且路上沒有蠻族的路口。 */
function placeWagon(state: GameState, cargo: string | null, min: number, max: number): WagonLeg {
  const wagon = slotOf(state).wagons.p1!;
  wagon.cargo = cargo;
  const plazas = new Set(slotOf(state).sites.map((site) => site.plaza));
  for (let vertex = 0; vertex < topologyOf(state).vertices.length; vertex++) {
    if (plazas.has(vertex)) continue;
    wagon.vertex = vertex;
    const leg = legOf(state);
    if (leg && leg.mp >= min && leg.mp <= max && leg.edges.length >= 2 && leg.costs.every((cost) => cost <= 2)) return leg;
  }
  throw new Error(`no vertex with a ${min}–${max} MP leg`);
}

/** 結束 p1 的回合，開出 `tbWagon` frame。 */
function endTurn(state: GameState): GameState {
  const next = act(state, 'p1', { type: 'turn.end' }).state;
  expect(next.pending?.kind).toBe(WAGON_FRAME);
  return next;
}

/** 依策略把 frame 走完；回傳送出的指令與最後的狀態。 */
function driveFrame(state: GameState, level: BotLevel = 'standard'): { commands: BotCommand[]; state: GameState } {
  const commands: BotCommand[] = [];
  let current = state;
  while (current.pending?.kind === WAGON_FRAME) {
    const command = decide(current, 'p1', level);
    expect(command, 'a wagon command').not.toBeNull();
    commands.push(command!);
    current = act(current, 'p1', command as Command).state;
    expect(commands.length).toBeLessThanOrEqual(WAGON_FRAME_COMMANDS + 2);
  }
  return { commands, state: current };
}

describe('Traders wagon routes', () => {
  it('walks the MP-shortest path to the site that needs the cargo and delivers it', () => {
    const state = board();
    const leg = placeWagon(state, 'tools', 3, 4);
    expect(leg.target).toBe(quarry(state));
    expect(leg.delivers).toBe(true);
    // 中途不經過任何廣場。
    const plazas = new Set(slotOf(state).sites.map((site) => site.plaza));
    expect(leg.vertices.slice(1, -1).filter((vertex) => plazas.has(vertex))).toEqual([]);
    const { commands, state: after } = driveFrame(endTurn(state));
    expect(commands.map((command) => command.type)).toEqual(leg.vertices.slice(1).map(() => 'tb.wagonStep'));
    expect(commands.map((command) => (command as { to?: number }).to)).toEqual(leg.vertices.slice(1));
    expect(slotOf(after).wagons.p1).toMatchObject({ vertex: quarry(state), delivered: 1 });
  });

  it('goes to the nearest site with a stack when the wagon is empty', () => {
    const state = board();
    const leg = placeWagon(state, null, 2, 4);
    expect(leg.delivers).toBe(false);
    const { state: after } = driveFrame(endTurn(state));
    expect(slotOf(after).wagons.p1!.vertex).toBe(leg.target);
    expect(slotOf(after).wagons.p1!.cargo).not.toBeNull();
  });

  /** p1 的車在 quarry 廣場旁的路口 `corner`，`corner`–廣場那條邊是 p2 的道路（收費）。 */
  function tollBoard(cargo: string | null, gold: number): { state: GameState; toll: number } {
    const state = board();
    const topo = topologyOf(state);
    const plaza = quarry(state);
    const toll = topo.vertices[plaza]!.edges[0]!;
    const corner = topo.edges[toll]!.vertices.find((vertex) => vertex !== plaza)!;
    placeRoad(state, 'p2', toll);
    slotOf(state).barbarians = farEdges(state).slice(0, 3);
    Object.assign(slotOf(state).wagons.p1!, { vertex: corner, cargo });
    setGold(state, 'p1', gold);
    return { state, toll };
  }

  it('pays a toll when it can spare the gold, and keeps the 1-gold reserve otherwise', () => {
    // 有餘裕：收費路線（1 MP + 1 gold）比繞路（4 MP）便宜。
    const rich = tollBoard(null, 5);
    expect(legOf(rich.state)).toMatchObject({ tolls: 1, edges: [rich.toll] });
    // 只剩準備金：不送貨的路線不付過路費，改繞路。
    const reserve = tollBoard(null, 1);
    const detour = legOf(reserve.state)!;
    expect(detour.tolls).toBe(0);
    expect(detour.target).toBe(quarry(reserve.state));
    const step = decide(endTurn(reserve.state), 'p1');
    expect(step).toMatchObject({ type: 'tb.wagonStep', to: detour.vertices[1] });
    // 這一次移動就能送達（會拿回 gold）時可以用到準備金。
    const delivering = tollBoard('tools', 1);
    expect(legOf(delivering.state, 'p1', 4)).toMatchObject({ tolls: 1, delivers: true });
    const { state: after } = driveFrame(endTurn(delivering.state));
    expect(slotOf(after).wagons.p1!.delivered).toBe(1);
    // 沒有 gold：只能走不收費的路線。
    expect(legOf(tollBoard('tools', 0).state)!.tolls).toBe(0);
  });
});

describe('Traders boost and upgrade', () => {
  it('boosts with 1 grain when 2 more MP deliver this turn (standard only)', () => {
    const state = board();
    placeWagon(state, 'tools', 5, 6);
    give(state, 'p1', { grain: 1 });
    const frame = endTurn(state);
    expect(decide(frame, 'p1', 'easy')).toMatchObject({ type: 'tb.wagonStep' });
    const { commands, state: after } = driveFrame(frame);
    expect(commands[0]).toEqual({ type: 'tb.wagonBoost' });
    expect(slotOf(after).wagons.p1!.delivered).toBe(1);
    // easy 走到 MP 用完就停，這回合送不到。
    const easy = driveFrame(endTurn(cloneBoard(state)), 'easy');
    expect(easy.commands.some((command) => command.type === 'tb.wagonBoost')).toBe(false);
    expect(slotOf(easy.state).wagons.p1!.delivered).toBe(0);
  });

  it('upgrades the wagon when the extra MP delivers this turn; easy has no upgrade plan', () => {
    // 第 2 級 5 MP：6 MP 的路線差一點，升到第 3 級（6 MP）就送得到。
    const state = board();
    slotOf(state).wagons.p1!.level = 2;
    placeWagon(state, 'tools', 6, 6);
    give(state, 'p1', { lumber: 1, wool: 1, ore: 1 });
    const view = viewFor(state, 'p1');
    const standard = turnContext(view, { selfId: 'p1', level: 'standard', seed: 5, offerPhases: {} }, 'standard');
    const plan = standard.economy.plans.find((candidate) => candidate.kind === UPGRADE_PLAN);
    expect(plan?.value, 'one more delivery this turn').toBeGreaterThanOrEqual(1);
    const easy = turnContext(view, { selfId: 'p1', level: 'easy', seed: 5, offerPhases: {} }, 'easy');
    expect(easy.economy.plans.some((candidate) => candidate.kind === UPGRADE_PLAN)).toBe(false);

    const command = decide(state, 'p1');
    expect(command).toEqual({ type: 'tb.upgradeWagon' });
    const upgraded = act(state, 'p1', command as Command).state;
    expect(slotOf(upgraded).wagons.p1!.level).toBe(3);
    const { state: after } = driveFrame(endTurn(upgraded));
    expect(slotOf(after).wagons.p1!.delivered).toBe(1);
  });

  it('does not plan for Longest Road (the scenario has none)', () => {
    const state = board();
    const turn = turnContext(viewFor(state, 'p1'), { selfId: 'p1', level: 'standard', seed: 5, offerPhases: {} }, 'standard');
    expect(longestRoadAwarded(turn.model)).toBe(false);
    expect(turn.economy.plans.some((plan) => plan.kind === 'longestRoad')).toBe(false);
  });
});

function cloneBoard(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

describe('Traders barbarians and cards', () => {
  /** p1 的路線經過一個蠻族（p1 自己的道路讓這條路仍是最短）；p2 有道路與手牌。 */
  function blockedBoard(phase: 'preroll' | 'action'): { state: GameState; blocked: number; p2Road: number } {
    const state = board(phase);
    const topo = topologyOf(state);
    const plaza = quarry(state);
    const blocked = topo.vertices[plaza]!.edges[0]!;
    const corner = topo.edges[blocked]!.vertices.find((vertex) => vertex !== plaza)!;
    placeRoad(state, 'p1', blocked);
    const slot = slotOf(state);
    const far = farEdges(state);
    const p2Road = far.at(-1)!;
    slot.barbarians = [blocked, far[0]!, far[1]!];
    placeRoad(state, 'p2', p2Road);
    give(state, 'p2', { brick: 2 });
    Object.assign(slot.wagons.p1!, { vertex: corner, cargo: 'tools' });
    expect(legOf(state)?.edges).toEqual([blocked]);
    return { state, blocked, p2Road };
  }

  it('plays a Barbarian Knight in preroll: moves the barbarian off its route onto a rival road with cards', () => {
    const { state, blocked, p2Road } = blockedBoard('preroll');
    state.players[0]!.devCards = ['barbarianKnight'];
    expect(decide(state, 'p1', 'easy')).toEqual({ type: 'turn.roll' });
    const command = decide(state, 'p1');
    expect(command).toEqual({ type: 'tb.playKnight', from: blocked, to: p2Road });
    const after = act(state, 'p1', command as Command).state;
    expect(after.players[0]!.playedKnights).toBe(1);
    expect(slotOf(after).barbarians).toContain(p2Road);
    expect(after.players[0]!.resources.brick).toBe(1);
  });

  it('easy plays the knight in the action phase instead', () => {
    const { state, blocked } = blockedBoard('action');
    state.players[0]!.devCards = ['barbarianKnight'];
    const command = decide(state, 'p1', 'easy');
    expect(command).toMatchObject({ type: 'tb.playKnight', from: blocked });
    act(state, 'p1', command as Command);
  });

  it('moves a barbarian the same way when a 7 is rolled', () => {
    const { state, blocked, p2Road } = blockedBoard('preroll');
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scripted7()).state;
    expect(rolled.pending?.kind).toBe('tradersBarbarians.tbBarbarian');
    for (const level of ['standard', 'easy'] as const) {
      const command = decide(rolled, 'p1', level);
      expect(command).toEqual({ type: 'tb.moveBarbarian', from: blocked, to: p2Road });
      const after = act(rolled, 'p1', command as Command).state;
      expect(after.players[0]!.resources.brick).toBe(1);
    }
  });

  it('plays Swift Journey when two move actions deliver this turn and one does not', () => {
    const state = board();
    placeWagon(state, 'tools', 8, 8);
    state.players[0]!.devCards = ['swiftJourney'];
    expect(decide(state, 'p1', 'easy')).toEqual({ type: 'turn.end' });
    const command = decide(state, 'p1');
    expect(command).toEqual({ type: 'tb.playSwiftJourney' });
    const played = act(state, 'p1', command as Command).state;
    const { commands, state: after } = driveFrame(endTurn(played));
    expect(slotOf(after).wagons.p1!.delivered).toBe(1);
    expect(commands.filter((entry) => entry.type === 'tb.wagonStop').length).toBeGreaterThanOrEqual(1);
  });

  it(`stops after ${WAGON_FRAME_COMMANDS} commands in one frame`, () => {
    const state = board();
    placeWagon(state, 'tools', 5, 8);
    const frame = endTurn(state);
    const view = viewFor(frame, 'p1');
    expect(decide(frame, 'p1', 'standard', view)).toMatchObject({ type: 'tb.wagonStep' });
    const seq = frame.seq;
    const events = [
      { seq, type: 'turn.started', params: { playerId: 'p1' } },
      ...Array.from({ length: WAGON_FRAME_COMMANDS }, (_, index) => ({ seq: seq + index + 1, type: 'tb.wagonMoved', params: { playerId: 'p1' } })),
    ];
    const capped = { ...view, events: [...view.events, ...events] } as GameView;
    expect(decide(frame, 'p1', 'standard', capped)).toEqual({ type: 'tb.wagonStop' });
    // 其他玩家的車隊事件不算。
    const others = { ...view, events: [...view.events, ...events.map((event) => ({ ...event, params: { playerId: 'p2' } }))] } as GameView;
    expect(decide(frame, 'p1', 'standard', others)).toMatchObject({ type: 'tb.wagonStep' });
  });
});

/** `turn.roll` 的亂數：骰子固定 3 + 4（rules 的 Traders 擲骰各取一次 `int(6)`）。 */
const scripted7 = () => scriptedRng([2, 3, 0, 0, 0, 0]);
