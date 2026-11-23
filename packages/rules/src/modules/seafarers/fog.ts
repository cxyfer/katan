/**
 * 未知海域的探索（SF25 p. 8，spec §6.3）。
 *
 * 12 個空格在 layout 存成沒有數字的海；`SeafarersState.fog` 記哪些格還沒翻開，以及
 * 剩餘板塊與圓片的多重集。**建造**路或船、使這條邊的任一端點碰到空格時發現新位置：
 * 只有一個空格就直接翻開；同時碰到多個，放置者選一個（`seafarers.fog` frame，
 * 指令 `fog.choose`）。翻開時以 `ctx.rng` 從剩餘板塊抽 1：陸地再抽 1 枚圓片，
 * 探索者拿 1 張該格資源（供應堆沒有就拿不到）；金礦由探索者自選一種（沿用
 * `seafarers.gold` frame）；海洋沒有圓片也沒有資源。村落與移動船不觸發
 * （移動船由 profile 的 `fogOnMove` 旗標開關，預設關）。設置階段放的路與船也不翻開。
 */

import { playerById, topologyOf } from '../../analysis.ts';
import { fogIslandsMap, FOG_TILES, type FogTile } from '../../seafarers-fog-islands-boards.ts';
import { addResource, playerStats } from '../../stats.ts';
import type { CommandOutcome, GameState, ModulePending, Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext, PublicModulePendingView } from '../types.ts';
import { enqueueGold } from './gold.ts';
import { seafarersState, seafarersView, type FogState } from './state.ts';

export const FOG_FRAME = 'seafarers.fog' as const;

interface FogFrameData {
  /** 放置者可選的空格（建立 frame 時碰到的空格）。 */
  hexes: number[];
}

/** 板塊抽取順序固定，同一個 rng 才能重現同一次抽取。 */
const TILE_ORDER: readonly FogTile[] = ['sea', 'gold', 'fields', 'hills', 'mountains', 'pasture', 'forest'];

const TILE_RESOURCE: Partial<Record<FogTile, Resource>> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
};

/** 劇本是未知海域時建立牌庫；空格座標轉成 hex 索引。 */
export function initialFog(state: GameState, ctx: ModuleViewContext): FogState | undefined {
  if (ctx.profile.scenario !== 'fog-islands') return undefined;
  const map = fogIslandsMap(state.players.length);
  const topo = topologyOf(state);
  const hexes = map.fog.map((cell) => topo.hexes.findIndex((hex) => hex.q === cell.q && hex.r === cell.r));
  if (hexes.some((hex) => hex < 0)) throw new Error('fog islands: fog cell outside the topology');
  return { hexes, tiles: { ...FOG_TILES }, discs: map.discs.slice() };
}

export function isFogHex(state: GameState, hex: number): boolean {
  // 唯讀：提示與投影也會呼叫，不能順手滾動動作視窗。
  return seafarersView(state).fog?.hexes.includes(hex) ?? false;
}

/** 這條邊兩個端點碰到的空格（升冪、不重複）。 */
export function fogHexesAtEdge(state: GameState, edge: number): number[] {
  const fog = seafarersView(state).fog;
  if (!fog || fog.hexes.length === 0) return [];
  const topo = topologyOf(state);
  const info = topo.edges[edge];
  if (!info) return [];
  const out = new Set<number>();
  for (const vertex of info.vertices) {
    for (const hex of topo.vertices[vertex]?.hexes ?? []) if (fog.hexes.includes(hex)) out.add(hex);
  }
  return [...out].sort((a, b) => a - b);
}

function drawTile(fog: FogState, ctx: ModuleContext): FogTile {
  const total = TILE_ORDER.reduce((sum, tile) => sum + (fog.tiles[tile] ?? 0), 0);
  if (total <= 0) throw new Error('fog islands: the face-down hexes ran out');
  let pick = ctx.rng.int(total);
  for (const tile of TILE_ORDER) {
    const n = fog.tiles[tile] ?? 0;
    if (pick < n) {
      fog.tiles[tile] = n - 1;
      return tile;
    }
    pick -= n;
  }
  throw new Error('unreachable');
}

