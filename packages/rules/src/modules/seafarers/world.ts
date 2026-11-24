/**
 * New World（新世界，SF25 p. 20）的設置階段 `harbors`。
 *
 * 版圖由 layout builder 產生（隨機地形與圓片）。起始村落之前，玩家從起始玩家起順時針輪流放港口：
 * 每次用 `ctx.rng` 從剩下的港口標記隨機抽一個，面朝上，玩家選一條陸地與海／框之間的邊，
 * 與其他港口至少隔一條邊；直到 10 個放完。實作成 `SetupState.stage = 'harbor'`（沒有 pending frame），
 * 輪到誰放由 `turn.seat` 決定；放完後回到 `building`，從 `order[0]` 開始照基礎規則放起始村落。
 *
 * 無合法邊：合法性只看邊與現有港口，與港口種類無關，所以一旦沒有合法邊，剩下的港口全都放不下；
 * 此時剩餘港口放回盒子（發出 `world.harborsSkipped`）、港口階段提前結束。42 格版圖的海岸邊遠多於
 * 10 個港口所需，實務上不會發生，這是為了保證設置必定能繼續的處理。
 *
 * 隱私：只有「現在抽到的港口」面朝上公開；尚未抽的港口只在 module state 的 `pool`，不投影，
 * 也不在選邊前預先抽下一個。重新產生版圖（`regenerate`）由服務在全體真人同意後呼叫，不是玩家指令。
 */

import type { CommandOutcome, GameState, HarborType } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext } from '../types.ts';
import type { Rng } from '../../rng.ts';
import { topologyOf } from '../../analysis.ts';
import { NW_PORT_TOKENS, generateNewWorldBoard } from '../../seafarers-new-world-boards.ts';
import { seafarersState, seafarersView, type SeafarersState } from './state.ts';
import { separatedCoastEdges } from './tribe.ts';

export const WORLD_HARBOR_COMMAND = 'world.harbor' as const;

export interface WorldState {
  /** 尚未抽出的港口標記（只在伺服器，不投影）。 */
  pool: HarborType[];
  /** 現在抽到、等玩家放的港口（面朝上，公開）；港口階段結束後為 null。 */
  drawn: HarborType | null;
  /** 已放下的港口數。 */
  placed: number;
  /** 已重新產生版圖的次數。 */
  rerolls: number;
}

export const isNewWorld = (ctx: ModuleViewContext): boolean => ctx.profile.scenario === 'new-world';

/** 現在的港口階段是否進行中。 */
export function harborPhase(state: GameState): boolean {
  return state.turn.phase === 'setup' && state.turn.setup?.stage === 'harbor' && !!seafarersView(state).world;
}

/** 玩家選邊的合法位置（與目前抽到的港口種類無關）。 */
export function worldHarborEdges(state: GameState): number[] {
  return harborPhase(state) ? separatedCoastEdges(state) : [];
}

function draw(world: WorldState, rng: Rng): void {
  world.drawn = world.pool.splice(rng.int(world.pool.length), 1)[0]!;
}

/** 開始（或重新開始）港口階段：港口標記全部回到池子，抽出第一個，由起始玩家先放。 */
function startHarbors(state: GameState, world: WorldState, ctx: ModuleContext): void {
  world.pool = NW_PORT_TOKENS.slice();
  world.placed = 0;
  draw(world, ctx.rng);
  const setup = state.turn.setup!;
  setup.stage = 'harbor';
  state.turn.seat = setup.order[0]!;
  ctx.kit.emit(state, 'world.harborDrawn', { playerId: state.players[state.turn.seat]!.id, harbor: world.drawn });
}

/** 開局：建立狀態並進入港口階段。 */
export function initWorld(state: GameState, ctx: ModuleContext, slot: SeafarersState): void {
  const world: WorldState = { pool: [], drawn: null, placed: 0, rerolls: 0 };
  slot.world = world;
  startHarbors(state, world, ctx);
}

