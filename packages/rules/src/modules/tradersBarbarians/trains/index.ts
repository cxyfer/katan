/**
 * Merchant Trains (TB25 pp. 13–14): building collects one neutral wagon per
 * turn, a voting round at the end of the turn decides where it goes, wagons
 * lengthen roads and reward buildings between two wagons.
 */

import { playerById, topologyOf } from '../../../analysis.ts';
import type { GameState, ModulePending } from '../../../types.ts';
import type { ModuleCommand, ModuleContext } from '../../types.ts';
import { frameKind, moduleFrame, TB, type TbPart } from '../part.ts';
import { partState, requirePartState, setPartState } from '../state.ts';
import { trainStarts, type TrainStart } from './board.ts';

export const TRAINS = 'tb-merchant-trains';
export const WAGON_SUPPLY = 22;
export const BETWEEN_WAGONS_POINTS = 1;

export interface Wagon {
  edge: number;
  train: number;
}

export interface TrainsState {
  oasis: number;
  starts: TrainStart[];
  /** Wagons in placement order; a train's wagons run from its start outward. */
  wagons: Wagon[];
  supply: number;
  /** Window in which the active player collected this turn's wagon. */
  collectedWindow: number | null;
}

/** Bids and assignments of one voting round (public: bids are face up). */
interface VoteData {
  bids: Record<string, { wool: number; grain: number }>;
  assignments: Record<string, number>;
  active: string;
}

const BID = frameKind('wagonBid');
const ASSIGN = frameKind('wagonAssign');
const PLACE = frameKind('wagonPlace');

function trains(state: GameState): TrainsState {
  return requirePartState<TrainsState>(state, TRAINS);
}

function otherEnd(state: GameState, edge: number, vertex: number): number {
  const [a, b] = topologyOf(state).edges[edge]!.vertices;
  return a === vertex ? b : a;
}

/** Number of wagons touching each intersection. */
function wagonDegree(state: GameState): Map<number, number> {
  const topology = topologyOf(state);
  const degree = new Map<number, number>();
  for (const wagon of trains(state).wagons) {
    for (const vertex of topology.edges[wagon.edge]!.vertices) degree.set(vertex, (degree.get(vertex) ?? 0) + 1);
  }
  return degree;
}

/** The front intersection of each train. */
export function trainHeads(state: GameState): Map<number, number> {
  const slot = trains(state);
  const heads = new Map<number, number>();
  for (const wagon of slot.wagons) {
    const previous = heads.get(wagon.train);
    const from = previous ?? slot.starts[wagon.train]!.vertex;
    heads.set(wagon.train, otherEnd(state, wagon.edge, from));
  }
  return heads;
}

/**
 * Where the next wagon may go: an unused start, or an empty edge at the front
 * of a train that has not met another train (or itself). Edge → train id.
 */
export function wagonLocations(state: GameState): Map<number, number> {
  const slot = trains(state);
  const topology = topologyOf(state);
  const used = new Set(slot.wagons.map((wagon) => wagon.edge));
  const degree = wagonDegree(state);
  const out = new Map<number, number>();
  const started = new Set(slot.wagons.map((wagon) => wagon.train));
  slot.starts.forEach((start, train) => {
    if (!started.has(train) && !used.has(start.edge)) out.set(start.edge, train);
  });
  for (const [train, head] of trainHeads(state)) {
    // A front touched by more than its own last wagon has merged: the train ends.
    if ((degree.get(head) ?? 0) > 1) continue;
    for (const edge of topology.vertices[head]!.edges) {
      if (!used.has(edge) && !out.has(edge)) out.set(edge, train);
    }
  }
  return out;
}

/** Intersections between two wagons (+1 VP for a building there). */
function betweenWagons(state: GameState): number[] {
  return [...wagonDegree(state)].filter(([, count]) => count >= 2).map(([vertex]) => vertex);
}

function voteFrame(kind: `${string}.${string}`, responders: string[], data: VoteData): ModulePending {
  return { kind, module: TB, responders, data: data as unknown as Record<string, unknown> };
}

function placeWagon(state: GameState, edge: number, chooser: string, ctx: ModuleContext): void {
  const slot = trains(state);
  const train = wagonLocations(state).get(edge)!;
  slot.wagons.push({ edge, train });
  slot.supply -= 1;
  ctx.kit.emit(state, 'tb.wagonPlaced', { playerId: chooser, edge, train });
  ctx.kit.afterBoardChange(state);
}

/** Returns every bid card to the supply. */
function returnBids(state: GameState, data: VoteData): void {
  for (const bid of Object.values(data.bids)) {
    state.bank.wool += bid.wool;
    state.bank.grain += bid.grain;
  }
}

