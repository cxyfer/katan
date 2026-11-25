/**
 * 海盜巢穴的巡弋海盜與攻擊（S7b，SF25 p. 16 "Pirate movement"、"Pirate attacks"、"Resolving a 7"）。
 *
 * 每次擲骰後、收資源與處理 7 之前（`beforeProduction`）：
 * 1. 海盜沿航道（順時針）前進「兩顆骰中較小的點數」格；兩顆相同就取該點數。位置只存在 `board.pirate`
 *    （航道上的海格不重複，所以位置即航道索引），沒有任何隨機性。
 * 2. 與海盜所在海格相鄰的建築的主人（未收復的堡壘屬於海盜，不算）逐一被攻擊，順序從擲骰者起依座位。
 *    海盜戰力 = 移動用的那顆骰的點數，玩家戰力 = 戰船數（`warshipCount`）。
 *    - 海盜較強：隨機棄 1 張，再為每座城市多棄 1 張（手牌不夠就全棄），立刻結算（用 `ctx.rng`）；
 *    - 玩家較強：從供應堆任選 1 張，排一個 `seafarers.pirateGift` frame 讓該玩家選；
 *    - 平手：什麼也不發生。
 *    有 frame 時再排一個 `seafarers.pirateResume` 續接 frame，答完後才收資源或處理 7。
 *
 * 擲出 7：手牌超過 7 張的人照常棄一半，之後擲骰者可以（不是必須）從任一位有牌的其他玩家偷 1 張
 * （`sevenRobberStep`，沒有強盜、不看格子）：`seafarers.sevenSteal` frame。
 *
 * 其他劇本不會碰到這裡的任何一條路徑（hook 一開始就依劇本回傳），指令在其他劇本維持未知指令（D7）。
 */

import { playerById, topologyOf, totalCards } from '../../analysis.ts';
import { addResource, playerStats } from '../../stats.ts';
import { verticesOfHex } from '../../topology.ts';
import { RESOURCES, type CommandOutcome, type GameState, type ModulePending, type Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext, PublicModulePendingView, RollResult } from '../types.ts';
import { fortressLocked, isPirateIslands, pirateIslandsView, warshipCount } from './pirateIslands.ts';

export const PIRATE_GIFT_FRAME = 'seafarers.pirateGift' as const;
export const PIRATE_RESUME_FRAME = 'seafarers.pirateResume' as const;
export const SEVEN_STEAL_FRAME = 'seafarers.sevenSteal' as const;

export const PIRATE_GIFT_COMMAND = 'pirate.gift' as const;
export const SEVEN_STEAL_COMMAND = 'seven.steal' as const;

/** 新增的 frame 種類（`pendingCommands` 與投影用）。 */
export const PIRATE_FRAMES: readonly string[] = [PIRATE_GIFT_FRAME, PIRATE_RESUME_FRAME, SEVEN_STEAL_FRAME];

type Hand = Record<Resource, number>;

/** 海盜前進後的位置：`steps` 格後的航道索引（繞回航道起點）。 */
export function routeAdvance(route: readonly number[], from: number, steps: number): number {
  return (from + steps) % route.length;
}

/** 這次移動的步數與海盜戰力：兩顆骰中較小的點數（相同時就是該點數）。 */
export function pirateDie(dice: readonly [number, number]): number {
  return Math.min(dice[0], dice[1]);
}

/**
 * 與海盜所在格相鄰、會被攻擊的玩家，從擲骰者起依座位順序。
 * 未收復的堡壘是海盜的，不算玩家的建築（S7a 的版圖上也沒有任何航道格與堡壘相鄰）。
 */
export function attackedPlayers(state: GameState, hex: number, rollerId: string): string[] {
  const topo = topologyOf(state);
  const owners = new Set<string>();
  for (const vertex of verticesOfHex(topo, hex)) {
    const building = state.board.buildings[vertex];
    if (!building || fortressLocked(state, vertex)) continue;
    owners.add(building.player);
  }
  const count = state.players.length;
  const start = Math.max(0, state.players.findIndex((player) => player.id === rollerId));
  return Array.from({ length: count }, (_, offset) => state.players[(start + offset) % count]!.id).filter((id) => owners.has(id));
}

/** 玩家擁有的城市數（全盤，不限相鄰的）。 */
function cityCount(state: GameState, playerId: string): number {
  return state.board.buildings.filter((building) => building?.player === playerId && building.city).length;
}

