/**
 * Traders & Barbarians (TB25 pp. 20–24): wagons carry commodities between
 * the quarry, the glassworks and the castle at the end of each turn; barbarians
 * on edges slow them and rob road owners; Knight cards move barbarians.
 */

import { playerById, topologyOf, totalResources } from '../../../analysis.ts';
import { playerStats } from '../../../stats.ts';
import { RESOURCES, type GameState, type ModulePending, type Resource } from '../../../types.ts';
import type { ModuleCommand, ModuleContext, RollResult } from '../../types.ts';
import { coins, goldOf, grantGold, payGold } from '../coins/index.ts';
import { frameKind, moduleFrame, TB, type TbPart } from '../part.ts';
import { partState, requirePartState, setPartState } from '../state.ts';
import {
  barbarianEdges,
  SITES,
  siteGeometry,
  xEdges,
  type Commodity,
  type SiteGeometry,
  type SiteId,
} from './board.ts';

export const TRADERS = 'tb-traders-barbarians';
export const STARTING_GOLD = 5;

/** Wagon board columns 1–5 (p. 22). */
export const WAGON_LEVELS = [
  { mp: 4, driveOff: 0, value: 1 },
  { mp: 5, driveOff: 6, value: 2 },
  { mp: 6, driveOff: 5, value: 3 },
  { mp: 7, driveOff: 4, value: 4 },
  { mp: 7, driveOff: 3, value: 5 },
] as const;
/** Cost to move the cube one column right, from level n to n + 1. */
export const UPGRADE_COSTS: readonly Partial<Record<Resource, number>>[] = [
  { lumber: 1, wool: 1, ore: 1 },
  { lumber: 1, wool: 1, ore: 1 },
  { lumber: 2, wool: 1, ore: 1 },
  { lumber: 2, wool: 1, ore: 1 },
];
export const FULL_UPGRADE_POINTS = 1;
export const BOOST_MP = 2;

export interface Wagon {
  vertex: number;
  level: number;
  cargo: Commodity | null;
  delivered: number;
}

export interface TradersState {
  sites: SiteGeometry[];
  xEdges: number[];
  barbarians: number[];
  /** Face-down commodity stacks (drawn at random). */
  stacks: Record<SiteId, Commodity[]>;
  wagons: Record<string, Wagon>;
  /** Window in which a player played Swift Journey. */
  swift: Record<string, number>;
}

interface MoveData {
  mp: number;
  boosted: boolean;
  /** Move actions still available after the current one (Swift Journey). */
  extra: number;
  /** Barbarians already tried this turn, by index in `barbarians` (relocation keeps the index). */
  drivenOff: number[];
}

const MOVE = frameKind('tbWagon');
const BARBARIAN = frameKind('tbBarbarian');

function traders(state: GameState): TradersState {
  return requirePartState<TradersState>(state, TRADERS);
}

function level(wagon: Wagon) {
  return WAGON_LEVELS[wagon.level - 1]!;
}

function siteAt(state: GameState, vertex: number): (SiteGeometry & { needs: readonly Commodity[] }) | null {
  const site = traders(state).sites.find((candidate) => candidate.plaza === vertex);
  if (!site) return null;
  return { ...site, needs: SITES.find((spec) => spec.id === site.id)!.needs };
}

function ownTurn(state: GameState, actorId: string, ctx: ModuleContext, phases: string[] = ['action']) {
  if (ctx.kit.currentPlayer(state).id !== actorId) return ctx.kit.fail('E_NOT_YOUR_TURN');
  if (!phases.includes(state.turn.phase)) return ctx.kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  return null;
}