/** After the bids: a majority holder chooses, else the table assigns votes. */
function afterBids(state: GameState, data: VoteData, ctx: ModuleContext): void {
  const votes = Object.entries(data.bids).map(([id, bid]) => ({ id, votes: bid.wool + bid.grain }));
  const total = votes.reduce((sum, entry) => sum + entry.votes, 0);
  const majority = votes.find((entry) => entry.votes * 2 > total);
  if (total > 0 && majority) {
    ctx.kit.enqueuePending(state, voteFrame(PLACE, [majority.id], data));
    return;
  }
  const bidders = votes.filter((entry) => entry.votes > 0).map((entry) => entry.id);
  if (bidders.length === 0) {
    ctx.kit.enqueuePending(state, voteFrame(PLACE, [data.active], data));
    return;
  }
  ctx.kit.enqueuePending(state, voteFrame(ASSIGN, bidders, data));
}

/** After the assignments: most-voted location, else top bidder, else the active player. */
function afterAssignments(state: GameState, data: VoteData, ctx: ModuleContext): void {
  const tally = new Map<number, number>();
  for (const [id, edge] of Object.entries(data.assignments)) {
    const bid = data.bids[id]!;
    tally.set(edge, (tally.get(edge) ?? 0) + bid.wool + bid.grain);
  }
  const best = Math.max(...tally.values());
  const leaders = [...tally].filter(([, votes]) => votes === best);
  if (leaders.length === 1) {
    placeWagon(state, leaders[0]![0], data.active, ctx);
    finishVote(state, data, ctx);
    return;
  }
  const votes = Object.entries(data.bids).map(([id, bid]) => ({ id, votes: bid.wool + bid.grain }));
  const top = Math.max(...votes.map((entry) => entry.votes));
  const topBidders = votes.filter((entry) => entry.votes === top);
  const chooser = topBidders.length === 1 ? topBidders[0]!.id : data.active;
  ctx.kit.enqueuePending(state, voteFrame(PLACE, [chooser], data));
}

function finishVote(state: GameState, data: VoteData, ctx: ModuleContext): void {
  returnBids(state, data);
  ctx.kit.emit(state, 'tb.wagonVoteEnded', { playerId: data.active });
  ctx.kit.checkVictory(state);
}

function activeFrame(state: GameState, kind: string, actorId: string, ctx: ModuleContext) {
  const frame = state.pending as ModulePending | null;
  if (!frame || frame.kind !== kind) return { error: ctx.kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' }) };
  if (!frame.responders.includes(actorId)) return { error: ctx.kit.fail('E_NOT_ACTOR') };
  return { frame };
}

function bid(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame, error } = activeFrame(state, BID, actorId, ctx);
  if (error) return error;
  // Bids are made in table order (p. 13).
  if (frame.responders[0] !== actorId) return ctx.kit.fail('E_NOT_ACTOR');
  const wool = command.wool;
  const grain = command.grain;
  if (typeof wool !== 'number' || typeof grain !== 'number' || !Number.isInteger(wool) || !Number.isInteger(grain) || wool < 0 || grain < 0) {
    return ctx.kit.fail('E_INVALID_SELECTION', { reason: 'bid' });
  }
  const player = playerById(state, actorId)!;
  if (player.resources.wool < wool || player.resources.grain < grain) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { wool, grain });
  player.resources.wool -= wool;
  player.resources.grain -= grain;
  const data = frame.data as unknown as VoteData;
  data.bids[actorId] = { wool, grain };
  ctx.kit.emit(state, 'tb.wagonBid', { playerId: actorId, wool, grain });
  frame.responders.shift();
  if (frame.responders.length === 0) {
    afterBids(state, data, ctx);
    ctx.kit.completePending(state, ctx.rng);
  }
  return ctx.kit.accept(state);
}

function assign(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame, error } = activeFrame(state, ASSIGN, actorId, ctx);
  if (error) return error;
  const edge = command.edge;
  if (typeof edge !== 'number' || !wagonLocations(state).has(edge)) return ctx.kit.fail('E_ILLEGAL_TARGET', { edge });
  const data = frame.data as unknown as VoteData;
  data.assignments[actorId] = edge;
  ctx.kit.emit(state, 'tb.wagonVotes', { playerId: actorId, edge });
  frame.responders = frame.responders.filter((id) => id !== actorId);
  if (frame.responders.length === 0) {
    afterAssignments(state, data, ctx);
    const placed = !state.pendingQueue?.length;
    ctx.kit.completePending(state, ctx.rng);
    if (placed && !state.pending) ctx.kit.finishTurn(state);
  }
  return ctx.kit.accept(state);
}

