/**
 * The Wonders of Catan（卡坦奇觀，SF25 pp. 18–19）：奇觀牌與施工。
 *
 * - 五張奇觀牌（SF25 p. 1 Components 的牌面）做成資料表 `WONDERS`：名稱、施工條件與每層費用都在
 *   表裡，規則碼只解釋條件欄位（`marker`、`cities`、`score`、`portCities`、`route`），不寫死某張牌。
 * - 認領（`wonder.choose`）：條件成立時拿走該牌放在自己面前；別人從此不能再拿或蓋這座奇觀，每人只能拿 1 座。
 *   條件只在認領時檢查，之後失去條件不影響施工。
 * - 施工（`wonder.build`）：付牌上費用，第一次付費把 wonder marker 放在 1，之後每付一次前進一層；
 *   四層每層同樣的 5 張資源，一回合可蓋任意層，第 4 層完成。
 * - 奇觀歸屬與層數全部公開；wonder marker 與 VP 標記是兩個獨立的庫存（VP 標記見 `islands.ts`）。
 * - 勝利（`wonderCause`）：自己的回合完成第 4 層，或達到目標分且完成層數嚴格多於其他每位玩家。
 */

import { longestRouteLength, playerById, scoreOf, topologyOf } from '../../analysis.ts';
import { wonderMarkerVertices, type WonderMarkerKind } from '../../seafarers-scenario-boards.ts';
import type { CommandOutcome, GameEndCause, GameState, Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext } from '../types.ts';
import { actionWindowGuard } from './ships.ts';
import { seafarersState, seafarersView, type SeafarersState } from './state.ts';

export const WONDER_IDS = ['greatWall', 'greatBridge', 'grandTheater', 'grandCastle', 'grandMonument'] as const;
export type WonderId = (typeof WONDER_IDS)[number];

/** 每座奇觀的層數；marker 到第 4 層就完成。 */
export const WONDER_LEVELS = 4;

/** 認領奇觀的條件；列出的欄位全部成立才算（SF25 p. 1 牌面）。 */
export interface WonderCondition {
  /** 自己的村落或城市在這種標記的交叉點上。 */
  marker?: Exclude<WonderMarkerKind, 'x'>;
  /** 自己至少有這麼多座城市。 */
  cities?: number;
  /** 自己的分數至少這麼多（含自己未公開的分數牌）。 */
  score?: number;
  /** 自己至少有這麼多座位在港口交叉點上的城市。 */
  portCities?: number;
  /** 自己的路／船連續（同最長貿易路線的連續規則）至少這麼多條。 */
  route?: number;
}

export interface WonderDef {
  id: WonderId;
  condition: WonderCondition;
  /** 每一層的費用（四層相同）。 */
  cost: Partial<Record<Resource, number>>;
}

/** 五張奇觀牌（SF25 p. 1；牌面逐張核對見 work record）。 */
export const WONDERS: readonly WonderDef[] = [
  { id: 'greatWall', condition: { marker: 'greatWall' }, cost: { brick: 3, lumber: 1, grain: 1 } },
  { id: 'greatBridge', condition: { marker: 'greatBridge' }, cost: { lumber: 3, wool: 1, grain: 1 } },
  { id: 'grandTheater', condition: { cities: 2 }, cost: { wool: 3, brick: 1, lumber: 1 } },
  { id: 'grandCastle', condition: { cities: 1, score: 6 }, cost: { ore: 3, brick: 1, grain: 1 } },
  { id: 'grandMonument', condition: { portCities: 1, route: 5 }, cost: { grain: 3, ore: 2 } },
];

export interface WondersState {
  /** 地圖上的標記（交叉點索引）：Great Wall、Great Bridge 與設置禁設點 X。 */
  markers: Record<WonderMarkerKind, number[]>;
  /** 各玩家認領的奇觀；沒有為 null。 */
  owned: Record<string, WonderId | null>;
  /** 各玩家已完成的層數（0–4）；wonder marker 在第幾格。 */
  levels: Record<string, number>;
}