/** 翻開一個空格並發放探索獎勵（翻開後的板塊與圓片是公開資訊）。 */
export function revealFog(state: GameState, hex: number, playerId: string, ctx: ModuleContext): void {
  const fog = seafarersState(state).fog;
  const at = fog ? fog.hexes.indexOf(hex) : -1;
  if (!fog || at < 0) return;
  fog.hexes.splice(at, 1);
  const tile = drawTile(fog, ctx);
  const layout = state.board.layout;
  const params: Record<string, unknown> = { playerId, hex, tile };
  if (tile !== 'sea') {
    layout.terrain[hex] = tile;
    const number = fog.discs.splice(ctx.rng.int(fog.discs.length), 1)[0]!;
    layout.numbers[hex] = number;
    params.number = number;
    const resource = TILE_RESOURCE[tile];
    if (resource && state.bank[resource] > 0) {
      state.bank[resource] -= 1;
      playerById(state, playerId)!.resources[resource] += 1;
      addResource(playerStats(state, playerId).produced, resource, 1);
      params.resource = resource;
    }
  }
  ctx.kit.emit(state, 'fog.revealed', params);
  // 金礦：探索者自選一種；供應堆空了由 frame 跳過。
  if (tile === 'gold') enqueueGold(state, { [playerId]: 1 }, [playerId], ctx, true);
}

/**
 * 放置的路或船（或旗標開啟時移動的船）之後：碰到一個空格就翻開，多個就請放置者選。
 * 沒有未知海域的劇本沒有 `fog` 狀態，直接略過。
 */
export function exploreAtEdge(state: GameState, playerId: string, edge: number, ctx: ModuleContext): void {
  const hexes = fogHexesAtEdge(state, edge);
  if (hexes.length === 0) return;
  if (hexes.length === 1) {
    revealFog(state, hexes[0]!, playerId, ctx);
    return;
  }
  const frame: ModulePending = { kind: FOG_FRAME, module: 'seafarers', responders: [playerId], data: { hexes } };
  ctx.kit.enqueuePending(state, frame);
}

/**
 * 排在別的 frame 後面時（築路卡的兩艘船），其間可能已有空格被翻開：濾掉已翻開的；
 * 沒有候選就直接結束，只剩一個就沒有選擇可做，直接翻開它。
 */
export function activateFog(state: GameState, frame: ModulePending, ctx: ModuleContext): void {
  const data = frame.data as unknown as FogFrameData;
  data.hexes = data.hexes.filter((hex) => isFogHex(state, hex));
  if (data.hexes.length === 1) revealFog(state, data.hexes[0]!, frame.responders[0]!, ctx);
  if (data.hexes.length <= 1) ctx.kit.completePending(state, ctx.rng);
}

/** `fog.choose { hex }` — 放置者從碰到的空格中選一個翻開。 */
export function chooseFog(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  // 只有未知海域有這個指令；其他劇本（New Shores）要與送出一個未知指令時一致：
  // 有 pending frame 時被閘門擋下（E_PENDING_EFFECT），沒有時是 E_INVALID_COMMAND。
  if (!seafarersView(state).fog) {
    return state.pending ? kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind }) : kit.fail('E_INVALID_COMMAND');
  }
  const frame = state.pending;
  if (!frame || frame.kind !== FOG_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  const pending = frame as ModulePending;
  if (!pending.responders.includes(actorId)) return kit.fail('E_NOT_ACTOR');
  const hex = command.hex;
  const data = pending.data as unknown as FogFrameData;
  if (typeof hex !== 'number' || !Number.isInteger(hex) || !data.hexes.includes(hex) || !isFogHex(state, hex)) {
    return kit.fail('E_ILLEGAL_TARGET', { hex });
  }
  // 先翻開（金礦 frame 排在這個 frame 之後），再結束它：下一個 frame 啟用時已看得到剛翻開的格，
  // 排在後面的 fog frame 會濾掉它。
  revealFog(state, hex, actorId, ctx);
  kit.completePending(state, ctx.rng);
  return kit.accept(state);
}

/** 選擇的空格是公開資訊（圖上本來就是空的）。 */
export function projectFogFrame(state: GameState, frame: ModulePending): PublicModulePendingView {
  const data = frame.data as unknown as FogFrameData;
  return {
    kind: frame.kind,
    module: frame.module,
    responders: frame.responders.slice(),
    data: { hexes: data.hexes.filter((hex) => isFogHex(state, hex)) },
  };
}
