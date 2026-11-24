/**
 * Ships (SF25 p. 2, SF-FAQ 13–18): placement, movement and the commands that
 * build or move them.
 *
 * - A ship occupies an empty sea edge (an edge of a sea hex or the inner edge
 *   of the frame); a coastal edge holds a road or a ship, never both.
 * - A new ship connects to one of the player's ships or buildings, never to a
 *   road, and may not continue past an opponent's building.
 * - No ship is placed on, moved to or moved from an edge of the pirate's hex.
 * - One ship move per action window: not a ship built in that window, only a
 *   ship with an open end (an end with neither an own ship nor an own
 *   building). A ship inside a line linking two own buildings never has an
 *   open end, so it cannot move even if an opponent's building splits the
 *   line (SF25 p. 2, SF-FAQ 14).
 * - 世外部落：建造或移動船到有禮物的邊就拿走禮物（`tribe.ts`）。
 * - Like roads, ships never pass an intersection another player's module
 *   piece holds (`vertexBlocker`, the Cities & Knights knights), and other
 *   modules may veto a ship move (`shipMoveBlocked`).
 */

import { isBlockedFor, isSeaEdge, playerById, topologyOf } from '../../analysis.ts';
import { getProfile } from '../../profiles.ts';
import type { CommandOutcome, GameState, Resource } from '../../types.ts';
import { rulesModulesOf } from '../registry.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import { exploreAtEdge } from './fog.ts';
import { lineAllows, lineBacktrackMovable, lineContext, lineShip, recordLineShip, wallContext, wallsAnyone, type LineContext, type WallContext } from './pirateIslands.ts';
import { seafarersState, seafarersView } from './state.ts';
import { takeGift } from './tribe.ts';

export const SHIP_COST: Partial<Record<Resource, number>> = { lumber: 1, wool: 1 };

export interface ShipPlacementOptions {
  /** Setup: the ship must touch this settlement intersection. */
  setupVertex?: number | null;
  /** A ship being moved: its current edge counts as empty and cannot link. */
  moving?: number;
  /** 海盜巢穴：呼叫端已算好的船線狀態（一次列出所有合法邊時共用）。 */
  line?: LineContext | null;
  /** 海盜巢穴：呼叫端已算好的「圍死別人目標」狀態（`null` 略過這條規則）。 */
  walls?: WallContext | null;
}

export function countShips(state: GameState, playerId: string): number {
  let count = 0;
  for (const road of state.board.roads) if (road?.ship && road.player === playerId) count++;
  return count;
}

export function touchesPirate(state: GameState, edge: number): boolean {
  const pirate = state.board.pirate;
  if (pirate === null) return false;
  return topologyOf(state).edges[edge]?.hexes.includes(pirate) ?? false;
}

function ownShipAt(state: GameState, playerId: string, vertex: number, except: readonly number[]): boolean {
  const topo = topologyOf(state);
  return topo.vertices[vertex]!.edges.some((edge) => {
    if (except.includes(edge)) return false;
    const road = state.board.roads[edge];
    return !!road && road.ship && road.player === playerId;
  });
}

export function canPlaceShip(state: GameState, playerId: string, edge: number, options: ShipPlacementOptions = {}): boolean {
  const topo = topologyOf(state);
  const info = topo.edges[edge];
  if (!info) return false;
  if (edge === options.moving) return false;
  if (state.board.roads[edge]) return false;
  if (!isSeaEdge(state, edge)) return false;
  if (touchesPirate(state, edge)) return false;
  if (options.setupVertex !== undefined) {
    return options.setupVertex !== null && info.vertices.includes(options.setupVertex) && lineAllows(state, playerId, edge, options)
      && !wallsShip(state, playerId, edge, options);
  }
  const except = options.moving === undefined ? [edge] : [edge, options.moving];
  const connected = info.vertices.some((vertex) => {
    const building = state.board.buildings[vertex];
    if (building) return building.player === playerId;
    if (isBlockedFor(state, vertex, playerId)) return false;
    return ownShipAt(state, playerId, vertex, except);
  });
  // 海盜巢穴：西島船線只能有一條不分叉的最短路徑（其他劇本一律允許）。
  return connected && lineAllows(state, playerId, edge, options)
    && !wallsShip(state, playerId, edge, options);
}

/**
 * 這艘船會不會圍死任何玩家的目標。自己船線的嚴格最短延伸（新蓋的船，新端點距離 −1）不受限制：
 * 走最短路徑是規則要求的，不算蓄意擋人（使用者決定 2026-11-24）；自由船、移船（含退回後的落點）照樣檢查。
 */
function wallsShip(state: GameState, playerId: string, edge: number, options: ShipPlacementOptions): boolean {
  if (options.walls === null) return false;
  const step = lineShip(state, playerId, edge, options);
  if (step.kind === 'line' && options.moving === undefined) return false;
  return wallsAnyone(state, {
    edge,
    owner: playerId,
    ...(options.moving === undefined ? {} : { vacated: options.moving }),
    ...(step.kind === 'line' ? { extend: step.to } : {}),
  }, options.walls);
}