function activeFrame(state: GameState, kind: string, actorId: string, ctx: ModuleContext) {
  const pending = state.pending as ModulePending | null;
  if (!pending || pending.kind !== kind) return { error: ctx.kit.fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' }) };
  if (pending.responders[0] !== actorId) return { error: ctx.kit.fail('E_NOT_ACTOR') };
  return { frame: pending };
}

/** Moves a barbarian; on a road it robs the road's owner (7 and Knight, p. 21–22). */
function relocate(state: GameState, actorId: string, from: number, to: number, steal: boolean, ctx: ModuleContext): void {
  const slot = traders(state);
  slot.barbarians = slot.barbarians.map((edge) => (edge === from ? to : edge));
  ctx.kit.emit(state, 'tb.barbarianShifted', { playerId: actorId, from, to });
  const owner = state.board.roads[to]?.player;
  if (!steal || !owner || owner === actorId) return;
  const victim = playerById(state, owner)!;
  if (totalResources(victim) === 0) return;
  const pool = RESOURCES.flatMap((kind) => Array<Resource>(victim.resources[kind]).fill(kind));
  const taken = pool[ctx.rng.int(pool.length)]!;
  victim.resources[taken] -= 1;
  playerById(state, actorId)!.resources[taken] += 1;
  ctx.kit.emit(state, 'tb.barbarianRobbed', { playerId: actorId, victim: owner }, { to: [actorId, owner], params: { resource: taken } });
}

function validBarbarianMove(state: GameState, from: unknown, to: unknown): boolean {
  const slot = traders(state);
  const edges = topologyOf(state).edges.length;
  return typeof from === 'number' && typeof to === 'number' && slot.barbarians.includes(from) &&
    to >= 0 && to < edges && !slot.barbarians.includes(to);
}

function moveBarbarian(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame, error } = activeFrame(state, BARBARIAN, actorId, ctx);
  if (error) return error;
  if (!validBarbarianMove(state, command.from, command.to)) return ctx.kit.fail('E_ILLEGAL_TARGET', { from: command.from, to: command.to });
  relocate(state, actorId, command.from as number, command.to as number, true, ctx);
  frame.responders = [];
  ctx.kit.completePending(state, ctx.rng);
  return ctx.kit.accept(state);
}

/** Base development-card timing for the scenario's own cards. */
function playCard(state: GameState, actorId: string, card: 'barbarianKnight' | 'swiftJourney', ctx: ModuleContext) {
  const guard = ownTurn(state, actorId, ctx, ['preroll', 'action']);
  if (guard) return guard;
  if (state.turn.devCardPlayed) return ctx.kit.fail('E_CARD_ALREADY_PLAYED');
  const player = playerById(state, actorId)!;
  const index = player.devCards.indexOf(card);
  if (index < 0) {
    return player.newDevCards.includes(card) ? ctx.kit.fail('E_CARD_JUST_BOUGHT', { card }) : ctx.kit.fail('E_CARD_NOT_HELD', { card });
  }
  player.devCards.splice(index, 1);
  state.turn.devCardPlayed = true;
  const played = playerStats(state, actorId).devCardsPlayed as Record<string, number>;
  played[card] = (played[card] ?? 0) + 1;
  return null;
}

function playKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  if (!validBarbarianMove(state, command.from, command.to)) return ctx.kit.fail('E_ILLEGAL_TARGET', { from: command.from, to: command.to });
  const rejected = playCard(state, actorId, 'barbarianKnight', ctx);
  if (rejected) return rejected;
  const player = playerById(state, actorId)!;
  player.playedKnights += 1;
  ctx.kit.emit(state, 'tb.knightPlayed', { playerId: actorId, playedKnights: player.playedKnights });
  relocate(state, actorId, command.from as number, command.to as number, true, ctx);
  // Knight cards count for Largest Army.
  ctx.kit.afterBoardChange(state);
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

function playSwift(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext) {
  const rejected = playCard(state, actorId, 'swiftJourney', ctx);
  if (rejected) return rejected;
  traders(state).swift[actorId] = state.windowId;
  ctx.kit.emit(state, 'tb.swiftJourney', { playerId: actorId });
  return ctx.kit.accept(state);
}

function upgrade(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext) {
  const guard = ownTurn(state, actorId, ctx);
  if (guard) return guard;
  const wagon = traders(state).wagons[actorId]!;
  const cost = UPGRADE_COSTS[wagon.level - 1];
  if (!cost) return ctx.kit.fail('E_TB_WAGON_MAXED');
  const player = playerById(state, actorId)!;
  if (!ctx.kit.canAfford(player, cost)) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost });
  ctx.kit.payBuild(state, player, cost);
  wagon.level += 1;
  ctx.kit.emit(state, 'tb.wagonUpgraded', { playerId: actorId, level: wagon.level });
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

/** MP cost and gold owed to move along an edge (p. 23); null when impassable. */
export function stepCost(state: GameState, playerId: string, edge: number): { mp: number; toll: string | null } {
  const slot = traders(state);
  const road = state.board.roads[edge];
  let mp = !road ? 2 : 1;
  const toll = road && road.player !== playerId ? road.player : null;
  if (slot.barbarians.includes(edge)) mp += 2;
  return { mp, toll };
}

