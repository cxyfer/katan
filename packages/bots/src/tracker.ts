/**
 * 計牌模組（hard 規格 §6）：只根據自己座位投影過的事件歷史，推算每位對手可能的手牌、
 * 尚未現身的發展卡與隱藏分數。
 *
 * 純函式：只讀 `view`，不保留狀態、不使用亂數。刻意不讀 `view.bank`：比對前後快照的銀行
 * 存量可以推出棄牌內容，那是 SPEC §8.3 禁止的推導洩漏（#137），hard 不得利用。
 */

import {
  COSTS,
  RESOURCES,
  requireProfile,
  type DevCardType,
  type GameEvent,
  type GameView,
  type Resource,
} from '@catan/rules';
import { boardModel, playerYield } from './board.ts';

/** 每位對手最多保留的可能手牌數；超過時刪掉機率最低者。 */
export const MAX_WORLDS = 2000;

export type ResourceCount = Record<Resource, number>;

export interface HandWorld {
  readonly hand: Readonly<ResourceCount>;
  readonly p: number;
}

export interface HandBelief {
  readonly playerId: string;
  /** 推算的張數；歷史完整時等於公開的 `handSize`。 */
  readonly size: number;
  /** 可能的手牌與機率，依機率遞減、同機率依手牌排序；`consistent` 為 false 時為空。 */
  readonly worlds: readonly HandWorld[];
  readonly expected: Readonly<ResourceCount>;
  /** 每種可能都至少有的張數（確定持有）。 */
  readonly min: Readonly<ResourceCount>;
  readonly max: Readonly<ResourceCount>;
  /** 只剩一種可能。 */
  readonly exact: boolean;
  /**
   * 推算是否仍可信。false 表示歷史不完整、事件互相矛盾，或截斷刪掉了真實手牌：此時
   * `worlds` 為空，`expected` 改用產能比例估計。
   */
  readonly consistent: boolean;
}

export interface DevCardHolder {
  /** 手上未打出的發展卡張數（含本回合新買的）。 */
  readonly held: number;
  readonly bought: number;
  readonly played: Readonly<Partial<Record<DevCardType, number>>>;
  /** 手上分數卡的期望張數，也就是隱藏分數的期望值。 */
  readonly victoryPoints: number;
}

export interface DevCardBelief {
  /** 尚未現身的發展卡：牌庫加上對手手上未打出的牌，依類型。 */
  readonly unseen: Readonly<Record<DevCardType, number>>;
  readonly unseenTotal: number;
  /** 只有對手。 */
  readonly players: Readonly<Record<string, DevCardHolder>>;
}

export interface TableBelief {
  /** 歷史從 seq 1 連續到 `view.seq`、profile 沒有 rules module，且推算張數全部吻合。 */
  readonly complete: boolean;
  /** 只有對手。 */
  readonly hands: Readonly<Record<string, HandBelief>>;
  readonly dev: DevCardBelief;
}

// ---------------------------------------------------------------------------
// 手牌向量（依 RESOURCES 順序）
// ---------------------------------------------------------------------------

type Vec = number[];

const SIZE = RESOURCES.length;
const INDEX = new Map<string, number>(RESOURCES.map((resource, index) => [resource, index]));

function zero(): Vec {
  return new Array<number>(SIZE).fill(0);
}

function sum(vec: Vec): number {
  let total = 0;
  for (const value of vec) total += value;
  return total;
}

function keyOf(vec: Vec): string {
  return vec.join(',');
}

function toCount(vec: Vec): ResourceCount {
  const out = {} as ResourceCount;
  RESOURCES.forEach((resource, index) => {
    out[resource] = vec[index]!;
  });
  return out;
}

function unit(index: number): Vec {
  const vec = zero();
  vec[index] = 1;
  return vec;
}

function costVec(cost: Partial<Record<Resource, number>>): Vec {
  return RESOURCES.map((resource) => cost[resource] ?? 0);
}