/**
 * 放不下時的錯誤：一般規則都過了、只被海盜巢穴的船線規則擋下時回報 `E_SHIP_LINE`，其餘是 `E_ILLEGAL_TARGET`。
 * （`line: null` 讓 `canPlaceShip` 略過船線規則。）
 */
function refusal(state: GameState, playerId: string, edge: number, options: ShipPlacementOptions, kit: ModuleContext['kit']): CommandOutcome {
  const plain = { ...options, line: null, walls: null };
  if (!canPlaceShip(state, playerId, edge, plain)) return kit.fail('E_ILLEGAL_TARGET', { edge });
  // 一般規則都過了：先看船線規則，再看會不會把別人（或自己）的目標圍死。
  return canPlaceShip(state, playerId, edge, { ...options, walls: null })
    ? kit.fail('E_LINE_WALLED', { edge })
    : kit.fail('E_SHIP_LINE', { edge });
}

export function legalShipEdges(state: GameState, playerId: string, options: ShipPlacementOptions = {}): number[] {
  const out: number[] = [];
  const edges = topologyOf(state).edges.length;
  // 海盜巢穴：船線的距離表只算一次（其他劇本是 null）。
  const checked = { ...options, ...(options.line === undefined ? { line: lineContext(state, playerId, options.moving) } : {}), ...(options.walls === undefined ? { walls: wallContext(state) } : {}) };
  for (let edge = 0; edge < edges; edge++) if (canPlaceShip(state, playerId, edge, checked)) out.push(edge);
  return out;
}

/** Ship placements a player may still make (piece supply included). */
export function buildableShipEdges(state: GameState, playerId: string, ships: number): number[] {
  if (countShips(state, playerId) >= ships) return [];
  return legalShipEdges(state, playerId);
}

/** True when this end of the ship touches neither another own ship nor an own building. */
export function isOpenShipEnd(state: GameState, playerId: string, edge: number, vertex: number): boolean {
  if (state.board.buildings[vertex]?.player === playerId) return false;
  return !ownShipAt(state, playerId, vertex, [edge]);
}

/** An end of the ship with neither an own ship nor an own building. */
export function hasOpenEnd(state: GameState, playerId: string, edge: number): boolean {
  const info = topologyOf(state).edges[edge];
  if (!info) return false;
  return info.vertices.some((vertex) => isOpenShipEnd(state, playerId, edge, vertex));
}

export type ShipMoveBlock =
  | 'not-a-ship'
  | 'already-moved'
  | 'built-this-turn'
  | 'pirate'
  | 'closed';

/** Why a ship cannot move this window, or `null` when it can. */
export function shipMoveBlock(state: GameState, playerId: string, edge: number): ShipMoveBlock | null {
  const road = state.board.roads[edge];
  if (!road || !road.ship || road.player !== playerId) return 'not-a-ship';
  const slot = seafarersView(state);
  if (slot.moved) return 'already-moved';
  if (slot.built.includes(edge)) return 'built-this-turn';
  if (touchesPirate(state, edge)) return 'pirate';
  // 海盜巢穴：被圍死時可以退回的末端船，即使端點接著自己的建築也可以移動（接著自己的船則不行）。
  if (!hasOpenEnd(state, playerId, edge) && !lineBacktrackMovable(state, playerId, edge)) return 'closed';
  if (moduleShipMoveVeto(state, playerId, edge)) return 'closed';
  return null;
}

/** Another module of the profile forbids moving this ship. */
function moduleShipMoveVeto(state: GameState, playerId: string, edge: number): boolean {
  const profile = getProfile(state.profileId);
  if (!profile) return false;
  return rulesModulesOf(profile).some((module) => module.shipMoveBlocked?.(state, playerId, edge, { profile }) === true);
}

/** Where a movable ship may go (empty if it cannot move). */
export function shipMoveTargets(state: GameState, playerId: string, edge: number): number[] {
  if (shipMoveBlock(state, playerId, edge)) return [];
  return legalShipEdges(state, playerId, { moving: edge });
}

