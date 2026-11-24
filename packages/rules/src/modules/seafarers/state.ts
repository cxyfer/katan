/** Seafarers module state (`GameState.moduleState.seafarers`). */

import type { GameState } from '../../types.ts';
import type { ClothState } from './cloth.ts';
import type { TribeState } from './tribe.ts';
import { moduleStateOf, setModuleState } from '../state.ts';

export const SEAFARERS = 'seafarers';

export interface SeafarersState {
  /** Action window (`GameState.windowId`) that `built` and `moved` belong to. */
  window: number;
  /** Ships built in that window; they may not move in it (SF25 p. 2). */
  built: number[];
  /** Whether that window's one ship move has been used. */
  moved: boolean;
  /** Small islands each player has already received the +2 VP for. */
  islands: Record<string, number[]>;
  /** Where each bonus was earned: the settlement that holds the VP tokens. */
  claims: IslandClaim[];
  /**
   * 各玩家的 home islands（設置階段村落碰到的島）。只有島嶼獎勵排除 home 的劇本
   * （four-islands、new-world）會在設置結束時寫入；其他劇本沒有此欄位，摘要不變。
   */
  home?: Record<string, number[]>;
  /** 未知海域（fog-islands）：尚未翻開的空格與剩餘牌庫；其他劇本沒有此欄位，摘要不變。 */
  fog?: FogState;
  /** 世外部落（forgotten-tribe）的禮物、VP 標記與暫存港口；其他劇本沒有此欄位。 */
  tribe?: TribeState;
  /** 布匹產地（cloth-for-catan）的部落、供應堆、布匹與貿易關係；其他劇本沒有此欄位。 */
  cloth?: ClothState;
}

/**
 * 未知海域的狀態。`hexes` 是尚未翻開的空格（公開：圖上就是空的）；`tiles` 與 `discs`
 * 是剩餘板塊與圓片的**多重集**（只在伺服器，不投影）。沒有任何「某一格底下是什麼」的
 * 記錄，翻開時才以 `ctx.rng` 抽出，所以翻開前沒有東西可洩漏（做法同 E&P 的探索）。
 */
export interface FogState {
  hexes: number[];
  /** 剩餘未知板塊數（依 `FogTile` 計數）。 */
  tiles: Partial<Record<string, number>>;
  /** 剩餘未知圓片，升冪，每枚一個元素。 */
  discs: number[];
}

export interface IslandClaim {
  player: string;
  island: number;
  vertex: number;
}

export function initialSeafarersState(state: GameState): SeafarersState {
  return {
    window: state.windowId,
    built: [],
    moved: false,
    islands: Object.fromEntries(state.players.map((player) => [player.id, []])),
    claims: [],
  };
}

/** The module slot, rolled over to the current action window. */
export function seafarersState(state: GameState): SeafarersState {
  const slot = moduleStateOf<SeafarersState>(state, SEAFARERS) ?? setModuleState(state, SEAFARERS, initialSeafarersState(state));
  if (slot.window !== state.windowId) {
    slot.window = state.windowId;
    slot.built = [];
    slot.moved = false;
  }
  return slot;
}

/** Read-only view for projections: stale windows read as empty. */
export function seafarersView(state: GameState): SeafarersState {
  const slot = moduleStateOf<SeafarersState>(state, SEAFARERS) ?? initialSeafarersState(state);
  if (slot.window === state.windowId) return slot;
  return { ...slot, window: state.windowId, built: [], moved: false };
}