const ROAD = costVec(COSTS.road);
const SETTLEMENT = costVec(COSTS.settlement);
const CITY = costVec(COSTS.city);
const DEV_CARD = costVec(COSTS.devCard);

/** 事件裡的資源張數表；有非資源鍵或非法數值時回傳 null（例如擴充的商品）。 */
function vecOf(value: unknown): Vec | null {
  if (value === undefined || value === null) return zero();
  if (typeof value !== 'object') return null;
  const vec = zero();
  for (const [name, amount] of Object.entries(value as Record<string, unknown>)) {
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return null;
    const index = INDEX.get(name);
    if (index === undefined) {
      if (amount === 0) continue;
      return null;
    }
    vec[index]! += amount;
  }
  return vec;
}

function resourceIndex(value: unknown): number | null {
  return typeof value === 'string' ? (INDEX.get(value) ?? null) : null;
}

const binomials: number[][] = [];
function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  binomials[n] ??= [];
  const row = binomials[n]!;
  if (row[k] === undefined) {
    let value = 1;
    for (let i = 1; i <= k; i++) value = (value * (n - k + i)) / i;
    row[k] = value;
  }
  return row[k]!;
}

// ---------------------------------------------------------------------------
// 單一對手的可能手牌集合
// ---------------------------------------------------------------------------

interface World {
  h: Vec;
  w: number;
}

class HandTrack {
  size = 0;
  consistent = true;
  private worlds = new Map<string, World>([[keyOf(zero()), { h: zero(), w: 1 }]]);

  /** 已知張數的增減；`delta` 可以有負值（例如交易）。付不起的可能手牌一併刪除。 */
  shift(delta: Vec): void {
    this.size += sum(delta);
    if (!this.consistent) return;
    const next = new Map<string, World>();
    for (const world of this.worlds.values()) {
      const h = world.h.map((value, index) => value + delta[index]!);
      if (h.some((value) => value < 0)) continue;
      next.set(keyOf(h), { h, w: world.w });
    }
    this.replace(next);
  }

  gain(delta: Vec): void {
    this.shift(delta);
  }

  spend(cost: Vec): void {
    this.shift(cost.map((value) => -value));
  }

  /** 壟斷：這位玩家的某資源原本恰好有 `count` 張，全部被拿走。 */
  takeAll(index: number, count: number): void {
    this.size -= count;
    if (!this.consistent) return;
    const next = new Map<string, World>();
    for (const world of this.worlds.values()) {
      if (world.h[index] !== count) continue;
      const h = world.h.slice();
      h[index] = 0;
      next.set(keyOf(h), { h, w: world.w });
    }
    this.replace(next);
  }

  /**
   * 隨機（或不知選擇）少掉 `count` 張：依多變量超幾何分布展開。回傳被拿走的各資源期望
   * 比例（只在 `count` 為 1 時有意義，供小偷使用）。
   */
  removeUnknown(count: number, prior: Vec): Vec {
    const before = this.size;
    this.size -= count;
    if (!this.consistent || before <= 0) return prior;
    const taken = zero();
    const next = new Map<string, World>();
    const removed = zero();
    for (const world of this.worlds.values()) {
      const total = sum(world.h);
      const ways = binom(total, count);
      if (ways === 0) continue;
      const visit = (index: number, left: number, weight: number): void => {
        if (index === SIZE - 1) {
          if (left > world.h[index]!) return;
          removed[index] = left;
          const p = (world.w * weight * binom(world.h[index]!, left)) / ways;
          const h = world.h.map((value, i) => value - removed[i]!);
          const key = keyOf(h);
          const existing = next.get(key);
          if (existing) existing.w += p;
          else next.set(key, { h, w: p });
          for (let i = 0; i < SIZE; i++) taken[i]! += (p * removed[i]!) / count;
          return;
        }
        const max = Math.min(world.h[index]!, left);
        for (let k = 0; k <= max; k++) {
          removed[index] = k;
          visit(index + 1, left - k, weight * binom(world.h[index]!, k));
        }
      };
      visit(0, count, 1);
    }
    this.replace(next);
    if (!this.consistent) return prior;
    return taken;
  }

