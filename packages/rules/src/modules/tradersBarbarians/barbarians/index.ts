/**
 * Barbarian Attack (TB25 pp. 15–19): every building lands barbarians on the
 * coast, three conquer a hex; knights from the castle drive them off at the
 * end of each turn for prisoners (2 = 1 VP); development cards are played as
 * soon as they are built.
 */

import { playerById, topologyOf, totalResources } from '../../../analysis.ts';
import { playerStats } from '../../../stats.ts';
import { RESOURCES, type GameState, type ModulePending, type Resource } from '../../../types.ts';
import type { ModuleCommand, ModuleContext } from '../../types.ts';
import { grantGold } from '../coins/index.ts';
import { frameKind, moduleFrame, TB, type TbPart } from '../part.ts';
import { partState, requirePartState, setPartState } from '../state.ts';
import { CASTLE, coastalHexes } from './board.ts';
import { hexIndex } from '../boardHelpers.ts';

export const BARBARIAN_ATTACK = 'tb-barbarian-attack';
export const BARBARIAN_SUPPLY = 36;
export const KNIGHTS_PER_PLAYER = 6;
export const CONQUER_AT = 3;
export const CARD_COST: Partial<Record<Resource, number>> = { wool: 1, grain: 1, ore: 1 };
export const KNIGHT_RANGE = 3;
export const KNIGHT_BOOSTED_RANGE = 5;
export const TREASON_GOLD = 2;
export const CONSOLATION_GOLD = 3;

export type BaCard = 'capture' | 'knighthood' | 'swiftKnight' | 'treason';
/** 4 Capture, 14 Knighthood, 4 Swift Knight, 4 Treason (p. 15). */
export const BA_DECK: readonly BaCard[] = [
  ...Array<BaCard>(4).fill('capture'),
  ...Array<BaCard>(14).fill('knighthood'),
  ...Array<BaCard>(4).fill('swiftKnight'),
  ...Array<BaCard>(4).fill('treason'),
];

export interface Knight {
  player: string;
  edge: number;
}

export interface BarbarianAttackState {
  castle: number;
  /** Coastal hexes in victory-check order. */
  coastal: number[];
  /** Barbarians per coastal hex. */
  barbarians: Record<number, number>;
  supply: number;
  knights: Knight[];
  prisoners: Record<string, number>;
  /** Face-down deck (drawn at random) and face-up discards. */
  deck: BaCard[];
  discard: BaCard[];
}

const STEAL = frameKind('baSteal');
const CAPTURE = frameKind('baCapture');
const KNIGHTHOOD = frameKind('baKnighthood');
const SWIFT = frameKind('baSwiftKnight');
const TREASON = frameKind('baTreason');
const KNIGHTS = frameKind('baKnights');

function ba(state: GameState): BarbarianAttackState {
  return requirePartState<BarbarianAttackState>(state, BARBARIAN_ATTACK);
}

export function isConquered(state: GameState, hex: number): boolean {
  return (partState<BarbarianAttackState>(state, BARBARIAN_ATTACK)?.barbarians[hex] ?? 0) >= CONQUER_AT;
}

/** A building touching only conquered hexes (and the frame) is conquered (p. 17). */
export function conqueredVertex(state: GameState, vertex: number): boolean {
  const hexes = topologyOf(state).vertices[vertex]!.hexes;
  return hexes.length > 0 && hexes.every((hex) => isConquered(state, hex));
}

function castleEdges(state: GameState): number[] {
  const slot = ba(state);
  return topologyOf(state).edges.map((info, edge) => ({ info, edge })).filter(({ info }) => info.hexes.includes(slot.castle)).map(({ edge }) => edge);
}

function hexEdges(state: GameState, hex: number): number[] {
  return topologyOf(state).edges.map((info, edge) => ({ info, edge })).filter(({ info }) => info.hexes.includes(hex)).map(({ edge }) => edge);
}

