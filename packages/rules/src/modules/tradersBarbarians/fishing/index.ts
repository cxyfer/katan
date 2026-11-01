/**
 * Fishing on Catan (TB25 pp. 9–10): fishing grounds and the lake hand out
 * secret fish tokens, which buy special actions; the old boot raises its
 * holder's target by 1 VP.
 */

import { countRoads, playerById, scoreOf, topologyOf, totalResources } from '../../../analysis.ts';
import { RESOURCES, type GameState, type ModulePending, type Resource } from '../../../types.ts';
import { verticesOfHex } from '../../../topology.ts';
import { playerStats } from '../../../stats.ts';
import type { ModuleCommand, ModuleContext } from '../../types.ts';
import { frameKind, moduleFrame, TB, type TbPart } from '../part.ts';
import { partState, requirePartState, setPartState } from '../state.ts';
import { groundGeometry, GROUND_NUMBERS, LAKE_NUMBERS, type GroundGeometry } from './board.ts';

export const FISHING = 'tb-fishing';

export type FishValue = 1 | 2 | 3;

/** 11 one-fish, 10 two-fish and 8 three-fish tokens plus the old boot (p. 9). */
export const FISH_SUPPLY: readonly [number, number, number] = [11, 10, 8];
/** Most fish tokens a player may hold (the old boot excluded, p. 10). */
export const FISH_LIMIT = 7;

/** Costs of the fish actions (p. 10). */
export const FISH_COSTS = {
  removeRobber: 2,
  steal: 3,
  takeResource: 4,
  road: 5,
  devCard: 7,
} as const;
export type FishAction = keyof typeof FISH_COSTS;

export interface FishingGround extends GroundGeometry {
  number: number;
}

export interface FishingState {
  grounds: FishingGround[];
  lake: number;
  /** Face-down supply: counts of 1-, 2- and 3-fish tokens, and the boot. */
  supply: { fish: [number, number, number]; boot: number };
  /** Face-up discard pile (counts per value). */
  discard: [number, number, number];
  /** Each player's secret fish tokens (values). */
  hands: Record<string, FishValue[]>;
  /** Holder of the old boot, once drawn (public). */
  boot: string | null;
  /** Window id in which each player last used the once-per-turn swap. */
  swapWindow: Record<string, number>;
}

/** A pending distribution step: players still to draw, in table order. */
interface FishGrant {
  playerId: string;
  count: number;
}

const SWAP_FRAME = frameKind('fishSwap');

function fishing(state: GameState): FishingState {
  return requirePartState<FishingState>(state, FISHING);
}

function fishCount(slot: FishingState, playerId: string): number {
  return slot.hands[playerId]?.length ?? 0;
}

/** Draws one face-down token, refilling the supply from the discard pile when empty. */
function drawToken(state: GameState, slot: FishingState, ctx: ModuleContext): FishValue | 'boot' | null {
  let total = slot.supply.fish.reduce((sum, count) => sum + count, 0) + slot.supply.boot;
  if (total === 0) {
    const refill = slot.discard.reduce((sum, count) => sum + count, 0);
    if (refill === 0) return null;
    slot.supply.fish = [slot.discard[0], slot.discard[1], slot.discard[2]];
    slot.discard = [0, 0, 0];
    ctx.kit.emit(state, 'tb.fishRefilled', { count: refill });
    total = refill;
  }
  let pick = ctx.rng.int(total);
  for (let value = 0; value < 3; value++) {
    const count = slot.supply.fish[value]!;
    if (pick < count) {
      slot.supply.fish[value] = count - 1;
      return (value + 1) as FishValue;
    }
    pick -= count;
  }
  slot.supply.boot = 0;
  return 'boot';
}

/**
 * Hands out fish one token at a time in table order (p. 10). A player at the
 * limit may swap once per turn: that pauses the distribution behind a frame.
 * Returns false when it paused.
 */
function distribute(state: GameState, grants: FishGrant[], ctx: ModuleContext): boolean {
  const slot = fishing(state);
  for (let index = 0; index < grants.length; index++) {
    const grant = grants[index]!;
    const drawn: FishValue[] = [];
    let boot = false;
    let remaining = grant.count;
    while (remaining > 0) {
      if (fishCount(slot, grant.playerId) >= FISH_LIMIT) {
        if (slot.swapWindow[grant.playerId] !== state.windowId) {
          report(state, grant.playerId, drawn, boot, ctx);
          ctx.kit.enqueuePending(state, {
            kind: SWAP_FRAME,
            module: TB,
            responders: [grant.playerId],
            data: { queue: grants.slice(index + 1) },
          });
          return false;
        }
        break;
      }
      const token = drawToken(state, slot, ctx);
      if (token === null) break;
      remaining -= 1;
      if (token === 'boot') {
        slot.boot = grant.playerId;
        boot = true;
      } else {
        (slot.hands[grant.playerId] ??= []).push(token);
        drawn.push(token);
      }
    }
    report(state, grant.playerId, drawn, boot, ctx);
  }
  return true;
}