/** 放完一個之後：換下一位抽下一個；放完 10 個或沒有合法邊就結束港口階段。 */
function advance(state: GameState, world: WorldState, ctx: ModuleContext): void {
  const setup = state.turn.setup!;
  const legal = separatedCoastEdges(state).length > 0;
  if (world.pool.length === 0 || !legal) {
    if (world.pool.length > 0) ctx.kit.emit(state, 'world.harborsSkipped', { remaining: world.pool.length });
    world.pool = [];
    world.drawn = null;
    setup.stage = 'building';
    state.turn.seat = setup.order[0]!;
    return;
  }
  draw(world, ctx.rng);
  state.turn.seat = state.players[world.placed % state.players.length]!.seat;
  ctx.kit.emit(state, 'world.harborDrawn', { playerId: state.players[state.turn.seat]!.id, harbor: world.drawn });
}

/** `world.harbor { edge }` — 把目前抽到的港口放到合法的邊。 */
export function placeWorldHarbor(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const world = seafarersView(state).world;
  if (!world) return kit.fail('E_INVALID_COMMAND');
  if (!harborPhase(state) || world.drawn === null) return kit.fail('E_WRONG_PHASE');
  if (state.players[state.turn.seat]!.id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
  const { edge } = command;
  if (typeof edge !== 'number' || !Number.isInteger(edge)) return kit.fail('E_INVALID_COMMAND');
  if (!worldHarborEdges(state).includes(edge)) return kit.fail('E_ILLEGAL_TARGET', { edge });
  const slotWorld = seafarersState(state).world!;
  const harbor = slotWorld.drawn!;
  state.board.layout.harbors.push({ edge, type: harbor });
  slotWorld.placed += 1;
  slotWorld.drawn = null;
  kit.emit(state, 'world.harborPlaced', { playerId: actorId, edge, harbor });
  advance(state, slotWorld, ctx);
  return kit.accept(state);
}

/** 只有第一個港口放下之前可以重新產生版圖。 */
export function canRegenerate(state: GameState): boolean {
  const world = seafarersView(state).world;
  return !!world && harborPhase(state) && world.placed === 0;
}

/**
 * 重新產生版圖（全體真人同意後由服務呼叫）：地形、圓片、島編號全部重抽，港口標記回到池子重抽。
 * 強盜與海盜的位置（框上）與起始玩家不變。
 */
export function regenerateWorld(state: GameState, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const slot = seafarersState(state);
  if (!slot.world) return kit.fail('E_INVALID_COMMAND');
  if (!canRegenerate(state)) return kit.fail('E_WRONG_PHASE');
  const board = generateNewWorldBoard(topologyOf(state), ctx.rng);
  const layout = state.board.layout;
  layout.terrain = board.terrain;
  layout.numbers = board.numbers;
  layout.islands = board.islands;
  slot.world.rerolls += 1;
  kit.emit(state, 'world.regenerated', { count: slot.world.rerolls });
  startHarbors(state, slot.world, ctx);
  return kit.accept(state);
}

/** 公開狀態：現在抽到的港口、已放數量與是否還能重新產生；尚未抽的港口不投影。 */
export function projectWorld(world: WorldState, state: GameState) {
  return {
    drawn: world.drawn,
    placed: world.placed,
    total: NW_PORT_TOKENS.length,
    rerolls: world.rerolls,
    canRegenerate: canRegenerate(state),
  };
}

/** 動作提示：輪到的玩家看到目前的港口與可選的邊；其他人只有 `world` 的公開欄位。 */
export function worldHints(state: GameState, playerId: string) {
  const world = seafarersView(state).world!;
  const mine = harborPhase(state) && world.drawn !== null && state.players[state.turn.seat]!.id === playerId;
  const edges = mine ? worldHarborEdges(state) : [];
  return {
    harborChoices: { harbors: mine && world.drawn ? [world.drawn] : [], edges },
    targets: edges.length > 0 ? { [WORLD_HARBOR_COMMAND]: edges } : ({} as Record<string, number[]>),
    board: edges.length > 0
      ? { kind: 'edge' as const, commandType: WORLD_HARBOR_COMMAND, labelId: 'sf.world.harbor', targets: edges }
      : null,
  };
}