function place(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame, error } = activeFrame(state, PLACE, actorId, ctx);
  if (error) return error;
  const edge = command.edge;
  if (typeof edge !== 'number' || !wagonLocations(state).has(edge)) return ctx.kit.fail('E_ILLEGAL_TARGET', { edge });
  const data = frame.data as unknown as VoteData;
  placeWagon(state, edge, actorId, ctx);
  finishVote(state, data, ctx);
  frame.responders = [];
  ctx.kit.completePending(state, ctx.rng);
  if (!state.pending) ctx.kit.finishTurn(state);
  return ctx.kit.accept(state);
}

export const trainsPart: TbPart = {
  id: TRAINS,
  frames: [BID, ASSIGN, PLACE],
  initGame(state) {
    const oasis = state.board.layout.terrain.indexOf('oasis');
    setPartState<TrainsState>(state, TRAINS, {
      oasis,
      starts: trainStarts(topologyOf(state), oasis),
      wagons: [],
      supply: WAGON_SUPPLY,
      collectedWindow: null,
    });
  },
  afterBuild(state, build, ctx) {
    // One wagon for building any number of buildings in the action phase (p. 13).
    if (build.setup || build.piece === 'road') return;
    const slot = trains(state);
    if (slot.collectedWindow === state.windowId || slot.supply <= 0) return;
    slot.collectedWindow = state.windowId;
    ctx.kit.emit(state, 'tb.wagonCollected', { playerId: build.playerId });
  },
  beforeEndTurn(state, actorId, ctx) {
    const slot = trains(state);
    if (slot.collectedWindow !== state.windowId) return 'continue';
    slot.collectedWindow = null;
    if (slot.supply <= 0 || wagonLocations(state).size === 0) return 'continue';
    const seats = state.players.length;
    const order = Array.from({ length: seats }, (_, step) => state.players[(state.turn.seat + step) % seats]!.id);
    ctx.kit.emit(state, 'tb.wagonVoteStarted', { playerId: actorId });
    ctx.kit.enqueuePending(state, voteFrame(BID, order, { bids: {}, assignments: {}, active: actorId }));
    return 'defer';
  },
  commands: {
    'tb.bidWagon': bid,
    'tb.assignWagon': assign,
    'tb.placeWagon': place,
  },
  pendingCommands: ['tb.bidWagon', 'tb.assignWagon', 'tb.placeWagon'],
  awardRules(state, rules) {
    const slot = partState<TrainsState>(state, TRAINS);
    if (!slot || slot.wagons.length === 0) return rules;
    const wagons = new Set(slot.wagons.map((wagon) => wagon.edge));
    // A wagon on a road's edge counts as an additional road (p. 14).
    return { ...rules, edgeWeight: (edge) => (wagons.has(edge) ? 2 : 1) };
  },
  score(state, playerId) {
    if (!partState<TrainsState>(state, TRAINS)) return 0;
    return betweenWagons(state).filter((vertex) => state.board.buildings[vertex]?.player === playerId).length * BETWEEN_WAGONS_POINTS;
  },
  project(state) {
    const slot = partState<TrainsState>(state, TRAINS);
    if (!slot) return null;
    const frame = moduleFrame(state);
    const vote = frame && [BID, ASSIGN, PLACE].includes(frame.kind) ? (frame.data as unknown as VoteData) : null;
    return {
      oasis: slot.oasis,
      starts: slot.starts.map((start) => ({ ...start })),
      wagons: slot.wagons.map((wagon) => ({ ...wagon })),
      heads: Object.fromEntries(trainHeads(state)),
      supply: slot.supply,
      collected: slot.collectedWindow === state.windowId,
      betweenWagons: betweenWagons(state),
      vote: vote ? { bids: JSON.parse(JSON.stringify(vote.bids)), assignments: { ...vote.assignments }, active: vote.active } : null,
    };
  },
  projectPending(_state, frame) {
    // Bids and assignments are public (face-up cards, open negotiation).
    return { kind: frame.kind, module: frame.module, responders: frame.responders.slice(), data: JSON.parse(JSON.stringify(frame.data)) };
  },
  actionHints(state, playerId) {
    const slot = partState<TrainsState>(state, TRAINS);
    if (!slot) return null;
    const frame = moduleFrame(state);
    const locations = [...wagonLocations(state).keys()];
    const mine = !!frame && frame.responders.includes(playerId);
    const board = mine && frame!.kind === PLACE
      ? { kind: 'edge', commandType: 'tb.placeWagon', labelId: 'tb.trains.place', targets: locations }
      : mine && frame!.kind === ASSIGN
        ? { kind: 'edge', commandType: 'tb.assignWagon', labelId: 'tb.trains.assign', targets: locations }
        : null;
    return {
      locations,
      bidTurn: mine && frame!.kind === BID && frame!.responders[0] === playerId,
      board,
    };
  },
};