function report(state: GameState, playerId: string, drawn: FishValue[], boot: boolean, ctx: ModuleContext): void {
  if (drawn.length > 0) {
    ctx.kit.emit(state, 'tb.fishDrawn', { playerId, count: drawn.length }, { to: [playerId], params: { tokens: drawn } });
  }
  if (boot) ctx.kit.emit(state, 'tb.bootDrawn', { playerId });
}

/** Players' fish entitlements for a total, active player first then clockwise. */
function grantsFor(state: GameState, total: number): FishGrant[] {
  const slot = fishing(state);
  const topology = topologyOf(state);
  const counts = new Map<string, number>();
  const add = (vertex: number) => {
    const building = state.board.buildings[vertex];
    if (building) counts.set(building.player, (counts.get(building.player) ?? 0) + (building.city ? 2 : 1));
  };
  for (const ground of slot.grounds) if (ground.number === total) for (const vertex of ground.vertices) add(vertex);
  if (LAKE_NUMBERS.includes(total) && state.board.robber !== slot.lake) {
    for (const vertex of verticesOfHex(topology, slot.lake)) add(vertex);
  }
  const seats = state.players.length;
  const out: FishGrant[] = [];
  for (let step = 0; step < seats; step++) {
    const player = state.players[(state.turn.seat + step) % seats]!;
    const count = counts.get(player.id);
    if (count) out.push({ playerId: player.id, count });
  }
  return out;
}

/** Vertices next to a fishing ground or the lake (setup bonus, p. 9). */
export function fishingVertices(state: GameState): Set<number> {
  const slot = fishing(state);
  const out = new Set<number>(slot.grounds.flatMap((ground) => ground.vertices));
  for (const vertex of verticesOfHex(topologyOf(state), slot.lake)) out.add(vertex);
  return out;
}

function parseTokens(raw: unknown): FishValue[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > FISH_LIMIT) return null;
  if (!raw.every((value) => value === 1 || value === 2 || value === 3)) return null;
  return raw as FishValue[];
}

/** Removes tokens from a hand when it holds them all. */
function takeFromHand(hand: FishValue[], tokens: FishValue[]): FishValue[] | null {
  const left = hand.slice();
  for (const token of tokens) {
    const at = left.indexOf(token);
    if (at < 0) return null;
    left.splice(at, 1);
  }
  return left;
}

function ownActionWindow(state: GameState, actorId: string, ctx: ModuleContext) {
  if (ctx.kit.currentPlayer(state).id !== actorId) return ctx.kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return ctx.kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  return null;
}

