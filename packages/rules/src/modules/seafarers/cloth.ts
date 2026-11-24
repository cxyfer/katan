/**
 * Cloth for Catan（布匹產地，SF25 pp. 14–15）：部落與布匹標記。
 *
 * - 四座單格小島的上下兩個頂點各有一個部落（共 8 個，數字圓片 (11,8)、(10,9)、(4,5)、(6,3)）；
 *   每個部落開局放 5 枚布匹，另有 10 枚放在一般供應堆（共 50 枚）。
 * - 貿易關係：玩家從自己的村落或城市出發，沿自己的船（與路）連到部落所在的頂點時，建立與該部落的
 *   關係並立即從部落拿 1 枚布匹。每位玩家對每個部落只建立一次（他人已連不影響；多條通路只算一次）。
 *   連接在每次盤面變動（建造、移動船、設置）後重新判定，所以起始的船與移動船也會建立關係。
 * - 生產：擲出部落的數字，每位有關係的玩家各得 1 枚。部落不夠分時不足的部分從供應堆補；部落歸零後
 *   不再產出，也不從供應堆拿。生產在金礦（`afterProduction` 的其餘部分）之前結算。
 * - 每 2 枚布匹 1 分，餘數不計，全程計入（公開）。
 * - 封閉通路：從自己的建築沿自己的船／路到部落頂點的任一條簡單路徑上的邊，其中的船不可移動；
 *   延伸出去或分叉的船不在任何這樣的路徑上，照一般規則移動。
 * - 海盜：移動需要至少一條通到部落的通路；移動後可偷 1 張資源牌或 1 枚布匹（`cloth.steal`）。
 * - 回合結束時 ≥5 個部落沒有布匹則終局：最高分勝，平手比布匹數，仍平手共同勝利（D12，使用者決定的解釋）。
 *
 * 供應堆也不夠補時的順序（SF25 沒有規定）：依「擲骰者起、順時針」的次序逐位發，發完為止，
 * 領不到的玩家少拿，記在 `shortBy`。
 */

import { playerById, topologyOf } from '../../analysis.ts';
import { CFC_SMALL_ISLANDS, CFC_SUPPLY_CLOTH, CFC_TRIBES, CFC_TRIBE_CLOTH, tribeVertices } from '../../seafarers-scenario-boards.ts';
import type { CommandOutcome, GameState } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext, RollResult } from '../types.ts';
import { seafarersState, seafarersView, type SeafarersState } from './state.ts';

export interface ClothTribe {
  /** 部落所在的頂點。 */
  vertex: number;
  /** 部落圓片上的數字。 */
  number: number;
  /** 部落剩餘的布匹。 */
  cloth: number;
}

export interface ClothState {
  tribes: ClothTribe[];
  /** 一般供應堆的布匹。 */
  supply: number;
  /** 各玩家已建立關係的部落索引（依建立順序）。 */
  links: Record<string, number[]>;
  /** 各玩家持有的布匹。 */
  cloth: Record<string, number>;
}

/** 回合結束時，沒有布匹的部落達到這個數目就終局（SF25 p. 14）。 */
export const EXHAUSTED_TRIBES = 5;

export const isClothForCatan = (ctx: ModuleViewContext): boolean => ctx.profile.scenario === 'cloth-for-catan';

/** 開局：8 個部落各放 5 枚布匹，10 枚留在供應堆。 */
export function initCloth(state: GameState, slot: SeafarersState): void {
  const topology = topologyOf(state);
  const vertices = tribeVertices(topology);
  slot.cloth = {
    tribes: vertices.map((vertex, index) => ({ vertex, number: CFC_TRIBES[index]!.number, cloth: CFC_TRIBE_CLOTH })),
    supply: CFC_SUPPLY_CLOTH,
    links: Object.fromEntries(state.players.map((player) => [player.id, []])),
    cloth: Object.fromEntries(state.players.map((player) => [player.id, 0])),
  };
}

/** 玩家持有的布匹數（沒有布匹狀態時為 0）。 */
export function clothOf(state: GameState, playerId: string): number {
  return seafarersView(state).cloth?.cloth[playerId] ?? 0;
}

