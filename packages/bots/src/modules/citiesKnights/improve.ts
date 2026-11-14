/**
 * C&K 的城市改良（C&K 計畫 §4.3 改良、§4.4）：選主軌道、估每一級的價值，以及大都市的放置點。
 *
 * - 第 n 級要 n 張該軌道的 commodity；3 級得到能力（science 的 aqueduct、trade 的 2:1、politics 的 3 級騎士），
 *   4 級可以取走大都市（+2 VP、免疫掠奪），5 級可以從 4 級持有者手上搶走。
 * - 主軌道 = 自己最容易付得起的那一軌：長期產能（含城市）加上手上已有的 commodity，已經投資的軌道再加一點慣性；
 *   對手在這軌道已經領先 2 級以上且擁有大都市時降權（打不過）。其他軌道只升到 3 級（取得能力、提高抽卡率）。
 * - 買不了的軌道不當主軌道、也不產生項目：滿級（`max-level`），或下一級會拿大都市、但每座城市都已有大都市
 *   （`no-site`，rules 會拒絕那個指令，所以不能當成一般改良估值）。全部買不了時沒有項目，`mainTrack` 仍回傳一軌供選牌堆等用途。
 * - easy：永遠只升持有 commodity 最多的那一軌（D-CK3、§4.4）。
 * - 價值的單位是勝利分當量，與 base 的計畫同尺度（`1 + PIP_VALUE × 點數`）；常數是未經對局調校的起點。
 *
 * 全部只讀公開資訊（自己的手牌、各玩家的改良等級、大都市）；合法性由 `hints.modules.citiesKnights.improvements` 把關，
 * 這裡只在 `planStep` 取它的 `sites` 與 `blocked`。
 */

import {
  CK_ABILITY_LEVEL,
  CK_MAX_LEVEL,
  CK_METROPOLIS_LEVEL,
  CK_PERMANENT_METROPOLIS_LEVEL,
  CK_TRACKS,
  CK_TRACK_COMMODITY,
  type CkTrack,
  type Commodity,
} from '@catan/rules';
import { playerYield, type BoardModel } from '../../board.ts';
import type { BotLevel } from '../../types.ts';
import { ckView } from './view.ts';

/** 價值常數（勝利分當量）。 */
export const IMPROVE_VALUE = {
  /** 每一級的基本價值（抽卡機率、已投入的 commodity 不白費）。 */
  level: 0.25,
  /** 3 級能力。 */
  ability: { science: 0.45, trade: 0.7, politics: 0.55 },
  /** 大都市：+2 VP，另加免疫掠奪的好處。 */
  metropolis: 2.3,
  /** 從其他軌道的最高等級折算：非主軌道超過 3 級的價值打折。 */
  sideBeyondAbility: 0.2,
  /** 主軌道朝 4 級前進時，每一級分得的大都市價值比例（L / 10：1+2+3+4 = 10 張）。 */
  shareDenominator: 10,
} as const;

export interface TrackOption {
  readonly track: CkTrack;
  readonly commodity: Commodity;
  /** 下一級（要買的那一級）與費用（張數）。 */
  readonly level: number;
  readonly cost: number;
  /** 買下去會拿到大都市。 */
  readonly metropolis: boolean;
  /** 勝利分當量。 */
  readonly value: number;
  readonly main: boolean;
}

function selfOf(model: BoardModel) {
  return model.view.players.find((player) => player.id === model.selfId);
}

/** 自己有城市（改良的前提）。 */
export function hasCity(model: BoardModel): boolean {
  return model.view.board.buildings.some((building) => building?.city && building.player === model.selfId);
}

/** 買下第 `next` 級會拿到大都市嗎（與 rules 的 `awardsMetropolis` 相同）。 */
export function awardsMetropolis(model: BoardModel, track: CkTrack, next: number): boolean {
  if (next < CK_METROPOLIS_LEVEL) return false;
  const holder = ckView(model.view)?.metropolises?.[track];
  if (!holder) return true;
  if (holder.player === model.selfId) return false;
  if (next !== CK_PERMANENT_METROPOLIS_LEVEL) return false;
  const level = model.view.players.find((player) => player.id === holder.player)?.improvements?.[track] ?? 0;
  return level < CK_PERMANENT_METROPOLIS_LEVEL;
}

/**
 * 有城市、但每一座都已經有大都市（rules 的 `no-site`，優先序在 `no-city` 之後）：會拿到大都市的那一級改良會被擋下。
 * 沒有任何城市（例如被掠奪降級）是 `no-city`，不算在內；那是暫時的，不該改變選軌道的結果。
 */
export function lacksMetropolisSite(model: BoardModel): boolean {
  const metropolises = ckView(model.view)?.metropolises;
  const taken = new Set<number>();
  for (const track of CK_TRACKS) {
    const vertex = metropolises?.[track]?.vertex;
    if (typeof vertex === 'number') taken.add(vertex);
  }
  let cities = 0;
  for (const [vertex, building] of model.view.board.buildings.entries()) {
    if (!building?.city || building.player !== model.selfId) continue;
    if (!taken.has(vertex)) return false;
    cities += 1;
  }
  return cities > 0;
}

/** 對手在這軌道已經領先到我們追不上：擁有大都市而且至少高 2 級。 */
function outClassed(model: BoardModel, track: CkTrack): boolean {
  const holder = ckView(model.view)?.metropolises?.[track];
  if (!holder || holder.player === model.selfId) return false;
  const mine = selfOf(model)?.improvements?.[track] ?? 0;
  const theirs = model.view.players.find((player) => player.id === holder.player)?.improvements?.[track] ?? 0;
  return theirs >= mine + 2 && theirs >= CK_PERMANENT_METROPOLIS_LEVEL - 1;
}