function spendFish(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const guard = ownActionWindow(state, actorId, ctx);
  if (guard) return guard;
  const action = command.action as FishAction;
  if (typeof action !== 'string' || !(action in FISH_COSTS)) return ctx.kit.fail('E_INVALID_SELECTION', { action });
  const tokens = parseTokens(command.tokens);
  if (!tokens) return ctx.kit.fail('E_INVALID_SELECTION', { reason: 'tokens' });
  const slot = fishing(state);
  const left = takeFromHand(slot.hands[actorId] ?? [], tokens);
  if (!left) return ctx.kit.fail('E_TB_FISH_NOT_HELD');
  const paid = tokens.reduce((sum, value) => sum + value, 0);
  const cost = FISH_COSTS[action];
  if (paid < cost) return ctx.kit.fail('E_TB_FISH_SHORT', { cost, paid });
  const player = playerById(state, actorId)!;

  // Validate the effect before paying.
  let victim: string | null = null;
  let resource: Resource | null = null;
  let edge: number | null = null;
  switch (action) {
    case 'removeRobber':
      if (state.board.robber < 0) return ctx.kit.fail('E_TB_NO_ROBBER');
      break;
    case 'steal': {
      const target = typeof command.victim === 'string' ? playerById(state, command.victim) : undefined;
      if (!target || target.id === actorId) return ctx.kit.fail('E_ILLEGAL_TARGET', { victim: command.victim });
      if (totalResources(target) === 0) return ctx.kit.fail('E_NO_ELIGIBLE_VICTIM', { victim: target.id });
      victim = target.id;
      break;
    }
    case 'takeResource':
      if (!RESOURCES.includes(command.resource as Resource)) return ctx.kit.fail('E_INVALID_SELECTION', { resource: command.resource });
      resource = command.resource as Resource;
      if (state.bank[resource] <= 0) return ctx.kit.fail('E_BANK_EMPTY', { resource });
      break;
    case 'road': {
      const wanted = command.edge;
      if (typeof wanted !== 'number' || !ctx.kit.canPlaceRoad(state, actorId, wanted)) return ctx.kit.fail('E_ILLEGAL_TARGET', { edge: wanted });
      if (countRoads(state, actorId) >= ctx.profile.pieces.roads) return ctx.kit.fail('E_NO_PIECES', { piece: 'road' });
      edge = wanted;
      break;
    }
    case 'devCard':
      if (state.devDeck.length === 0) return ctx.kit.fail('E_DECK_EMPTY');
      break;
  }

  slot.hands[actorId] = left;
  for (const token of tokens) slot.discard[token - 1]! += 1;
  ctx.kit.emit(state, 'tb.fishSpent', { playerId: actorId, action, paid, cost });

  switch (action) {
    case 'removeRobber':
      state.board.robber = -1;
      ctx.kit.emit(state, 'tb.robberRemoved', { playerId: actorId });
      break;
    case 'steal': {
      const target = playerById(state, victim!)!;
      const pool = RESOURCES.flatMap((kind) => Array<Resource>(target.resources[kind]).fill(kind));
      const taken = pool[ctx.rng.int(pool.length)]!;
      target.resources[taken] -= 1;
      player.resources[taken] += 1;
      ctx.kit.emit(state, 'tb.fishStole', { playerId: actorId, victim: target.id }, { to: [actorId, target.id], params: { resource: taken } });
      break;
    }
    case 'takeResource':
      state.bank[resource!] -= 1;
      player.resources[resource!] += 1;
      ctx.kit.emit(state, 'tb.fishResource', { playerId: actorId, resource });
      break;
    case 'road':
      state.board.roads[edge!] = { player: actorId, ship: false };
      playerStats(state, actorId).freeRoadsBuilt += 1;
      ctx.kit.emit(state, 'tb.fishRoad', { playerId: actorId, edge });
      ctx.kit.afterBoardChange(state);
      break;
    case 'devCard': {
      const card = state.devDeck.splice(ctx.rng.int(state.devDeck.length), 1)[0]!;
      player.newDevCards.push(card);
      const stats = playerStats(state, actorId);
      stats.devCardsBought[card] = (stats.devCardsBought[card] ?? 0) + 1;
      ctx.kit.emit(state, 'tb.fishDevCard', { playerId: actorId, remaining: state.devDeck.length }, { to: [actorId], params: { card } });
      break;
    }
  }
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

function giveBoot(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const guard = ownActionWindow(state, actorId, ctx);
  if (guard) return guard;
  const slot = fishing(state);
  if (slot.boot !== actorId) return ctx.kit.fail('E_TB_BOOT_NOT_HELD');
  const to = typeof command.to === 'string' ? playerById(state, command.to) : undefined;
  if (!to || to.id === actorId) return ctx.kit.fail('E_ILLEGAL_TARGET', { to: command.to });
  // Hidden Victory Point cards do not count (p. 10).
  const mine = scoreOf(state, actorId, { includeHidden: false });
  if (scoreOf(state, to.id, { includeHidden: false }) < mine) return ctx.kit.fail('E_TB_BOOT_TARGET', { to: to.id });
  slot.boot = to.id;
  ctx.kit.emit(state, 'tb.bootGiven', { playerId: actorId, to: to.id });
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

function swapFish(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const frame = state.pending as ModulePending | null;
  if (!frame || frame.kind !== SWAP_FRAME) return ctx.kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  if (frame.responders[0] !== actorId) return ctx.kit.fail('E_NOT_ACTOR');
  const slot = fishing(state);
  const token = command.token;
  if (token !== null) {
    if (token !== 1 && token !== 2 && token !== 3) return ctx.kit.fail('E_INVALID_SELECTION', { token });
    const left = takeFromHand(slot.hands[actorId] ?? [], [token]);
    if (!left) return ctx.kit.fail('E_TB_FISH_NOT_HELD');
    slot.hands[actorId] = left;
    slot.discard[token - 1]! += 1;
    slot.swapWindow[actorId] = state.windowId;
    const drawn = drawToken(state, slot, ctx);
    if (drawn === 'boot') slot.boot = actorId;
    else if (drawn !== null) slot.hands[actorId]!.push(drawn);
    ctx.kit.emit(state, 'tb.fishSwapped', { playerId: actorId, discarded: token }, drawn === 'boot' || drawn === null ? undefined : { to: [actorId], params: { drawn } });
    if (drawn === 'boot') ctx.kit.emit(state, 'tb.bootDrawn', { playerId: actorId });
  } else {
    // Declining also uses up the swap for this turn; drawing stops either way.
    slot.swapWindow[actorId] = state.windowId;
    ctx.kit.emit(state, 'tb.fishSwapDeclined', { playerId: actorId });
  }
  frame.responders = [];
  distribute(state, (frame.data.queue as FishGrant[]) ?? [], ctx);
  ctx.kit.completePending(state, ctx.rng);
  return ctx.kit.accept(state);
}

export const fishingPart: TbPart = {
  id: FISHING,
  frames: [SWAP_FRAME],
  initGame(state, ctx) {
    const topology = topologyOf(state);
    const numbers = [...GROUND_NUMBERS];
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = ctx.rng.int(i + 1);
      [numbers[i], numbers[j]] = [numbers[j]!, numbers[i]!];
    }
    setPartState<FishingState>(state, FISHING, {
      grounds: groundGeometry(topology).map((ground, index) => ({ ...ground, number: numbers[index]! })),
      lake: state.board.layout.terrain.indexOf('lake'),
      supply: { fish: [...FISH_SUPPLY], boot: 1 },
      discard: [0, 0, 0],
      hands: Object.fromEntries(state.players.map((player) => [player.id, []])),
      boot: null,
      swapWindow: {},
    });
  },
  afterBuild(state, build, ctx) {
    // Second setup settlement next to a ground or the lake: one fish (p. 9).
    if (!build.setup || build.piece === 'road' || state.turn.setup?.round !== 2) return;
    if (fishingVertices(state).has(build.vertex!)) distribute(state, [{ playerId: build.playerId, count: 1 }], ctx);
  },
  afterProduction(state, roll, ctx) {
    if (roll.total === 7) return;
    const grants = grantsFor(state, roll.total);
    if (grants.length > 0) distribute(state, grants, ctx);
  },
  commands: {
    'tb.spendFish': spendFish,
    'tb.giveBoot': giveBoot,
    'tb.fishSwap': swapFish,
  },
  pendingCommands: ['tb.fishSwap'],
  victoryTarget(state, playerId, base) {
    return partState<FishingState>(state, FISHING)?.boot === playerId ? base + 1 : base;
  },
  project(state, viewerId) {
    const slot = partState<FishingState>(state, FISHING);
    if (!slot) return null;
    return {
      grounds: slot.grounds.map((ground) => ({ ...ground, vertices: [...ground.vertices], edges: [...ground.edges] })),
      lake: slot.lake,
      lakeNumbers: [...LAKE_NUMBERS],
      supplyCount: slot.supply.fish.reduce((sum, count) => sum + count, 0) + slot.supply.boot,
      discard: [...slot.discard],
      tokenCounts: Object.fromEntries(Object.entries(slot.hands).map(([id, hand]) => [id, hand.length])),
      boot: slot.boot,
      ...(slot.hands[viewerId] ? { mine: [...slot.hands[viewerId]!] } : {}),
      limit: FISH_LIMIT,
      costs: { ...FISH_COSTS },
    };
  },
  projectPending(_state, frame, viewerId) {
    return { kind: frame.kind, module: frame.module, responders: frame.responders.slice(), data: frame.responders.includes(viewerId) ? { limit: FISH_LIMIT } : {} };
  },
  actionHints(state, playerId, ctx) {
    const slot = partState<FishingState>(state, FISHING);
    if (!slot) return null;
    const own = ctx.profile && state.players[state.turn.seat]?.id === playerId && state.turn.phase === 'action' && !state.pending;
    const fish = (slot.hands[playerId] ?? []).reduce((sum, value) => sum + value, 0);
    const roads = own && fish >= FISH_COSTS.road && ctx.rules
      ? topologyOf(state).edges.map((_, edge) => edge).filter((edge) => ctx.rules!.canPlaceRoad(state, playerId, edge))
      : [];
    const frame = moduleFrame(state);
    return {
      canSpend: !!own,
      fish,
      canGiveBoot: !!own && slot.boot === playerId,
      bootTargets: own && slot.boot === playerId
        ? state.players.filter((player) => player.id !== playerId &&
          scoreOf(state, player.id, { includeHidden: false }) >= scoreOf(state, playerId, { includeHidden: false })).map((player) => player.id)
        : [],
      targets: { 'tb.spendFish': roads },
      swap: frame?.kind === SWAP_FRAME && frame.responders[0] === playerId,
    };
  },
};