  /** 多一張類型依 `odds` 分布的牌（不知牌面的偷牌）。 */
  gainUnknown(odds: Vec): void {
    this.size += 1;
    if (!this.consistent) return;
    const next = new Map<string, World>();
    for (const world of this.worlds.values()) {
      for (let index = 0; index < SIZE; index++) {
        const chance = odds[index]!;
        if (chance <= 0) continue;
        const h = world.h.slice();
        h[index]! += 1;
        const key = keyOf(h);
        const existing = next.get(key);
        if (existing) existing.w += world.w * chance;
        else next.set(key, { h, w: world.w * chance });
      }
    }
    this.replace(next);
  }

  markInconsistent(): void {
    this.consistent = false;
    this.worlds.clear();
  }

  /** 正規化、截斷到上限；全部被刪光代表推算不再可信。 */
  private replace(next: Map<string, World>): void {
    let total = 0;
    for (const world of next.values()) total += world.w;
    if (next.size === 0 || !(total > 0)) {
      this.markInconsistent();
      return;
    }
    let entries = [...next.entries()];
    if (entries.length > MAX_WORLDS) {
      entries.sort(([ka, a], [kb, b]) => b.w - a.w || (ka < kb ? -1 : ka > kb ? 1 : 0));
      entries = entries.slice(0, MAX_WORLDS);
      total = entries.reduce((acc, [, world]) => acc + world.w, 0);
    }
    this.worlds = new Map(entries.map(([key, world]) => [key, { h: world.h, w: world.w / total }]));
  }

  belief(playerId: string, prior: Vec): HandBelief {
    if (!this.consistent || this.size < 0) {
      const size = Math.max(0, this.size);
      return {
        playerId,
        size,
        worlds: [],
        expected: toCount(prior.map((share) => share * size)),
        min: toCount(zero()),
        max: toCount(zero().map(() => size)),
        exact: false,
        consistent: false,
      };
    }
    const entries = [...this.worlds.entries()].sort(
      ([ka, a], [kb, b]) => b.w - a.w || (ka < kb ? -1 : ka > kb ? 1 : 0),
    );
    const expected = zero();
    const min = zero().map(() => Infinity);
    const max = zero();
    for (const [, world] of entries) {
      for (let index = 0; index < SIZE; index++) {
        const value = world.h[index]!;
        expected[index]! += value * world.w;
        min[index] = Math.min(min[index]!, value);
        max[index] = Math.max(max[index]!, value);
      }
    }
    return {
      playerId,
      size: this.size,
      worlds: entries.map(([, world]) => ({ hand: toCount(world.h), p: world.w })),
      expected: toCount(expected),
      min: toCount(min),
      max: toCount(max),
      exact: entries.length === 1,
      consistent: true,
    };
  }
}

// ---------------------------------------------------------------------------
// 整桌推算
// ---------------------------------------------------------------------------

const PLAYED_EVENT: Readonly<Record<string, DevCardType>> = {
  'dev.knight': 'knight',
  'dev.roadBuilding': 'roadBuilding',
  'dev.yearOfPlenty': 'yearOfPlenty',
  'dev.monopoly': 'monopoly',
};

const DEV_TYPES: readonly DevCardType[] = [
  'knight',
  'victoryPoint',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
  'barbarianKnight',
  'swiftJourney',
];

function emptyDevCounts(): Record<DevCardType, number> {
  const out = {} as Record<DevCardType, number>;
  for (const type of DEV_TYPES) out[type] = 0;
  return out;
}

/** 歷史是否從 seq 1 連續到 `view.seq`。 */
export function historyComplete(view: Pick<GameView, 'events' | 'seq'>): boolean {
  const events = view.events;
  if (events.length === 0 || events[0]!.seq !== 1) return false;
  for (let index = 1; index < events.length; index++) {
    if (events[index]!.seq !== events[index - 1]!.seq + 1) return false;
  }
  return events[events.length - 1]!.seq === view.seq;
}