/** Edge orientation class matching the castle's pairs: 1/6 '/', 2/5 '\', 3/4 '|'. */
export function edgeOrientation(state: GameState, edge: number): 'slash' | 'backslash' | 'vertical' {
  const topology = topologyOf(state);
  const [a, b] = topology.edges[edge]!.vertices.map((vertex) => topology.vertices[vertex]!);
  if (Math.abs(a!.x - b!.x) < 1e-6) return 'vertical';
  const [left, right] = a!.x < b!.x ? [a!, b!] : [b!, a!];
  // y grows downward: a right end higher on screen is a '/'.
  return right.y < left.y ? 'slash' : 'backslash';
}

export function dieOrientation(die: number): 'slash' | 'backslash' | 'vertical' {
  return die === 1 || die === 6 ? 'slash' : die === 2 || die === 5 ? 'backslash' : 'vertical';
}

function knightsLeft(state: GameState, playerId: string): number {
  return KNIGHTS_PER_PLAYER - ba(state).knights.filter((knight) => knight.player === playerId).length;
}

function rollTwo(ctx: ModuleContext): number {
  return ctx.rng.int(6) + ctx.rng.int(6) + 2;
}

/** Barbarians land after a building is placed (p. 16). */
function attack(state: GameState, playerId: string, ctx: ModuleContext): void {
  const slot = ba(state);
  const rolled: number[] = [];
  const placed: number[] = [];
  for (let step = 0; step < 3 && slot.supply > 0; step++) {
    let total = rollTwo(ctx);
    while (total === 7 || rolled.includes(total)) total = rollTwo(ctx);
    rolled.push(total);
    const hex = slot.coastal.find((candidate) => state.board.layout.numbers[candidate] === total);
    if (hex === undefined || (slot.barbarians[hex] ?? 0) >= CONQUER_AT) continue;
    slot.barbarians[hex] = (slot.barbarians[hex] ?? 0) + 1;
    slot.supply -= 1;
    placed.push(hex);
    if (slot.barbarians[hex] === CONQUER_AT) ctx.kit.emit(state, 'tb.hexConquered', { hex });
  }
  ctx.kit.emit(state, 'tb.barbariansLanded', { playerId, rolls: rolled, hexes: placed });
}

function setBarbarians(state: GameState, hex: number, count: number, ctx: ModuleContext): void {
  const slot = ba(state);
  const before = slot.barbarians[hex] ?? 0;
  slot.barbarians[hex] = count;
  if (before >= CONQUER_AT && count < CONQUER_AT) ctx.kit.emit(state, 'tb.hexLiberated', { hex });
  if (before < CONQUER_AT && count >= CONQUER_AT) ctx.kit.emit(state, 'tb.hexConquered', { hex });
}

function frame(kind: `${string}.${string}`, responder: string, data: Record<string, unknown> = {}): ModulePending {
  return { kind, module: TB, responders: [responder], data };
}

function activeFrame(state: GameState, kind: string, actorId: string, ctx: ModuleContext) {
  const pending = state.pending as ModulePending | null;
  if (!pending || pending.kind !== kind) return { error: ctx.kit.fail('E_PENDING_EFFECT', { pending: pending?.kind ?? 'none' }) };
  if (pending.responders[0] !== actorId) return { error: ctx.kit.fail('E_NOT_ACTOR') };
  return { frame: pending };
}