/** 從手牌隨機抽 `count` 張（逐張均勻抽）；回傳各資源張數。 */
function drawRandom(hand: Hand, count: number, ctx: ModuleContext): Partial<Record<Resource, number>> {
  const taken: Partial<Record<Resource, number>> = {};
  for (let n = 0; n < count; n++) {
    const pool: Resource[] = [];
    for (const resource of RESOURCES) for (let i = 0; i < hand[resource]; i++) pool.push(resource);
    if (pool.length === 0) break;
    const resource = pool[ctx.rng.int(pool.length)]!;
    hand[resource] -= 1;
    taken[resource] = (taken[resource] ?? 0) + 1;
  }
  return taken;
}

const bankTotal = (state: GameState): number => RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);

/** 供應堆還有的資源種類（贏了海盜的玩家只能從這些選）。 */
export function giftChoices(state: GameState): Resource[] {
  return RESOURCES.filter((resource) => state.bank[resource] > 0);
}

/**
 * 擲骰後的海盜巡弋與攻擊。有人要選牌時排 frame 並回 `'defer'`，答完後由續接 frame 才收資源或處理 7。
 */
export function cruise(state: GameState, roll: RollResult, ctx: ModuleContext): 'continue' | 'defer' {
  if (!isPirateIslands(ctx)) return 'continue';
  const slot = pirateIslandsView(state);
  if (!slot || state.board.pirate === null) return 'continue';
  const from = slot.route.indexOf(state.board.pirate);
  if (from < 0) return 'continue';
  const die = pirateDie(roll.dice);
  const to = routeAdvance(slot.route, from, die);
  state.board.pirate = slot.route[to]!;
  const { kit } = ctx;
  kit.emit(state, 'pirate.cruised', { from: slot.route[from]!, to: slot.route[to]!, steps: die, dice: [roll.dice[0], roll.dice[1]] });

  const rollerId = state.players[state.turn.seat]!.id;
  const gifts: ModulePending[] = [];
  for (const playerId of attackedPlayers(state, state.board.pirate, rollerId)) {
    const player = playerById(state, playerId)!;
    const warships = warshipCount(state, playerId);
    const cities = cityCount(state, playerId);
    const base = { playerId, strength: die, warships };
    if (die > warships) {
      // 海盜較強：1 張 + 每座城市 1 張，隨機棄，回到供應堆。
      const owed = 1 + cities;
      const lost = drawRandom(player.resources, owed, ctx);
      let count = 0;
      for (const resource of RESOURCES) {
        const amount = lost[resource] ?? 0;
        state.bank[resource] += amount;
        count += amount;
      }
      kit.emit(state, 'pirate.attacked', { ...base, result: 'lost', cities, count, owed }, { to: [playerId], params: { resources: lost } });
    } else if (die < warships) {
      kit.emit(state, 'pirate.attacked', { ...base, result: 'won' });
      gifts.push({ kind: PIRATE_GIFT_FRAME, module: 'seafarers', responders: [playerId], data: { strength: die } });
    } else {
      kit.emit(state, 'pirate.attacked', { ...base, result: 'tie' });
    }
  }
  if (gifts.length === 0) return 'continue';
  const resume: ModulePending = { kind: PIRATE_RESUME_FRAME, module: 'seafarers', responders: [], data: { roll } };
  kit.enqueuePending(state, ...gifts, resume);
  // 第一個 frame 直接成為作答中的 frame 時，沒有 activate 的機會：供應堆空了就在這裡跳過。
  if (state.pending === gifts[0]) skipEmptyGift(state, gifts[0], ctx);
  return 'defer';
}

/** 續接：攻擊結算完，回到收資源或處理 7。 */
export function resumeCruise(state: GameState, frame: ModulePending, ctx: ModuleContext): void {
  ctx.kit.resolveRollOutcome(state, frame.data.roll as RollResult, ctx.rng);
}

/** 供應堆完全沒牌時，贏了的玩家什麼都拿不到（記錄在 log），frame 直接結束。 */
export function skipEmptyGift(state: GameState, frame: ModulePending, ctx: ModuleContext): void {
  if (state.pending !== frame || bankTotal(state) > 0) return;
  const playerId = frame.responders.shift()!;
  ctx.kit.emit(state, 'pirate.gifted', { playerId, resource: null });
  ctx.kit.completePending(state, ctx.rng);
}