/** Enters a plaza: deliver a wanted token, then draw one if the wagon is empty (p. 23). */
function arrive(state: GameState, playerId: string, ctx: ModuleContext): void {
  const slot = traders(state);
  const wagon = slot.wagons[playerId]!;
  const site = siteAt(state, wagon.vertex);
  if (!site) return;
  if (wagon.cargo && site.needs.includes(wagon.cargo)) {
    const commodity = wagon.cargo;
    wagon.cargo = null;
    wagon.delivered += 1;
    ctx.kit.emit(state, 'tb.commodityDelivered', { playerId, site: site.id, commodity });
    grantGold(state, playerId, level(wagon).value, 'delivery', ctx);
  }
  const stack = slot.stacks[site.id];
  if (!wagon.cargo && stack.length > 0) {
    wagon.cargo = stack.splice(ctx.rng.int(stack.length), 1)[0]!;
    ctx.kit.emit(state, 'tb.commodityLoaded', { playerId, site: site.id, commodity: wagon.cargo });
  }
}

/** Ends the current move action: a second one with Swift Journey, else the turn. */
function endMove(state: GameState, frame: ModulePending, ctx: ModuleContext) {
  const data = frame.data as unknown as MoveData;
  const actorId = frame.responders[0]!;
  if (data.extra > 0) {
    data.extra -= 1;
    data.mp = level(traders(state).wagons[actorId]!).mp;
    ctx.kit.emit(state, 'tb.wagonAgain', { playerId: actorId });
    return ctx.kit.accept(state);
  }
  frame.responders = [];
  ctx.kit.completePending(state, ctx.rng);
  ctx.kit.checkVictory(state);
  if (!state.result && !state.pending) ctx.kit.finishTurn(state);
  return ctx.kit.accept(state);
}

function step(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame, error } = activeFrame(state, MOVE, actorId, ctx);
  if (error) return error;
  const data = frame.data as unknown as MoveData;
  const slot = traders(state);
  const wagon = slot.wagons[actorId]!;
  const topology = topologyOf(state);
  const to = command.to;
  const edge = topology.vertices[wagon.vertex]!.edges.find((candidate) => topology.edges[candidate]!.vertices.includes(to as number));
  if (typeof to !== 'number' || edge === undefined || to === wagon.vertex) return ctx.kit.fail('E_ILLEGAL_TARGET', { to });
  const cost = stepCost(state, actorId, edge);
  if (cost.mp > data.mp) return ctx.kit.fail('E_TB_WAGON_MP', { cost: cost.mp, mp: data.mp });
  if (cost.toll && goldOf(state, actorId) < 1) return ctx.kit.fail('E_TB_GOLD_SHORT', { cost: 1 });
  data.mp -= cost.mp;
  if (cost.toll) payGold(state, actorId, cost.toll, 1);
  const from = wagon.vertex;
  wagon.vertex = to;
  ctx.kit.emit(state, 'tb.wagonMoved', { playerId: actorId, from, to, toll: cost.toll });
  if (siteAt(state, to)) {
    arrive(state, actorId, ctx);
    return endMove(state, frame, ctx);
  }
  return ctx.kit.accept(state);
}

function boost(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext) {
  const { frame, error } = activeFrame(state, MOVE, actorId, ctx);
  if (error) return error;
  const data = frame.data as unknown as MoveData;
  if (data.boosted) return ctx.kit.fail('E_TB_WAGON_BOOSTED');
  const player = playerById(state, actorId)!;
  if (player.resources.grain < 1) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost: { grain: 1 } });
  ctx.kit.payBuild(state, player, { grain: 1 });
  data.boosted = true;
  data.mp += BOOST_MP;
  ctx.kit.emit(state, 'tb.wagonBoosted', { playerId: actorId });
  return ctx.kit.accept(state);
}

