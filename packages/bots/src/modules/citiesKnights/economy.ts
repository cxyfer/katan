/**
 * C&K 的經濟鉤子（0.4.2 平台掛點；C&K 計畫 §4.5、§4.6）。骨架會把這些鉤子與其他模組組合：
 * - `cardKinds`：paper、cloth、coin。手牌、成本、ETA、估值、棄牌與規則 9 都依這份清單。
 * - `rates`：`hints.modules.citiesKnights.commodityRates`（已含 3:1 港口、貿易 3 級與 Merchant Fleet 的 2:1）。
 * - `weights`：commodity 的估值，與資源權重同尺度（0.8–1.3）。
 * - `costs`：騎士、升級、啟動、城牆、醫藥，以及三條軌道的下一級改良。
 * - `hexYield`：森林、牧場、山脈上的城市產 1 張資源加 1 張 commodity；其他地形（含 SF 的金礦）回 undefined。
 * - `vertexBlocker`、`siteBlocked`：騎士封路、騎士所在的點不能蓋建築。
 */

import {
  CK_ACTIVATE_COST,
  CK_KNIGHT_COST,
  CK_MAX_LEVEL,
  CK_MEDICINE_COST,
  CK_PROMOTE_COST,
  CK_TRACK_COMMODITY,
  CK_TRACKS,
  CK_WALL_COST,
  COMMODITIES,
  TERRAIN_COMMODITY,
  type CardKind,
  type Commodity,
  type Terrain,
} from '@catan/rules';
import type { BoardModel } from '../../board.ts';
import type { Cost } from '../../economy.ts';
import type { BotEconomyHooks } from '../types.ts';
import { ckHints, ckView } from './view.ts';

/** commodity 權重：基準、湊得齊下一級改良時的加成、差 1–2 張時的加成，與滿級軌道的固定值。 */
export const COMMODITY_WEIGHT = { base: 0.85, affordable: 0.45, near: 0.25, maxed: 0.5, min: 0.5, max: 1.3 } as const;

/** 自己目前的手牌與改良等級（公開資訊與自己的投影）。 */
function selfOf(model: BoardModel) {
  return model.view.players.find((player) => player.id === model.selfId);
}

/** 下一級改良的成本：第 n 級要 n 張該軌道的 commodity；滿級時沒有。 */
function nextImprovement(model: BoardModel, track: (typeof CK_TRACKS)[number]): { commodity: Commodity; cost: number } | null {
  const level = (selfOf(model)?.improvements?.[track] ?? 0) + 1;
  return level > CK_MAX_LEVEL ? null : { commodity: CK_TRACK_COMMODITY[track], cost: level };
}

function rates(model: BoardModel): Partial<Record<CardKind, number>> {
  const shown = ckHints(model.view.hints)?.commodityRates as Partial<Record<string, unknown>> | undefined;
  const out: Partial<Record<CardKind, number>> = {};
  for (const commodity of COMMODITIES) {
    const rate = shown?.[commodity];
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) out[commodity] = rate;
  }
  return out;
}

function weights(model: BoardModel): Partial<Record<CardKind, number>> {
  const me = selfOf(model);
  const out: Partial<Record<CardKind, number>> = {};
  for (const track of CK_TRACKS) {
    const commodity = CK_TRACK_COMMODITY[track];
    const next = nextImprovement(model, track);
    if (!next) {
      out[commodity] = COMMODITY_WEIGHT.maxed;
      continue;
    }
    const gap = next.cost - (me?.commodities?.[commodity] ?? 0);
    const bonus = gap <= 0 ? COMMODITY_WEIGHT.affordable : gap <= 2 ? COMMODITY_WEIGHT.near : 0;
    out[commodity] = Math.min(COMMODITY_WEIGHT.max, Math.max(COMMODITY_WEIGHT.min, COMMODITY_WEIGHT.base + bonus));
  }
  return out;
}

/** 具名成本；鍵不得與 base 的四個鍵（city、settlement、devCard、road）重複。 */
function costs(model: BoardModel): Readonly<Record<string, Cost>> {
  const out: Record<string, Cost> = {
    wall: CK_WALL_COST,
    knight: CK_KNIGHT_COST,
    promote: CK_PROMOTE_COST,
    activate: CK_ACTIVATE_COST,
    medicine: CK_MEDICINE_COST,
  };
  for (const track of CK_TRACKS) {
    const next = nextImprovement(model, track);
    if (next) out[`improve.${track}`] = { [next.commodity]: next.cost };
  }
  return out;
}

/** 城市在 `hex` 擲中時：森林、牧場、山脈各 1 張資源加 1 張 commodity；聚落與其他地形沿用 base。 */
function hexYield(model: BoardModel, hex: number, _vertex: number, city: boolean): Readonly<Partial<Record<CardKind, number>>> | undefined {
  if (!city) return undefined;
  const commodity = TERRAIN_COMMODITY[model.view.board.terrain[hex] as Terrain];
  const resource = model.hexResource[hex];
  return commodity && resource ? { [resource]: 1, [commodity]: 1 } : undefined;
}

/**
 * 騎士在路口的索引；以 view 的 `knights` 陣列為鍵快取，一次決策內只建一次。每次呼叫都讀傳入 model 的 view，
 * 所以展開後換了 view 的模型（假設盤面放了騎士）會讀到新的陣列、建新的索引。前提：投影的 `knights` 陣列
 * 不會被原地修改（每次投影都是新物件；假設盤面要換一個新陣列，不要改舊的）。
 */
const knightIndex = new WeakMap<object, ReadonlyMap<number, string>>();
const NO_KNIGHTS: ReadonlyMap<number, string> = new Map();

function knightsAt(model: BoardModel): ReadonlyMap<number, string> {
  const list = ckView(model.view)?.knights;
  if (!Array.isArray(list)) return NO_KNIGHTS;
  let index = knightIndex.get(list);
  if (!index) {
    index = new Map(list.map((knight) => [knight.vertex, knight.player]));
    knightIndex.set(list, index);
  }
  return index;
}

export const citiesKnightsEconomy: BotEconomyHooks = {
  costs,
  cardKinds: () => COMMODITIES,
  rates,
  weights,
  hexYield,
  vertexBlocker: (model, vertex) => knightsAt(model).get(vertex) ?? null,
  siteBlocked: (model, vertex) => knightsAt(model).has(vertex),
};