function done(state: GameState, pending: ModulePending, ctx: ModuleContext) {
  pending.responders = [];
  ctx.kit.completePending(state, ctx.rng);
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

/** Draws a card at random from the face-down deck, reshuffling the discards when empty. */
function drawCard(state: GameState, ctx: ModuleContext): BaCard | null {
  const slot = ba(state);
  if (slot.deck.length === 0) {
    slot.deck = slot.discard;
    slot.discard = [];
  }
  if (slot.deck.length === 0) return null;
  return slot.deck.splice(ctx.rng.int(slot.deck.length), 1)[0]!;
}

function coastalWithBarbarians(state: GameState): number[] {
  const slot = ba(state);
  return slot.coastal.filter((hex) => (slot.barbarians[hex] ?? 0) > 0);
}

/** Builds a card and plays it at once (p. 17). */
function buildCard(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext) {
  if (ctx.kit.currentPlayer(state).id !== actorId) return ctx.kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return ctx.kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  const slot = ba(state);
  if (slot.deck.length + slot.discard.length === 0) return ctx.kit.fail('E_DECK_EMPTY');
  const player = playerById(state, actorId)!;
  if (!ctx.kit.canAfford(player, CARD_COST)) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost: CARD_COST });
  ctx.kit.payBuild(state, player, CARD_COST);
  let card = drawCard(state, ctx)!;
  // A Capture with no barbarian on the coast is discarded and replaced (p. 17).
  for (let guard = 0; card === 'capture' && coastalWithBarbarians(state).length === 0 && guard < BA_DECK.length; guard++) {
    ctx.kit.emit(state, 'tb.baCardDrawn', { playerId: actorId, card, effect: 'none' });
    slot.discard.push(card);
    const next = drawCard(state, ctx);
    if (!next) return ctx.kit.accept(state);
    card = next;
  }
  const stats = playerStats(state, actorId);
  const bought = stats.devCardsBought as Record<string, number>;
  bought[card] = (bought[card] ?? 0) + 1;
  slot.discard.push(card);
  switch (card) {
    case 'capture':
      ctx.kit.emit(state, 'tb.baCardDrawn', { playerId: actorId, card, effect: 'choose' });
      ctx.kit.enqueuePending(state, frame(CAPTURE, actorId));
      break;
    case 'knighthood': {
      const free = castleEdges(state).filter((edge) => !slot.knights.some((knight) => knight.edge === edge));
      const playable = knightsLeft(state, actorId) > 0 && free.length > 0;
      ctx.kit.emit(state, 'tb.baCardDrawn', { playerId: actorId, card, effect: playable ? 'choose' : 'none' });
      if (playable) ctx.kit.enqueuePending(state, frame(KNIGHTHOOD, actorId));
      break;
    }
    case 'swiftKnight': {
      const playable = knightsLeft(state, actorId) > 0;
      ctx.kit.emit(state, 'tb.baCardDrawn', { playerId: actorId, card, effect: playable ? 'choose' : 'none' });
      if (playable) ctx.kit.enqueuePending(state, frame(SWIFT, actorId));
      break;
    }
    case 'treason':
      ctx.kit.emit(state, 'tb.baCardDrawn', { playerId: actorId, card, effect: 'choose' });
      grantGold(state, actorId, TREASON_GOLD, 'treason', ctx);
      if (treasonMoves(state, { sources: [], targets: [] }).length > 0) {
        ctx.kit.enqueuePending(state, frame(TREASON, actorId, { moved: 0, sources: [], targets: [] }));
      }
      break;
  }
  return ctx.kit.accept(state);
}

function capture(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame: pending, error } = activeFrame(state, CAPTURE, actorId, ctx);
  if (error) return error;
  const hex = command.hex;
  if (typeof hex !== 'number' || !coastalWithBarbarians(state).includes(hex)) return ctx.kit.fail('E_ILLEGAL_TARGET', { hex });
  const slot = ba(state);
  setBarbarians(state, hex, slot.barbarians[hex]! - 1, ctx);
  slot.prisoners[actorId] = (slot.prisoners[actorId] ?? 0) + 1;
  ctx.kit.emit(state, 'tb.barbarianCaptured', { playerId: actorId, hex });
  return done(state, pending, ctx);
}

function placeKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const pending = state.pending as ModulePending | null;
  const kind = pending?.kind === KNIGHTHOOD ? KNIGHTHOOD : SWIFT;
  const { frame: active, error } = activeFrame(state, kind, actorId, ctx);
  if (error) return error;
  const edge = command.edge;
  const slot = ba(state);
  const allowed = kind === KNIGHTHOOD ? castleEdges(state) : topologyOf(state).edges.map((_, index) => index);
  if (typeof edge !== 'number' || !allowed.includes(edge) || slot.knights.some((knight) => knight.edge === edge)) {
    return ctx.kit.fail('E_ILLEGAL_TARGET', { edge });
  }
  slot.knights.push({ player: actorId, edge });
  ctx.kit.emit(state, 'tb.knightPlaced', { playerId: actorId, edge });
  return done(state, active, ctx);
}