function driveOff(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame, error } = activeFrame(state, MOVE, actorId, ctx);
  if (error) return error;
  const data = frame.data as unknown as MoveData;
  const wagon = traders(state).wagons[actorId]!;
  const threshold = level(wagon).driveOff;
  if (threshold === 0) return ctx.kit.fail('E_TB_WAGON_LEVEL');
  const from = command.barbarian;
  const topology = topologyOf(state);
  const index = typeof from === 'number' ? traders(state).barbarians.indexOf(from) : -1;
  if (typeof from !== 'number' || !topology.vertices[wagon.vertex]!.edges.includes(from) || index < 0 || data.drivenOff.includes(index) ||
    !validBarbarianMove(state, from, command.to)) {
    return ctx.kit.fail('E_ILLEGAL_TARGET', { barbarian: from, to: command.to });
  }
  data.drivenOff.push(index);
  const die = ctx.rng.int(6) + 1;
  const success = die >= threshold;
  ctx.kit.emit(state, 'tb.driveOff', { playerId: actorId, die, success });
  if (success) relocate(state, actorId, from, command.to as number, false, ctx);
  return ctx.kit.accept(state);
}

function stop(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext) {
  const { frame, error } = activeFrame(state, MOVE, actorId, ctx);
  if (error) return error;
  return endMove(state, frame, ctx);
}

/** Vertices the wagon can reach in one step this action, with their cost. */
function reachableSteps(state: GameState, playerId: string, mp: number): number[] {
  const wagon = traders(state).wagons[playerId]!;
  const topology = topologyOf(state);
  return topology.vertices[wagon.vertex]!.edges.flatMap((edge) => {
    const cost = stepCost(state, playerId, edge);
    if (cost.mp > mp || (cost.toll && goldOf(state, playerId) < 1)) return [];
    const [a, b] = topology.edges[edge]!.vertices;
    return [a === wagon.vertex ? b : a];
  });
}