/** 布匹的分數：每 2 枚 1 分，餘數不計。 */
export function clothPoints(state: GameState, playerId: string): number {
  return Math.floor(clothOf(state, playerId) / 2);
}

/**
 * 從玩家的村落／城市沿自己的船與路走得到的路徑上的資訊：
 * `reached` 是可到達的部落索引，`closed` 是位在「建築 → 部落」簡單路徑上的邊。
 * 路徑不穿過別人的建築；部落頂點本身不能蓋房子，所以只可能是路徑的終點。
 */
export function tribeRoutes(state: GameState, playerId: string): { reached: number[]; closed: Set<number> } {
  const cloth = seafarersView(state).cloth;
  const closed = new Set<number>();
  if (!cloth) return { reached: [], closed };
  const topo = topologyOf(state);
  const own = (edge: number): boolean => { const road = state.board.roads[edge]; return !!road && road.ship && road.player === playerId; };
  const reached: number[] = [];

  cloth.tribes.forEach((tribe, index) => {
    // 從部落頂點往回走，遇到自己的建築就記下整條路徑上的邊。
    const visited = new Set<number>([tribe.vertex]);
    const path: number[] = [];
    let found = false;
    const walk = (vertex: number): void => {
      for (const edge of topo.vertices[vertex]!.edges) {
        if (!own(edge) || path.includes(edge)) continue;
        const info = topo.edges[edge]!;
        const next = info.vertices[0] === vertex ? info.vertices[1]! : info.vertices[0]!;
        if (visited.has(next)) continue;
        const building = state.board.buildings[next];
        path.push(edge);
        if (building?.player === playerId) {
          found = true;
          for (const used of path) closed.add(used);
        } else if (!building) {
          visited.add(next);
          walk(next);
          visited.delete(next);
        }
        path.pop();
      }
    };
    walk(tribe.vertex);
    if (found) reached.push(index);
  });
  return { reached, closed };
}

/** 玩家至少有一條通到部落的通路（移動海盜的條件）。 */
export function hasTribeRoute(state: GameState, playerId: string): boolean {
  return tribeRoutes(state, playerId).reached.length > 0;
}

/** 這條邊上的船在玩家通往部落的通路中，不可移動。 */
export function closedTribeShip(state: GameState, playerId: string, edge: number): boolean {
  if (!seafarersView(state).cloth) return false;
  return tribeRoutes(state, playerId).closed.has(edge);
}

/** 依回合順序（目前行動者起）排列的玩家 id。 */
function turnOrder(state: GameState): string[] {
  const count = state.players.length;
  return Array.from({ length: count }, (_, offset) => state.players[(state.turn.seat + offset) % count]!.id);
}

/**
 * 每次盤面變動後：新連上部落的玩家建立關係並從部落拿 1 枚（部落已空則只建立關係，拿不到）。
 */
export function establishTrade(state: GameState, ctx: ModuleContext): void {
  const cloth = seafarersState(state).cloth;
  if (!cloth) return;
  for (const playerId of turnOrder(state)) {
    const links = (cloth.links[playerId] ??= []);
    for (const index of tribeRoutes(state, playerId).reached) {
      if (links.includes(index)) continue;
      links.push(index);
      const tribe = cloth.tribes[index]!;
      const gained = tribe.cloth > 0 ? 1 : 0;
      tribe.cloth -= gained;
      cloth.cloth[playerId] = (cloth.cloth[playerId] ?? 0) + gained;
      ctx.kit.emit(state, 'cloth.trade', { playerId, tribe: index, number: tribe.number, gained });
    }
  }
}