/** `pirate.gift { resource }` — 贏了海盜的玩家從供應堆拿 1 張自選的資源牌。 */
export function giftResource(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  // D7：其他劇本照舊回未知指令（與 cloth.steal 一致）。
  if (!isPirateIslands(ctx)) return kit.fail(state.pending ? 'E_PENDING_EFFECT' : 'E_INVALID_COMMAND');
  const frame = state.pending;
  if (!frame || frame.kind !== PIRATE_GIFT_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  const gift = frame as ModulePending;
  if (gift.responders[0] !== actorId) return kit.fail('E_NOT_ACTOR');
  const resource = command.resource as Resource;
  if (!RESOURCES.includes(resource)) return kit.fail('E_INVALID_SELECTION', { resource });
  if (state.bank[resource] < 1) return kit.fail('E_BANK_EMPTY', { resource });
  state.bank[resource] -= 1;
  playerById(state, actorId)!.resources[resource] += 1;
  gift.responders.shift();
  kit.emit(state, 'pirate.gifted', { playerId: actorId, resource });
  kit.completePending(state, ctx.rng);
  return kit.accept(state);
}

/** 7 的偷牌對象：任一位有資源牌的其他玩家（座位順序）。 */
export function sevenVictims(state: GameState, actorId: string): string[] {
  return state.players.filter((player) => player.id !== actorId && totalCards(player) > 0).map((player) => player.id);
}

/** 7 的棄牌之後：擲骰者可以偷任一位其他玩家；沒有可偷的對象就沒有這一步。 */
export function sevenStealStep(state: GameState, actorId: string, ctx: ModuleContext): ModulePending | null | undefined {
  if (!isPirateIslands(ctx)) return undefined;
  if (sevenVictims(state, actorId).length === 0) return null;
  return { kind: SEVEN_STEAL_FRAME, module: 'seafarers', responders: [actorId], data: {} };
}

/** `seven.steal { victim }` — 偷 1 張（隨機）；`victim: null` 表示不偷。 */
export function sevenSteal(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  if (!isPirateIslands(ctx)) return kit.fail(state.pending ? 'E_PENDING_EFFECT' : 'E_INVALID_COMMAND');
  const frame = state.pending;
  if (!frame || frame.kind !== SEVEN_STEAL_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  const steal = frame as ModulePending;
  if (steal.responders[0] !== actorId) return kit.fail('E_NOT_ACTOR');
  const victimId = command.victim;
  if (victimId === null) {
    steal.responders.shift();
    kit.emit(state, 'seven.stealSkipped', { playerId: actorId });
    kit.completePending(state, ctx.rng);
    return kit.accept(state);
  }
  if (typeof victimId !== 'string' || !sevenVictims(state, actorId).includes(victimId)) return kit.fail('E_NO_ELIGIBLE_VICTIM', { victim: victimId });
  const victim = playerById(state, victimId)!;
  const taken = drawRandom(victim.resources, 1, ctx);
  const resource = RESOURCES.find((candidate) => (taken[candidate] ?? 0) > 0)!;
  playerById(state, actorId)!.resources[resource] += 1;
  addResource(playerStats(state, actorId).stolen, resource);
  addResource(playerStats(state, victimId).robbed, resource);
  steal.responders.shift();
  kit.emit(state, 'seven.stole', { playerId: actorId, victim: victimId }, { to: [actorId, victimId], params: { resource } });
  kit.completePending(state, ctx.rng);
  return kit.accept(state);
}

/** 新 frame 的公開形式：攻擊的戰力、7 的對象（手牌張數本來就公開）。 */
export function projectPirateFrame(state: GameState, frame: ModulePending, _viewerId: string, _ctx: ModuleViewContext): PublicModulePendingView {
  const base = { kind: frame.kind, module: frame.module, responders: frame.responders.slice() };
  if (frame.kind === PIRATE_GIFT_FRAME) return { ...base, data: { strength: (frame.data as { strength: number }).strength } };
  if (frame.kind === SEVEN_STEAL_FRAME) return { ...base, data: { victims: frame.responders[0] ? sevenVictims(state, frame.responders[0]) : [] } };
  return { ...base, data: {} };
}

/** 提示：輪到自己選牌時可拿的資源；輪到自己偷牌時的對象。其他時候為空。 */
export function pirateFrameHints(state: GameState, playerId: string): { pirateGift: Resource[]; sevenSteal: string[] } {
  const frame = state.pending;
  const mine = !!frame && frame.kind.startsWith('seafarers.') && (frame as ModulePending).responders[0] === playerId;
  return {
    pirateGift: mine && frame!.kind === PIRATE_GIFT_FRAME ? giftChoices(state) : [],
    sevenSteal: mine && frame!.kind === SEVEN_STEAL_FRAME ? sevenVictims(state, playerId) : [],
  };
}