interface TreasonData {
  moved: number;
  sources: number[];
  targets: number[];
}

/** Legal (from, to) moves for the next Treason step; from -1 is the supply. */
function treasonMoves(state: GameState, data: Pick<TreasonData, 'sources' | 'targets'>): [number, number][] {
  const slot = ba(state);
  const sources = coastalWithBarbarians(state).filter((hex) => !data.sources.includes(hex) && !data.targets.includes(hex));
  const from = sources.length > 0 ? sources : slot.supply > 0 ? [-1] : [];
  const out: [number, number][] = [];
  for (const source of from) {
    for (const target of slot.coastal) {
      if (target === source || data.sources.includes(target) || data.targets.includes(target)) continue;
      if ((slot.barbarians[target] ?? 0) >= CONQUER_AT) continue;
      out.push([source, target]);
    }
  }
  return out;
}

function treason(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame: pending, error } = activeFrame(state, TREASON, actorId, ctx);
  if (error) return error;
  const data = pending.data as unknown as TreasonData;
  const from = command.from;
  const to = command.to;
  if (!treasonMoves(state, data).some(([a, b]) => a === from && b === to)) return ctx.kit.fail('E_ILLEGAL_TARGET', { from, to });
  const slot = ba(state);
  if (from === -1) slot.supply -= 1;
  else setBarbarians(state, from as number, slot.barbarians[from as number]! - 1, ctx);
  setBarbarians(state, to as number, (slot.barbarians[to as number] ?? 0) + 1, ctx);
  data.moved += 1;
  if (from !== -1) data.sources.push(from as number);
  data.targets.push(to as number);
  ctx.kit.emit(state, 'tb.barbarianMoved', { playerId: actorId, from, to });
  if (data.moved >= 2 || treasonMoves(state, data).length === 0) return done(state, pending, ctx);
  return ctx.kit.accept(state);
}

function stealFrom(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame: pending, error } = activeFrame(state, STEAL, actorId, ctx);
  if (error) return error;
  const victim = typeof command.victim === 'string' ? playerById(state, command.victim) : undefined;
  if (!victim || victim.id === actorId || totalResources(victim) === 0) return ctx.kit.fail('E_NO_ELIGIBLE_VICTIM', { victim: command.victim });
  const pool = RESOURCES.flatMap((kind) => Array<Resource>(victim.resources[kind]).fill(kind));
  const taken = pool[ctx.rng.int(pool.length)]!;
  victim.resources[taken] -= 1;
  playerById(state, actorId)!.resources[taken] += 1;
  ctx.kit.emit(state, 'tb.baStole', { playerId: actorId, victim: victim.id }, { to: [actorId, victim.id], params: { resource: taken } });
  return done(state, pending, ctx);
}

/** Edges reachable within `range` steps along connected edges (pieces are ignored). */
function reachable(state: GameState, from: number, range: number): Map<number, number> {
  const topology = topologyOf(state);
  const distance = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let step = 1; step <= range; step++) {
    const next: number[] = [];
    for (const edge of frontier) {
      for (const vertex of topology.edges[edge]!.vertices) {
        for (const other of topology.vertices[vertex]!.edges) {
          if (distance.has(other)) continue;
          distance.set(other, step);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  distance.delete(from);
  return distance;
}

/** Destinations for a knight: no other knight, never a castle edge. */
function knightTargets(state: GameState, from: number, range: number): number[] {
  const slot = ba(state);
  const castle = new Set(castleEdges(state));
  return [...reachable(state, from, range).keys()].filter((edge) => !castle.has(edge) && !slot.knights.some((knight) => knight.edge === edge));
}

function moveKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext) {
  const { frame: pending, error } = activeFrame(state, KNIGHTS, actorId, ctx);
  if (error) return error;
  const slot = ba(state);
  const moved = pending.data.moved as number[];
  const knight = slot.knights.find((candidate) => candidate.edge === command.from && candidate.player === actorId);
  if (!knight || moved.includes(knight.edge)) return ctx.kit.fail('E_ILLEGAL_TARGET', { from: command.from });
  const boost = command.boost === true;
  const range = boost ? KNIGHT_BOOSTED_RANGE : KNIGHT_RANGE;
  const to = command.to;
  if (typeof to !== 'number' || !knightTargets(state, knight.edge, range).includes(to)) return ctx.kit.fail('E_TB_KNIGHT_RANGE', { to, range });
  const player = playerById(state, actorId)!;
  if (boost) {
    if (player.resources.grain < 1) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost: { grain: 1 } });
    ctx.kit.payBuild(state, player, { grain: 1 });
  }
  const from = knight.edge;
  knight.edge = to;
  moved.push(to);
  ctx.kit.emit(state, 'tb.knightMoved', { playerId: actorId, from, to, boost });
  return ctx.kit.accept(state);
}