export const tradersPart: TbPart = {
  id: TRADERS,
  frames: [MOVE, BARBARIAN],
  initGame(state) {
    const topology = topologyOf(state);
    const stacks = Object.fromEntries(SITES.map((site) => [site.id,
      Object.entries(site.stack).flatMap(([commodity, count]) => Array<Commodity>(count).fill(commodity as Commodity))])) as Record<SiteId, Commodity[]>;
    setPartState<TradersState>(state, TRADERS, {
      sites: siteGeometry(topology),
      xEdges: xEdges(topology),
      barbarians: barbarianEdges(topology),
      stacks,
      wagons: Object.fromEntries(state.players.map((player) => [player.id, { vertex: -1, level: 1, cargo: null, delivered: 0 }])),
      swift: {},
    });
    // Each player starts with 5 gold (p. 21).
    const purse = coins(state);
    for (const player of state.players) {
      purse.gold[player.id] = STARTING_GOLD;
      purse.supply -= STARTING_GOLD;
    }
  },
  setupBuilding: (_state, step) => (step.round === 2 ? 'city' : undefined),
  rollDice(_state, ctx) {
    // 2 and 12 are rerolled (p. 21).
    for (;;) {
      const first = ctx.rng.int(6) + 1;
      const second = ctx.rng.int(6) + 1;
      if (first + second !== 2 && first + second !== 12) return { dice: [first, second], total: first + second } satisfies RollResult;
    }
  },
  sevenRobberStep(_state, actorId) {
    // Discards first, then a barbarian moves instead of the robber (p. 21).
    return { kind: BARBARIAN, module: TB, responders: [actorId], data: {} };
  },
  roadAllowed(state, _playerId, edge) {
    return !partState<TradersState>(state, TRADERS)?.xEdges.includes(edge);
  },
  buildingAllowed(state, _playerId, vertex) {
    // No settlement on a centre plaza (p. 21).
    const info = topologyOf(state).vertices[vertex]!;
    if (info.interior) return false;
    // A corner reached only by X edges can never take a road, so setup could
    // not place the settlement's road there.
    const x = partState<TradersState>(state, TRADERS)?.xEdges ?? [];
    return info.edges.some((edge) => !x.includes(edge));
  },
  afterBuild(state, build, ctx) {
    // The wagon starts on the intersection of the setup city (p. 21).
    if (build.setup && build.piece === 'city') {
      traders(state).wagons[build.playerId]!.vertex = build.vertex!;
      ctx.kit.emit(state, 'tb.wagonStarted', { playerId: build.playerId, vertex: build.vertex });
    }
  },
  awardRules(_state, rules) {
    // The Longest Road tile is not used (p. 21).
    return { ...rules, minLongestRoad: Number.POSITIVE_INFINITY };
  },
  onEndTurn(state, actorId, ctx) {
    const slot = traders(state);
    const wagon = slot.wagons[actorId]!;
    if (wagon.vertex < 0) return 'continue';
    const extra = slot.swift[actorId] === state.windowId ? 1 : 0;
    ctx.kit.enqueuePending(state, {
      kind: MOVE, module: TB, responders: [actorId],
      data: { mp: level(wagon).mp, boosted: false, extra, drivenOff: [] } satisfies MoveData as unknown as Record<string, unknown>,
    });
    return 'defer';
  },
  commands: {
    'tb.moveBarbarian': moveBarbarian,
    'tb.playKnight': playKnight,
    'tb.playSwiftJourney': playSwift,
    'tb.upgradeWagon': upgrade,
    'tb.wagonStep': step,
    'tb.wagonBoost': boost,
    'tb.driveOff': driveOff,
    'tb.wagonStop': stop,
  },
  pendingCommands: ['tb.moveBarbarian', 'tb.wagonStep', 'tb.wagonBoost', 'tb.driveOff', 'tb.wagonStop'],
  score(state, playerId) {
    const wagon = partState<TradersState>(state, TRADERS)?.wagons[playerId];
    if (!wagon) return 0;
    return wagon.delivered + (wagon.level === WAGON_LEVELS.length ? FULL_UPGRADE_POINTS : 0);
  },
  project(state) {
    const slot = partState<TradersState>(state, TRADERS);
    if (!slot) return null;
    return {
      sites: slot.sites.map((site) => ({ ...site, needs: [...SITES.find((spec) => spec.id === site.id)!.needs] })),
      xEdges: [...slot.xEdges],
      barbarians: [...slot.barbarians],
      stackCounts: Object.fromEntries(Object.entries(slot.stacks).map(([id, stack]) => [id, stack.length])),
      wagons: JSON.parse(JSON.stringify(slot.wagons)),
      levels: WAGON_LEVELS.map((entry) => ({ ...entry })),
      upgradeCosts: UPGRADE_COSTS.map((cost) => ({ ...cost })),
      swift: Object.keys(slot.swift).filter((id) => slot.swift[id] === state.windowId),
    };
  },
  projectPending(_state, frame) {
    return { kind: frame.kind, module: frame.module, responders: frame.responders.slice(), data: frame.kind === MOVE ? { ...frame.data } : {} };
  },
  actionHints(state, playerId) {
    const slot = partState<TradersState>(state, TRADERS);
    if (!slot) return null;
    const pending = moduleFrame(state);
    const mine = !!pending && pending.responders[0] === playerId;
    const own = state.players[state.turn.seat]?.id === playerId && (state.turn.phase === 'action' || state.turn.phase === 'preroll') && !state.pending;
    const free = topologyOf(state).edges.map((_, edge) => edge).filter((edge) => !slot.barbarians.includes(edge));
    const targets: Record<string, number[]> = {};
    for (const from of slot.barbarians) targets[`tb.barbarian:${from}`] = free;
    let board: unknown = null;
    let steps: number[] = [];
    let driveOff: number[] = [];
    if (mine && pending!.kind === MOVE) {
      const data = pending!.data as unknown as MoveData;
      steps = reachableSteps(state, playerId, data.mp);
      board = { kind: 'vertex', commandType: 'tb.wagonStep', labelId: 'tb.traders.step', targets: steps, field: 'to' };
      const wagon = slot.wagons[playerId]!;
      driveOff = level(wagon).driveOff > 0
        ? topologyOf(state).vertices[wagon.vertex]!.edges.filter((edge) => slot.barbarians.includes(edge) && !data.drivenOff.includes(slot.barbarians.indexOf(edge)))
        : [];
    }
    const player = state.players.find((candidate) => candidate.id === playerId);
    return {
      targets,
      board,
      steps,
      driveOff,
      moveBarbarian: mine && pending!.kind === BARBARIAN,
      canUpgrade: own && state.turn.phase === 'action' && (slot.wagons[playerId]?.level ?? 5) < WAGON_LEVELS.length,
      canPlayKnight: own && !state.turn.devCardPlayed && !!player?.devCards.includes('barbarianKnight'),
      canPlaySwift: own && !state.turn.devCardPlayed && !!player?.devCards.includes('swiftJourney'),
    };
  },
};