/** 產能比例：推算不可信時用來估計手牌組成。 */
function productionShares(view: GameView, selfId: string, playerId: string): Vec {
  const production = playerYield(boardModel(view, selfId), playerId, true);
  const vec = RESOURCES.map((resource) => production[resource] + 0.5);
  const total = sum(vec);
  return vec.map((value) => value / total);
}

export function trackTable(view: GameView, selfId: string): TableBelief {
  const opponents = view.players.filter((player) => player.id !== selfId);
  const tracks = new Map<string, HandTrack>(opponents.map((player) => [player.id, new HandTrack()]));
  const priors = new Map<string, Vec>(opponents.map((player) => [player.id, productionShares(view, selfId, player.id)]));
  const bought = new Map<string, number>(view.players.map((player) => [player.id, 0]));
  const played = new Map<string, Partial<Record<DevCardType, number>>>(view.players.map((player) => [player.id, {}]));

  const base = requireProfile(view.profileId).ruleModules.length === 0;
  let complete = base && historyComplete(view);

  if (complete) {
    for (const event of view.events) {
      if (!applyEvent(event, tracks, priors, bought, played)) {
        complete = false;
        break;
      }
    }
  }

  // 任何一位的張數不吻合，代表歷史有缺漏或矛盾：整桌標成不完整，所有對手都退回產能估計，
  // 避免半套推算。
  if (complete && opponents.some((player) => tracks.get(player.id)!.size !== player.handSize)) complete = false;
  const hands: Record<string, HandBelief> = {};
  for (const player of opponents) {
    const track = tracks.get(player.id)!;
    if (!complete) {
      track.markInconsistent();
      track.size = player.handSize;
    }
    hands[player.id] = track.belief(player.id, priors.get(player.id)!);
  }

  return { complete, hands, dev: devBelief(view, selfId, bought, played) };
}

/** 套用一筆事件；格式無法理解時回傳 false（整桌改標不完整）。 */
function applyEvent(
  event: GameEvent,
  tracks: Map<string, HandTrack>,
  priors: Map<string, Vec>,
  bought: Map<string, number>,
  played: Map<string, Partial<Record<DevCardType, number>>>,
): boolean {
  const params = event.params;
  const actor = typeof params.playerId === 'string' ? params.playerId : null;
  const track = actor ? tracks.get(actor) : undefined;
  switch (event.type) {
    case 'setup.startingResources': {
      const gained = vecOf(params.resources);
      if (!gained) return false;
      track?.gain(gained);
      return true;
    }
    case 'production.resolved': {
      const grants = params.grants;
      if (typeof grants !== 'object' || grants === null) return false;
      for (const [playerId, resources] of Object.entries(grants as Record<string, unknown>)) {
        const gained = vecOf(resources);
        if (!gained) return false;
        tracks.get(playerId)?.gain(gained);
      }
      return true;
    }
    case 'build.road':
      if (params.free !== true) track?.spend(ROAD);
      return true;
    case 'build.settlement':
      track?.spend(SETTLEMENT);
      return true;
    case 'build.city':
      track?.spend(CITY);
      return true;
    case 'build.devCard':
      if (actor) bought.set(actor, (bought.get(actor) ?? 0) + 1);
      track?.spend(DEV_CARD);
      return true;
    case 'trade.bank': {
      const give = resourceIndex(params.give);
      const receive = resourceIndex(params.receive);
      const rate = params.rate;
      if (give === null || receive === null || typeof rate !== 'number') return false;
      const delta = zero();
      delta[give]! -= rate;
      delta[receive]! += 1;
      track?.shift(delta);
      return true;
    }
    case 'trade.completed': {
      const give = vecOf(params.give);
      const want = vecOf(params.want);
      if (!give || !want || params.giveGoods || params.wantGoods) return false;
      const from = typeof params.from === 'string' ? tracks.get(params.from) : undefined;
      const to = typeof params.to === 'string' ? tracks.get(params.to) : undefined;
      from?.shift(want.map((value, index) => value - give[index]!));
      to?.shift(give.map((value, index) => value - want[index]!));
      return true;
    }
    case 'dev.yearOfPlentyPick': {
      const index = resourceIndex(params.resource);
      if (index === null) return false;
      track?.gain(unit(index));
      return true;
    }
    case 'dev.monopoly': {
      const index = resourceIndex(params.resource);
      const taken = params.taken;
      if (index === null || typeof taken !== 'object' || taken === null || !actor) return false;
      recordPlay(played, actor, 'monopoly');
      let total = 0;
      for (const [playerId, other] of tracks) {
        if (playerId === actor) continue;
        const amount = (taken as Record<string, unknown>)[playerId] ?? 0;
        if (typeof amount !== 'number') return false;
        other.takeAll(index, amount);
      }
      for (const amount of Object.values(taken as Record<string, unknown>)) {
        if (typeof amount !== 'number') return false;
        total += amount;
      }
      const gained = zero();
      gained[index] = total;
      track?.gain(gained);
      return true;
    }
    case 'dev.knight':
    case 'dev.roadBuilding':
    case 'dev.yearOfPlenty':
      if (actor) recordPlay(played, actor, PLAYED_EVENT[event.type]!);
      return true;
    case 'robber.stole': {
      const victimId = typeof params.victim === 'string' ? params.victim : null;
      if (!actor || !victimId) return false;
      const thief = tracks.get(actor);
      const victim = tracks.get(victimId);
      const known = resourceIndex(params.resource);
      if (params.resource !== undefined && known === null) return false;
      if (known !== null) {
        // 自己是小偷或受害者：牌面已知。
        victim?.spend(unit(known));
        thief?.gain(unit(known));
        return true;
      }
      const odds = victim ? victim.removeUnknown(1, priors.get(victimId)!) : priors.get(victimId) ?? uniform();
      thief?.gainUnknown(odds);
      return true;
    }
    case 'discard.submitted': {
      const count = params.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return false;
      if (track) track.removeUnknown(count, priors.get(actor!)!);
      return true;
    }
    default:
      return true;
  }
}