export const isWondersOfCatan = (ctx: ModuleViewContext): boolean => ctx.profile.scenario === 'wonders-of-catan';

export function wonderDef(id: string): WonderDef | undefined {
  return WONDERS.find((wonder) => wonder.id === id);
}

/** 開局：標記位置、每人沒有奇觀、marker 都在 0（尚未開始）。 */
export function initWonders(state: GameState, slot: SeafarersState): void {
  slot.wonders = {
    markers: wonderMarkerVertices(topologyOf(state)),
    owned: Object.fromEntries(state.players.map((player) => [player.id, null])),
    levels: Object.fromEntries(state.players.map((player) => [player.id, 0])),
  };
}

/** 設置禁設點：Great Bridge、Great Wall 與 X 標記的交叉點（只限起始村落，SF25 p. 18）。 */
export function isSetupForbidden(state: GameState, vertex: number): boolean {
  const markers = seafarersView(state).wonders?.markers;
  if (!markers) return false;
  return markers.greatWall.includes(vertex) || markers.greatBridge.includes(vertex) || markers.x.includes(vertex);
}

/** 目前持有這座奇觀的玩家。 */
export function wonderHolder(wonders: WondersState, id: WonderId): string | null {
  return Object.keys(wonders.owned).find((playerId) => wonders.owned[playerId] === id) ?? null;
}

/** 玩家完成的層數。 */
export function wonderLevel(state: GameState, playerId: string): number {
  return seafarersView(state).wonders?.levels[playerId] ?? 0;
}

function buildingsOf(state: GameState, playerId: string): { vertex: number; city: boolean }[] {
  const out: { vertex: number; city: boolean }[] = [];
  state.board.buildings.forEach((building, vertex) => {
    if (building?.player === playerId) out.push({ vertex, city: building.city });
  });
  return out;
}

/** 這位玩家現在是否符合牌上的施工條件。 */
export function wonderRequirementMet(state: GameState, playerId: string, def: WonderDef, ctx: ModuleViewContext): boolean {
  const wonders = seafarersView(state).wonders;
  if (!wonders) return false;
  const condition = def.condition;
  const buildings = buildingsOf(state, playerId);
  if (condition.marker && !buildings.some((building) => wonders.markers[condition.marker!].includes(building.vertex))) return false;
  const cities = buildings.filter((building) => building.city);
  if (condition.cities !== undefined && cities.length < condition.cities) return false;
  if (condition.score !== undefined && scoreOf(state, playerId, { includeHidden: true }) < condition.score) return false;
  if (condition.portCities !== undefined) {
    const topo = topologyOf(state);
    const portVertices = new Set<number>();
    for (const harbor of state.board.layout.harbors) for (const vertex of topo.edges[harbor.edge]?.vertices ?? []) portVertices.add(vertex);
    if (cities.filter((city) => portVertices.has(city.vertex)).length < condition.portCities) return false;
  }
  if (condition.route !== undefined && longestRouteLength(state, playerId, ctx.profile.longestRouteIncludesShips) < condition.route) return false;
  return true;
}

/** 現在可以認領的奇觀（尚未持有奇觀、沒被別人拿走、條件成立）。 */
export function claimableWonders(state: GameState, playerId: string, ctx: ModuleViewContext): WonderId[] {
  const wonders = seafarersView(state).wonders;
  if (!wonders || wonders.owned[playerId]) return [];
  return WONDERS.filter((def) => wonderHolder(wonders, def.id) === null && wonderRequirementMet(state, playerId, def, ctx)).map((def) => def.id);
}

/** 下一層要付的費用；沒有奇觀或已完成時為 null。 */
export function nextLevelCost(state: GameState, playerId: string): Partial<Record<Resource, number>> | null {
  const wonders = seafarersView(state).wonders;
  const id = wonders?.owned[playerId];
  if (!wonders || !id || (wonders.levels[playerId] ?? 0) >= WONDER_LEVELS) return null;
  return wonderDef(id)?.cost ?? null;
}