export function movableShips(state: GameState, playerId: string): { edge: number; targets: number[] }[] {
  const out: { edge: number; targets: number[] }[] = [];
  state.board.roads.forEach((road, edge) => {
    if (!road?.ship || road.player !== playerId) return;
    const targets = shipMoveTargets(state, playerId, edge);
    if (targets.length > 0) out.push({ edge, targets });
  });
  return out;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function edgeOf(command: ModuleCommand, field: string): number | null {
  const value = command[field];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function actionWindowGuard(state: GameState, actorId: string, ctx: ModuleContext): CommandOutcome | null {
  if (ctx.kit.currentPlayer(state).id !== actorId) return ctx.kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return ctx.kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  return null;
}

/** `build.ship { edge }` — paid, or free inside a Road Building effect. */
export function buildShip(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const pending = state.pending;
  if (pending && pending.kind !== 'freeRoads') return kit.fail('E_PENDING_EFFECT', { pending: pending.kind });
  const free = pending?.kind === 'freeRoads' ? pending : null;
  if (free) {
    if (free.actor !== actorId) return kit.fail('E_NOT_ACTOR');
  } else {
    const guard = actionWindowGuard(state, actorId, ctx);
    if (guard) return guard;
  }
  const edge = edgeOf(command, 'edge');
  if (edge === null) return kit.fail('E_INVALID_COMMAND');
  if (touchesPirate(state, edge)) return kit.fail('E_PIRATE_BLOCKS', { edge });
  if (!canPlaceShip(state, actorId, edge)) return refusal(state, actorId, edge, {}, kit);
  if (countShips(state, actorId) >= ctx.profile.pieces.ships) return kit.fail('E_NO_PIECES', { piece: 'ship' });
  const player = playerById(state, actorId)!;
  if (!free) {
    if (!kit.canAfford(player, SHIP_COST)) return kit.fail('E_INSUFFICIENT_RESOURCES', { cost: SHIP_COST });
    kit.payBuild(state, player, SHIP_COST);
  }
  // 海盜巢穴：船線的延伸先記進船線（判定用的是放下之前的盤面）。
  recordLineShip(state, actorId, edge);
  state.board.roads[edge] = { player: actorId, ship: true };
  seafarersState(state).built.push(edge);
  kit.emit(state, 'ship.built', { playerId: actorId, edge, free: !!free });
  // 世外部落：建造到有禮物的邊就拿走（其他劇本沒有禮物，什麼都不做）。
  takeGift(state, actorId, edge, ctx);
  kit.afterBoardChange(state);
  exploreAtEdge(state, actorId, edge, ctx);
  if (free) kit.placedFreeRoute(state, actorId, ctx.rng);
  kit.checkVictory(state);
  return kit.accept(state);
}

/** `ship.move { from, to }` — the action window's one ship move. */
export function moveShip(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = actionWindowGuard(state, actorId, ctx);
  if (guard) return guard;
  const from = edgeOf(command, 'from');
  const to = edgeOf(command, 'to');
  if (from === null || to === null) return kit.fail('E_INVALID_COMMAND');
  switch (shipMoveBlock(state, actorId, from)) {
    case 'not-a-ship':
      return kit.fail('E_ILLEGAL_TARGET', { edge: from });
    case 'already-moved':
      return kit.fail('E_SHIP_ALREADY_MOVED');
    case 'built-this-turn':
      return kit.fail('E_SHIP_BUILT_THIS_TURN', { edge: from });
    case 'pirate':
      return kit.fail('E_PIRATE_BLOCKS', { edge: from });
    case 'closed':
      return kit.fail('E_SHIP_NOT_MOVABLE', { edge: from });
    default:
      break;
  }
  if (touchesPirate(state, to)) return kit.fail('E_PIRATE_BLOCKS', { edge: to });
  if (!canPlaceShip(state, actorId, to, { moving: from })) return refusal(state, actorId, to, { moving: from }, kit);
  // Remove and place in one transition: awards and victory are only judged
  // on the final board (SF-FAQ 12).
  recordLineShip(state, actorId, to, { moving: from });
  state.board.roads[to] = state.board.roads[from]!;
  state.board.roads[from] = null;
  seafarersState(state).moved = true;
  kit.emit(state, 'ship.moved', { playerId: actorId, from, to });
  // 世外部落：移動到有禮物的邊也拿走（SF25 p. 12 `build or move`）。
  takeGift(state, actorId, to, ctx);
  kit.afterBoardChange(state);
  // 移動船預設不翻開迷霧（SF25 p. 8 只寫 place；OQ-2）；`fogOnMove` 旗標可切換。
  if (ctx.profile.fogOnMove) exploreAtEdge(state, actorId, to, ctx);
  kit.checkVictory(state);
  return kit.accept(state);
}

/**
 * `setup.placeShip { edge }` — a coastal starting settlement may take a ship
 * on an adjacent sea edge instead of its road (SF25 p. 3).
 */
export function setupShip(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const setup = state.turn.setup;
  if (!setup) return kit.fail('E_WRONG_PHASE');
  if (setup.stage !== 'road') return kit.fail('E_WRONG_PHASE', { stage: setup.stage });
  const seat = setup.order[setup.index];
  if (seat === undefined || state.players[seat]!.id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
  const edge = edgeOf(command, 'edge');
  if (edge === null) return kit.fail('E_INVALID_COMMAND');
  if (touchesPirate(state, edge)) return kit.fail('E_PIRATE_BLOCKS', { edge });
  if (!canPlaceShip(state, actorId, edge, { setupVertex: setup.lastVertex })) return refusal(state, actorId, edge, { setupVertex: setup.lastVertex }, kit);
  recordLineShip(state, actorId, edge, { setupVertex: setup.lastVertex });
  state.board.roads[edge] = { player: actorId, ship: true };
  kit.emit(state, 'setup.ship', { playerId: actorId, edge });
  // 設置階段放的船不翻開迷霧：探索寫在 Additional rules（遊戲中的建造）；設置中翻開會在
  // 開局前發資源或產生待處理選擇，與設置流程衝突（work record I8）。
  kit.finishSetupStep(state);
  return kit.accept(state);
}