/** Ends the knight moves, then expels the barbarians and closes the turn. */
function endKnights(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext) {
  const { frame: pending, error } = activeFrame(state, KNIGHTS, actorId, ctx);
  if (error) return error;
  const slot = ba(state);
  const castle = new Set(castleEdges(state));
  // A knight on a castle edge must move this turn (p. 17).
  const stuck = slot.knights.find((knight) => knight.player === actorId && castle.has(knight.edge) &&
    knightTargets(state, knight.edge, KNIGHT_RANGE).length > 0);
  if (stuck) return ctx.kit.fail('E_TB_KNIGHT_MUST_MOVE', { edge: stuck.edge });
  pending.responders = [];
  ctx.kit.completePending(state, ctx.rng);
  expel(state, ctx);
  ctx.kit.checkVictory(state);
  if (!state.result && !state.pending) ctx.kit.finishTurn(state);
  return ctx.kit.accept(state);
}

/** Orders players by dice, re-rolling ties among them. */
function diceOrder(players: string[], ctx: ModuleContext): { order: string[]; rolls: Record<string, number[]> } {
  const rolls: Record<string, number[]> = Object.fromEntries(players.map((id) => [id, []]));
  const rank = (group: string[]): string[] => {
    if (group.length <= 1) return group;
    const scores = group.map((id) => {
      const value = rollTwo(ctx);
      rolls[id]!.push(value);
      return { id, value };
    });
    const values = [...new Set(scores.map((entry) => entry.value))].sort((a, b) => b - a);
    return values.flatMap((value) => rank(scores.filter((entry) => entry.value === value).map((entry) => entry.id)));
  };
  return { order: rank(players), rolls };
}

/** Victory checks around the coast, prisoners, liberation and knight losses (p. 18). */
function expel(state: GameState, ctx: ModuleContext): void {
  const slot = ba(state);
  for (const hex of slot.coastal) {
    const barbarians = slot.barbarians[hex] ?? 0;
    if (barbarians === 0) continue;
    const edges = new Set(hexEdges(state, hex));
    const involvedKnights = slot.knights.filter((knight) => edges.has(knight.edge));
    if (involvedKnights.length <= barbarians) continue;
    const counts = new Map<string, number>();
    for (const knight of involvedKnights) counts.set(knight.player, (counts.get(knight.player) ?? 0) + 1);
    const players = [...counts.keys()];
    const prisoners: Record<string, number> = {};
    const gold: Record<string, number> = {};
    let rolls: Record<string, number[]> = {};
    if (players.length === 1) {
      prisoners[players[0]!] = barbarians;
    } else if (barbarians >= players.length) {
      for (const id of players) prisoners[id] = 1;
      if (barbarians > players.length) {
        const most = Math.max(...counts.values());
        const leaders = players.filter((id) => counts.get(id) === most);
        const ranked = diceOrder(leaders, ctx);
        rolls = ranked.rolls;
        prisoners[ranked.order[0]!] += 1;
        // The other tied player(s) take 3 gold instead.
        for (const id of ranked.order.slice(1)) gold[id] = CONSOLATION_GOLD;
      }
    } else {
      const ranked = diceOrder(players, ctx);
      rolls = ranked.rolls;
      ranked.order.forEach((id, index) => {
        if (index < barbarians) prisoners[id] = 1;
        else gold[id] = CONSOLATION_GOLD;
      });
    }
    for (const [id, count] of Object.entries(prisoners)) slot.prisoners[id] = (slot.prisoners[id] ?? 0) + count;
    setBarbarians(state, hex, 0, ctx);
    ctx.kit.emit(state, 'tb.barbariansExpelled', { hex, prisoners, gold, rolls });
    for (const [id, amount] of Object.entries(gold)) grantGold(state, id, amount, 'consolation', ctx);
    // Knight losses: one die picks an edge orientation of the castle.
    const die = ctx.rng.int(6) + 1;
    const orientation = dieOrientation(die);
    const lost: Record<string, number> = {};
    slot.knights = slot.knights.filter((knight) => {
      if (!edges.has(knight.edge) || edgeOrientation(state, knight.edge) !== orientation) return true;
      lost[knight.player] = (lost[knight.player] ?? 0) + 1;
      return false;
    });
    ctx.kit.emit(state, 'tb.knightsLost', { hex, die, lost });
    for (const [id, count] of Object.entries(lost)) grantGold(state, id, count * CONSOLATION_GOLD, 'knightLoss', ctx);
  }
}