/**
 * 勝利判定（只對目前行動者）：完成自己的奇觀，或達到目標分且完成層數比其他每位玩家都高。
 * 回傳終局原因；沒有達成回傳 null（取代一般的「達到目標分」判定）。
 */
export function wonderCause(state: GameState, playerId: string, score: number, ctx: ModuleViewContext): GameEndCause | null {
  const wonders = seafarersView(state).wonders;
  if (!wonders) return null;
  const own = wonders.levels[playerId] ?? 0;
  if (own >= WONDER_LEVELS) return 'wonderComplete';
  if (score < ctx.profile.victoryTarget || own <= 0) return null;
  const others = Object.entries(wonders.levels).filter(([id]) => id !== playerId).map(([, level]) => level);
  return others.every((level) => own > level) ? 'wonderLead' : null;
}

/** 公開狀態：標記、各玩家的奇觀與層數。 */
export function projectWonders(wonders: WondersState) {
  return {
    markers: { greatWall: wonders.markers.greatWall.slice(), greatBridge: wonders.markers.greatBridge.slice(), x: wonders.markers.x.slice() },
    owned: { ...wonders.owned },
    levels: { ...wonders.levels },
  };
}

/** 其他劇本送來 `wonder.*` 的回應與未知指令一致：有 pending 是 E_PENDING_EFFECT，沒有是 E_INVALID_COMMAND。 */
function notWonders(state: GameState, ctx: ModuleContext): CommandOutcome {
  return state.pending ? ctx.kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind }) : ctx.kit.fail('E_INVALID_COMMAND');
}

/** `wonder.choose { wonder }` — 條件成立時認領一座奇觀（免費；施工另付費）。 */
export function chooseWonder(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const wonders = seafarersState(state).wonders;
  if (!wonders) return notWonders(state, ctx);
  if (state.pending) return kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  const guard = actionWindowGuard(state, actorId, ctx);
  if (guard) return guard;
  const def = typeof command.wonder === 'string' ? wonderDef(command.wonder) : undefined;
  if (!def) return kit.fail('E_INVALID_COMMAND');
  if (wonders.owned[actorId]) return kit.fail('E_WONDER_HELD', { wonder: wonders.owned[actorId] });
  if (wonderHolder(wonders, def.id)) return kit.fail('E_WONDER_TAKEN', { wonder: def.id });
  if (!wonderRequirementMet(state, actorId, def, ctx)) return kit.fail('E_WONDER_REQUIREMENT', { wonder: def.id });
  wonders.owned[actorId] = def.id;
  kit.emit(state, 'wonder.chosen', { playerId: actorId, wonder: def.id });
  return kit.accept(state);
}

/** `wonder.build {}` — 付一層的費用，marker 前進一格；第 4 層完成。 */
export function buildWonder(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const wonders = seafarersState(state).wonders;
  if (!wonders) return notWonders(state, ctx);
  if (state.pending) return kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  const guard = actionWindowGuard(state, actorId, ctx);
  if (guard) return guard;
  const id = wonders.owned[actorId];
  const def = id ? wonderDef(id) : undefined;
  if (!def) return kit.fail('E_WONDER_NOT_CHOSEN');
  const level = wonders.levels[actorId] ?? 0;
  if (level >= WONDER_LEVELS) return kit.fail('E_WONDER_COMPLETE', { wonder: def.id });
  const player = playerById(state, actorId)!;
  if (!kit.canAfford(player, def.cost)) return kit.fail('E_INSUFFICIENT_RESOURCES', { cost: def.cost });
  kit.payBuild(state, player, def.cost);
  wonders.levels[actorId] = level + 1;
  kit.emit(state, 'wonder.built', { playerId: actorId, wonder: def.id, level: level + 1 });
  kit.checkVictory(state);
  return kit.accept(state);
}