function uniform(): Vec {
  return zero().map(() => 1 / SIZE);
}

function recordPlay(played: Map<string, Partial<Record<DevCardType, number>>>, playerId: string, type: DevCardType): void {
  const counts = played.get(playerId);
  if (counts) counts[type] = (counts[type] ?? 0) + 1;
}

function devBelief(
  view: GameView,
  selfId: string,
  bought: Map<string, number>,
  played: Map<string, Partial<Record<DevCardType, number>>>,
): DevCardBelief {
  const unseen = emptyDevCounts();
  for (const card of requireProfile(view.profileId).devDeck) unseen[card] += 1;
  const me = view.players.find((player) => player.id === selfId);
  for (const card of [...(me?.devCards ?? []), ...(me?.newDevCards ?? [])]) {
    if (card in unseen) unseen[card as DevCardType] -= 1;
  }
  for (const player of view.players) {
    const counts = played.get(player.id) ?? {};
    // 騎士用公開的 `playedKnights`，即使歷史不完整也正確；其他卡只能從事件得知。
    unseen.knight -= player.playedKnights;
    for (const type of DEV_TYPES) {
      if (type === 'knight') continue;
      unseen[type] -= counts[type] ?? 0;
    }
  }
  for (const type of DEV_TYPES) unseen[type] = Math.max(0, unseen[type]);
  const unseenTotal = DEV_TYPES.reduce((acc, type) => acc + unseen[type], 0);
  const players: Record<string, DevCardHolder> = {};
  for (const player of view.players) {
    if (player.id === selfId) continue;
    const held = player.devCardCount + player.newDevCardCount;
    const counts = { ...(played.get(player.id) ?? {}) };
    counts.knight = player.playedKnights;
    players[player.id] = {
      held,
      bought: bought.get(player.id) ?? 0,
      played: counts,
      victoryPoints: unseenTotal > 0 ? (held * unseen.victoryPoint) / unseenTotal : 0,
    };
  }
  return { unseen, unseenTotal, players };
}