export const barbarianAttackPart: TbPart = {
  id: BARBARIAN_ATTACK,
  frames: [STEAL, CAPTURE, KNIGHTHOOD, SWIFT, TREASON, KNIGHTS],
  initGame(state, ctx) {
    const topology = topologyOf(state);
    const coastal = coastalHexes(topology);
    const barbarians: Record<number, number> = {};
    // One barbarian each on the 2 and the 12 (p. 15).
    for (const hex of coastal) if ([2, 12].includes(state.board.layout.numbers[hex] ?? 0)) barbarians[hex] = 1;
    const deck = [...BA_DECK];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = ctx.rng.int(i + 1);
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    setPartState<BarbarianAttackState>(state, BARBARIAN_ATTACK, {
      castle: hexIndex(topology, CASTLE),
      coastal,
      barbarians,
      supply: BARBARIAN_SUPPLY - 2,
      knights: [],
      prisoners: Object.fromEntries(state.players.map((player) => [player.id, 0])),
      deck,
      discard: [],
    });
  },
  setupBuilding: (_state, step) => (step.round === 2 ? 'city' : undefined),
  hexProduces(state, hex) {
    return !isConquered(state, hex);
  },
  roadAllowed(state, _playerId, edge) {
    return !topologyOf(state).edges[edge]!.hexes.some((hex) => isConquered(state, hex));
  },
  buildingAllowed(state, _playerId, vertex) {
    return !topologyOf(state).vertices[vertex]!.hexes.some((hex) => isConquered(state, hex));
  },
  harborAccess(state, _playerId, vertex) {
    return !conqueredVertex(state, vertex);
  },
  afterBuild(state, build, ctx) {
    if (build.setup || build.piece === 'road') return;
    attack(state, build.playerId, ctx);
  },
  sevenRobberStep(state, actorId) {
    // No robber: the roller steals from a player of their choice (p. 16).
    const victims = state.players.filter((player) => player.id !== actorId && totalResources(player) > 0);
    return victims.length > 0 ? frame(STEAL, actorId) : null;
  },
  beforeEndTurn(state, actorId, ctx) {
    const slot = ba(state);
    if (slot.knights.some((knight) => knight.player === actorId)) {
      ctx.kit.enqueuePending(state, frame(KNIGHTS, actorId, { moved: [] }));
      return 'defer';
    }
    expel(state, ctx);
    ctx.kit.checkVictory(state);
    return state.result ? 'defer' : 'continue';
  },
  commands: {
    'tb.buildBaCard': buildCard,
    'tb.baCapture': capture,
    'tb.baPlaceKnight': placeKnight,
    'tb.baTreason': treason,
    'tb.baSteal': stealFrom,
    'tb.moveKnight': moveKnight,
    'tb.endKnights': endKnights,
  },
  pendingCommands: ['tb.baCapture', 'tb.baPlaceKnight', 'tb.baTreason', 'tb.baSteal', 'tb.moveKnight', 'tb.endKnights'],
  score(state, playerId) {
    const slot = partState<BarbarianAttackState>(state, BARBARIAN_ATTACK);
    if (!slot) return 0;
    let score = Math.floor((slot.prisoners[playerId] ?? 0) / 2);
    // Conquered buildings are worth nothing (p. 17).
    state.board.buildings.forEach((building, vertex) => {
      if (building?.player === playerId && conqueredVertex(state, vertex)) score -= building.city ? 2 : 1;
    });
    return score;
  },
  project(state) {
    const slot = partState<BarbarianAttackState>(state, BARBARIAN_ATTACK);
    if (!slot) return null;
    return {
      castle: slot.castle,
      castleEdges: castleEdges(state),
      coastal: [...slot.coastal],
      barbarians: { ...slot.barbarians },
      conquered: slot.coastal.filter((hex) => isConquered(state, hex)),
      conqueredBuildings: state.board.buildings.map((building, vertex) => (building && conqueredVertex(state, vertex) ? vertex : -1)).filter((vertex) => vertex >= 0),
      supply: slot.supply,
      knights: slot.knights.map((knight) => ({ ...knight })),
      knightsLeft: Object.fromEntries(state.players.map((player) => [player.id, knightsLeft(state, player.id)])),
      prisoners: { ...slot.prisoners },
      deckCount: slot.deck.length,
      discard: [...slot.discard],
      orientations: Object.fromEntries(castleEdges(state).map((edge) => [edge, edgeOrientation(state, edge)])),
    };
  },
  projectPending(state, pending) {
    const data = pending.kind === TREASON || pending.kind === KNIGHTS ? JSON.parse(JSON.stringify(pending.data)) : {};
    void state;
    return { kind: pending.kind, module: pending.module, responders: pending.responders.slice(), data };
  },
  actionHints(state, playerId) {
    const slot = partState<BarbarianAttackState>(state, BARBARIAN_ATTACK);
    if (!slot) return null;
    const pending = moduleFrame(state);
    const mine = !!pending && pending.responders[0] === playerId;
    const own = state.players[state.turn.seat]?.id === playerId && state.turn.phase === 'action' && !state.pending;
    let board: unknown = null;
    if (mine && pending!.kind === CAPTURE) board = { kind: 'hex', commandType: 'tb.baCapture', labelId: 'tb.ba.capture', targets: coastalWithBarbarians(state) };
    if (mine && pending!.kind === KNIGHTHOOD) {
      board = { kind: 'edge', commandType: 'tb.baPlaceKnight', labelId: 'tb.ba.placeKnight',
        targets: castleEdges(state).filter((edge) => !slot.knights.some((knight) => knight.edge === edge)) };
    }
    if (mine && pending!.kind === SWIFT) {
      board = { kind: 'edge', commandType: 'tb.baPlaceKnight', labelId: 'tb.ba.placeKnight',
        targets: topologyOf(state).edges.map((_, edge) => edge).filter((edge) => !slot.knights.some((knight) => knight.edge === edge)) };
    }
    const moved = mine && pending!.kind === KNIGHTS ? (pending!.data.moved as number[]) : [];
    const knightMoves = mine && pending!.kind === KNIGHTS
      ? slot.knights.filter((knight) => knight.player === playerId && !moved.includes(knight.edge)).map((knight) => ({
        from: knight.edge,
        targets: knightTargets(state, knight.edge, KNIGHT_RANGE),
        boosted: knightTargets(state, knight.edge, KNIGHT_BOOSTED_RANGE),
      }))
      : [];
    const targets: Record<string, number[]> = {};
    for (const move of knightMoves) {
      targets[`tb.moveKnight:${move.from}:0`] = move.targets;
      targets[`tb.moveKnight:${move.from}:1`] = move.boosted;
    }
    return {
      canBuildCard: own && slot.deck.length + slot.discard.length > 0,
      board,
      targets,
      knightMoves,
      treasonMoves: mine && pending!.kind === TREASON ? treasonMoves(state, pending!.data as unknown as TreasonData) : [],
      stealVictims: mine && pending!.kind === STEAL
        ? state.players.filter((player) => player.id !== playerId && totalResources(player) > 0).map((player) => player.id)
        : [],
    };
  },
};