/** 這軌道的 commodity 長期產能（含城市）加上手上已有的張數。 */
function supply(model: BoardModel, track: CkTrack): number {
  const commodity = CK_TRACK_COMMODITY[track];
  const production = playerYield(model, model.selfId, true)[commodity] ?? 0;
  const held = selfOf(model)?.commodities?.[commodity] ?? 0;
  return production + held * 0.5;
}

/**
 * 下一級現在能不能買（不看手牌）：沒有滿級，而且不是「會拿大都市、卻沒有可放的城市」（rules 的 `max-level`、
 * `no-site`）。大都市點要掃一次建築，只有在這一級會拿大都市時才查，每次呼叫最多一次。
 */
function improvableCheck(model: BoardModel): (track: CkTrack) => boolean {
  const me = selfOf(model);
  let blocked: boolean | undefined;
  return (track) => {
    const next = (me?.improvements?.[track] ?? 0) + 1;
    if (next > CK_MAX_LEVEL) return false;
    if (!awardsMetropolis(model, track, next)) return true;
    blocked ??= lacksMetropolisSite(model);
    return !blocked;
  };
}

function pickMain(model: BoardModel, level: BotLevel, improvable: (track: CkTrack) => boolean): CkTrack {
  const me = selfOf(model);
  let best: CkTrack | null = null;
  let bestScore = -Infinity;
  // 沒有任何一軌能買時（全部滿級或沒有放大都市的城市），退回對全部軌道的評分，呼叫端仍拿得到一個軌道。
  let fallback: CkTrack = CK_TRACKS[0]!;
  let fallbackScore = -Infinity;
  for (const track of CK_TRACKS) {
    const commodity = CK_TRACK_COMMODITY[track];
    const invested = me?.improvements?.[track] ?? 0;
    const score =
      level === 'easy'
        ? (me?.commodities?.[commodity] ?? 0) + (playerYield(model, model.selfId, true)[commodity] ?? 0) * 0.01
        : supply(model, track) + invested * 1.2 - (outClassed(model, track) ? 4 : 0);
    if (score > fallbackScore) {
      fallbackScore = score;
      fallback = track;
    }
    if (score > bestScore && improvable(track)) {
      bestScore = score;
      best = track;
    }
  }
  return best ?? fallback;
}

/**
 * 主軌道：easy 看手上 commodity 最多的，standard 看產能、持有與已投入的等級。同分取排在前面的軌道。
 * 只在買得了下一級的軌道中挑（滿級、或下一級會拿大都市卻沒有可放的城市的軌道不當主軌道）；都買不了時退回全部軌道。
 */
export function mainTrack(model: BoardModel, level: BotLevel = 'standard'): CkTrack {
  return pickMain(model, level, improvableCheck(model));
}

/** 其他玩家在這軌道搶大都市的競爭：追上或超過自己下一級的對手越多，勝算越低。 */
function contest(model: BoardModel, track: CkTrack, next: number): number {
  let rivals = 0;
  for (const player of model.view.players) {
    if (player.id !== model.selfId && (player.improvements?.[track] ?? 0) >= next - 1) rivals += 1;
  }
  return Math.max(0.3, 1 - 0.25 * rivals);
}

/** 下一級的價值；主軌道額外分得大都市的期望價值。 */
function valueOf(model: BoardModel, track: CkTrack, next: number, main: boolean): number {
  let value = IMPROVE_VALUE.level;
  if (next === CK_ABILITY_LEVEL) value += IMPROVE_VALUE.ability[track];
  const awards = awardsMetropolis(model, track, next);
  const odds = contest(model, track, next);
  if (awards) value += IMPROVE_VALUE.metropolis * odds;
  else if (main && next < CK_METROPOLIS_LEVEL && !outClassed(model, track)) {
    value += IMPROVE_VALUE.metropolis * odds * (next / IMPROVE_VALUE.shareDenominator);
  }
  if (!main && next > CK_ABILITY_LEVEL && !awards) value *= IMPROVE_VALUE.sideBeyondAbility / IMPROVE_VALUE.level;
  return value;
}

/** 三條軌道的下一級；買不了的軌道（滿級，或下一級會拿大都市卻沒有可放的城市）沒有項目。 */
export function trackOptions(model: BoardModel, level: BotLevel = 'standard'): TrackOption[] {
  const me = selfOf(model);
  const improvable = improvableCheck(model);
  const main = pickMain(model, level, improvable);
  const out: TrackOption[] = [];
  for (const track of CK_TRACKS) {
    if (!improvable(track)) continue;
    const next = (me?.improvements?.[track] ?? 0) + 1;
    out.push({
      track,
      commodity: CK_TRACK_COMMODITY[track],
      level: next,
      cost: next,
      metropolis: awardsMetropolis(model, track, next),
      value: valueOf(model, track, next, track === main),
      main: track === main,
    });
  }
  return out;
}

/**
 * 要考慮的軌道：standard 取主軌道與其他軌道（3 級以內，或這一級能拿大都市）；easy 只有主軌道（持有最多的）。
 */
export function consideredOptions(model: BoardModel, level: BotLevel): TrackOption[] {
  const options = trackOptions(model, level);
  if (level === 'easy') return options.filter((option) => option.main);
  return options.filter((option) => option.main || option.level <= CK_ABILITY_LEVEL || option.metropolis);
}