/** 擲出部落數字時的布匹生產（在金礦之前結算）。有玩家拿到布匹時回傳 true（呼叫端接著判勝）。 */
export function produceCloth(state: GameState, roll: RollResult, ctx: ModuleContext): boolean {
  const cloth = seafarersState(state).cloth;
  if (!cloth || roll.total === 7) return false;
  let paid = false;
  cloth.tribes.forEach((tribe, index) => {
    if (tribe.number !== roll.total) return;
    // 歸零後不再產出，也不從供應堆拿。
    if (tribe.cloth <= 0) return;
    const takers = turnOrder(state).filter((id) => cloth.links[id]?.includes(index));
    if (takers.length === 0) return;
    const gains: Record<string, number> = {};
    let fromTribe = 0;
    let fromSupply = 0;
    let shortBy = 0;
    for (const id of takers) {
      if (tribe.cloth > 0) {
        tribe.cloth -= 1;
        fromTribe += 1;
      } else if (cloth.supply > 0) {
        cloth.supply -= 1;
        fromSupply += 1;
      } else {
        shortBy += 1;
        continue;
      }
      cloth.cloth[id] = (cloth.cloth[id] ?? 0) + 1;
      gains[id] = 1;
    }
    ctx.kit.emit(state, 'cloth.produced', { tribe: index, number: tribe.number, gains, fromTribe, fromSupply, shortBy });
    paid = paid || fromTribe + fromSupply > 0;
  });
  return paid;
}

/** 沒有布匹的部落數。 */
export function exhaustedTribes(state: GameState): number {
  return seafarersView(state).cloth?.tribes.filter((tribe) => tribe.cloth <= 0).length ?? 0;
}

/**
 * 回合結束時 ≥5 個部落沒有布匹：最高分勝，平手比布匹數，仍平手共同勝利（座位序）。
 * 回傳勝者 id；條件未成立回傳 null。分數含隱藏的分數牌（與目標分判定一致）。
 */
export function exhaustionWinners(state: GameState, scoreOf: (playerId: string) => number): string[] | null {
  if (exhaustedTribes(state) < EXHAUSTED_TRIBES) return null;
  const rows = state.players.map((player) => ({ id: player.id, score: scoreOf(player.id), cloth: clothOf(state, player.id) }));
  const top = Math.max(...rows.map((row) => row.score));
  const leaders = rows.filter((row) => row.score === top);
  const topCloth = Math.max(...leaders.map((row) => row.cloth));
  return leaders.filter((row) => row.cloth === topCloth).map((row) => row.id);
}

/** 小島（不可蓋村落、強盜不可進入）：島編號 2–5。 */
export function isSmallIslandHex(state: GameState, hex: number): boolean {
  return CFC_SMALL_ISLANDS.includes(state.board.layout.islands[hex] ?? 0);
}

/** 公開狀態：部落（頂點、數字、剩餘布匹）、供應堆、各玩家的布匹與關係。 */
export function projectCloth(cloth: ClothState) {
  return {
    tribes: cloth.tribes.map((tribe) => ({ ...tribe })),
    supply: cloth.supply,
    links: Object.fromEntries(Object.entries(cloth.links).map(([id, list]) => [id, list.slice()])),
    cloth: { ...cloth.cloth },
  };
}

/** 海盜移動後可以偷布匹的對象：候選人中有布匹的玩家。 */
export function clothVictims(state: GameState, candidates: readonly string[]): string[] {
  return candidates.filter((id) => clothOf(state, id) > 0);
}

/** `cloth.steal { victim }` — 移動海盜後偷 1 枚布匹（取代偷 1 張資源牌）。 */
export function stealCloth(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = state.pending;
  if (!frame || frame.kind !== 'steal') return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  if (frame.actor !== actorId) return kit.fail('E_NOT_ACTOR');
  const victim = command.victim;
  if (typeof victim !== 'string') return kit.fail('E_INVALID_COMMAND');
  if (!frame.pirate || !frame.candidates.includes(victim) || !playerById(state, victim)) return kit.fail('E_NO_ELIGIBLE_VICTIM', { victim });
  const cloth = seafarersState(state).cloth;
  if (!cloth || (cloth.cloth[victim] ?? 0) <= 0) return kit.fail('E_NO_ELIGIBLE_VICTIM', { victim });
  cloth.cloth[victim] = (cloth.cloth[victim] ?? 0) - 1;
  cloth.cloth[actorId] = (cloth.cloth[actorId] ?? 0) + 1;
  kit.completePending(state, ctx.rng);
  kit.emit(state, 'cloth.stolen', { playerId: actorId, victim });
  kit.checkVictory(state);
  return kit.accept(state);
}
