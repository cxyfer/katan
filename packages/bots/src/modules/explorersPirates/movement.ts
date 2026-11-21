/**
 * E&P 的 Movement 子階段（計畫 §4.2、§4.3、§4.5；E2）。`phase` 只在 `H.phase === 'movement'` 時接管，
 * 一律以 hints 為合法性來源（P2）；多步路線由 `route.ts` 規劃，每次只送一個指令，下一次再從新 view 重算。
 *
 * 順序：擱淺（保底的脫困）→ 結清報價 → 免費動作（`found`、`load`）→ 沿最佳航程走一步 → `turn.end`。
 * 同一回合改移另一艘船會結束目前那艘，所以 active 船只要還有航程就先走完。
 */

import { EP_EXTRA_MP } from '@katan/rules';
import { PIP_VALUE, resourceWeights, settlementSpotValue } from '../../economy.ts';
import { playerYield } from '../../board.ts';
import { offersAwaitingMe, ownOpenOffers } from '../../trade.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { explorersPiratesDuty } from './duty.ts';
import { exploreValue } from './explore.ts';
import { foundVertices, fogAtEnds, type EpGeometry } from './geometry.ts';
import { remainingTiles } from './inventory.ts';
import { activeMissions, type MissionKind } from './missions/index.ts';
import { geometryOf } from './plans.ts';
import { reachableEdges, routeWorld, type RoutePath, type RouteWorld } from './route.ts';
import { activeShip, epHints, epPlayer, epView, woolOf, type EpHints, type EpShipHints, type EpShipView } from './view.ts';

/** 規劃航程的 MP 視野（一個回合 4 + 2 + 2，再看遠一點讓船朝目標前進）。 */
const HORIZON = 12;
/** 每多走一步的折扣。 */
const STEP_DISCOUNT = 0.85;
/** 值得為它買 extra move 的最低航程價值。 */
const EXTRA_MIN_VALUE = 0.4;
/** 前往已放著 settler 的 harbour 取貨。 */
const FETCH_VALUE = 0.9;
/** 付過路費的條件：繞開要多走至少這麼多步（standard，付完還要留 1 金）。 */
const TRIBUTE_DETOUR = 2;
/** 起始島上的定居點打折：產能與起始聚落重疊、也最擠；standard 寧可先探索新島。 */
const START_ISLAND_FACTOR = 0.6;

export interface Voyage {
  readonly ship: string;
  /** 終點邊（探索邊、可定居邊或取貨邊）。 */
  readonly edge: number;
  /** 依序經過的邊，第一個是下一步。 */
  readonly path: readonly number[];
  readonly kind: 'found' | 'explore' | 'fetch' | MissionKind;
  readonly value: number;
  readonly score: number;
}

/** 規劃航程所需的一次性資料；`spot` 為定居點的價值（勝利分當量）。 */
export interface Fleet {
  readonly turn: TurnContext;
  readonly g: EpGeometry;
  readonly me: string;
  readonly standard: boolean;
  readonly remaining: ReturnType<typeof remainingTiles>;
  readonly spot: (vertex: number) => number;
}

export function fleetOf(turn: TurnContext, g: EpGeometry): Fleet {
  const { model, ctx } = turn;
  const weights = resourceWeights(model);
  const mine = playerYield(model, ctx.selfId, true);
  const memo = new Map<number, number>();
  const standard = turn.level !== 'easy';
  return {
    turn,
    g,
    me: ctx.selfId,
    standard,
    remaining: remainingTiles(g),
    spot: (vertex) => {
      let value = memo.get(vertex);
      if (value === undefined) {
        value = 1 + PIP_VALUE * settlementSpotValue(model, vertex, weights, mine);
        if (standard && g.topo.vertices[vertex]!.hexes.some((hex) => g.ep.startIsland.includes(hex))) value *= START_ISLAND_FACTOR;
        memo.set(vertex, value);
      }
      return value;
    },
  };
}

/** 船上有 settler 且還有 plain 供應可以定居。 */
function settlerAboard(f: Fleet, ship: EpShipView): boolean {
  return ship.cargo.includes('settler') && (epPlayer(f.g.ep, f.me)?.supply.settlements ?? 0) > 0;
}

/** 空船要去載 settler 的 harbour 邊。 */
function fetchEdges(f: Fleet, ship: EpShipView): ReadonlySet<number> {
  const out = new Set<number>();
  if (ship.cargo.length > 0) return out;
  for (const harbor of f.g.ep.harbors) {
    if (harbor.player !== f.me || !harbor.cargo.includes('settler')) continue;
    for (const edge of f.g.topo.vertices[harbor.vertex]!.edges) out.add(edge);
  }
  return out;
}

/** 船此刻就能定居的路口（船已在可定居的邊上）。 */
export function foundHere(f: Fleet, ship: EpShipView): number[] {
  return settlerAboard(f, ship) ? foundVertices(f.g, ship.edge, f.me) : [];
}

/**
 * 一艘船從現在的位置出發的航程，依分數由高到低（同分保留 BFS 順序）。`left` 是這回合還有的 MP；
 * 易主的過路費只在標準難度付（easy 以 0 金規劃，繞路或停下）。
 */
export function voyagesOf(f: Fleet, ship: EpShipView, left: number, paid: boolean): Voyage[] {
  const world = routeWorld(f.g, ship.id);
  if (!world) return [];
  const gold = f.standard ? (epPlayer(f.g.ep, f.me)?.gold ?? 0) : 0;
  const settler = settlerAboard(f, ship);
  const fetch = fetchEdges(f, ship);
  const missions = activeMissions(f).map((mission) => mission.targets(f, ship));
  const out: Voyage[] = [];
  for (const [edge, route] of routesOf(f, world, ship, Math.max(left, HORIZON), paid, gold)) {
    let kind: Voyage['kind'] | null = null;
    let value = 0;
    if (settler) {
      const sites = foundVertices(f.g, edge, f.me);
      if (sites.length > 0) {
        kind = 'found';
        value = Math.max(...sites.map(f.spot));
      }
    }
    if (kind === null) {
      for (const targets of missions) {
        const target = targets.get(edge);
        if (target && target.value > value) {
          kind = target.kind;
          value = target.value;
        }
      }
    }
    if (kind === null && fogAtEnds(f.g, edge).length > 0) {
      value = exploreValue(f.g, f.remaining, edge, { settler, standard: f.standard });
      kind = 'explore';
    }
    if (kind === null && fetch.has(edge)) {
      kind = 'fetch';
      value = FETCH_VALUE;
    }
    if (kind === null || value <= 0) continue;
    out.push({ ship: ship.id, edge, path: route.edges, kind, value, score: value * STEP_DISCOUNT ** route.mp });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * 可到達的邊與路徑。預設不付過路費；standard 在有海盜、付完仍留 ≥ 1 金時，只有繞開要多走 ≥ 2 步
 * （或根本繞不開）的目標才付（§4.3）。easy 的 `gold` 是 0，永遠不付。
 */
function routesOf(f: Fleet, world: RouteWorld, ship: EpShipView, left: number, paid: boolean, gold: number): ReadonlyMap<number, RoutePath> {
  if (paid || !f.g.ep.pirate) return reachableEdges(world, ship.edge, left, paid, gold);
  const free = reachableEdges(world, ship.edge, left, paid, 0);
  if (gold < 2) return free;
  const out = new Map(free);
  for (const [edge, route] of reachableEdges(world, ship.edge, left, paid, gold)) {
    const around = free.get(edge);
    if (!around || around.mp - route.mp >= TRIBUTE_DETOUR) out.set(edge, route);
  }
  return out;
}

/** 這艘船有航程可走，或已經在可定居的位置（`endWindow` 判斷要不要進 Movement）。 */
export function hasWork(f: Fleet, ship: EpShipView, left: number, paid: boolean): boolean {
  return (
    foundHere(f, ship).length > 0 ||
    fetchEdges(f, ship).has(ship.edge) ||
    activeMissions(f).some((mission) => mission.here(f, ship)) ||
    chaseReady(f, ship) ||
    voyagesOf(f, ship, left, paid).length > 0
  );
}

/**
 * 這艘船能不能追逐海盜（比照 rules `canChase`）：海盜屬於別人、船的端點碰到海盜格的角，而且本回合還沒移動也沒追過。
 * Action 子階段用它決定是否進入 Movement；Movement 中以 `H.ships[i].chase` 為準。
 */
export function chaseReady(f: Fleet, ship: EpShipView): boolean {
  const pirate = f.g.ep.pirate;
  if (!pirate || pirate.owner === ship.player) return false;
  const record = f.g.ep.turn.ships[ship.id];
  if (record && (record.used > 0 || record.chased)) return false;
  const ends = f.g.topo.edges[ship.edge]?.vertices ?? [];
  return ends.some((vertex) => f.g.topo.vertices[vertex]?.hexes.includes(pirate.hex) ?? false);
}

function trade(turn: TurnContext): BotCommand | null {
  const { view, ctx } = turn;
  // Movement 不能開價或結算，只留撤回與拒絕（規則 vetoCommand）；進入 Movement 前報價已結清。
  const own = ownOpenOffers(view, ctx.selfId)[0];
  if (own) return { type: 'trade.withdraw', offerId: own.id };
  const awaiting = offersAwaitingMe(view, ctx.selfId)[0];
  return awaiting ? { type: 'trade.respond', offerId: awaiting.id, response: 'declined' } : null;
}

/**
 * 免費動作：定居（+1 分）與在 harbour 載 settler。standard 在這艘船另有更好的航程（例如先探索新島）時不急著
 * 在眼前的點定居；`best` 是各船最佳航程的分數。
 */
function freeAction(f: Fleet, hints: EpHints, best: ReadonlyMap<string, number>): BotCommand | null {
  const ep = f.g.ep;
  for (const info of hints.ships) {
    if (info.found.length === 0) continue;
    const vertex = info.found.slice().sort((a, b) => f.spot(b) - f.spot(a) || a - b)[0]!;
    if (f.standard && (best.get(info.id) ?? 0) > f.spot(vertex)) continue;
    return { type: 'ep.found', ship: info.id, vertex };
  }
  for (const info of hints.ships) {
    const ship = ep.ships.find((entry) => entry.id === info.id);
    if (!ship || ship.cargo.length > 0) continue;
    const harbor = ep.harbors.find((entry) => info.harbors.includes(entry.vertex) && entry.cargo.includes('settler'));
    if (harbor) return { type: 'ep.load', ship: info.id, harbor: harbor.vertex, piece: 'settler' };
  }
  return null;
}

/** 這艘船能走的航程：第一步必須在 hints 的 `steps` 內（P2）。 */
function executable(voyages: readonly Voyage[], info: EpShipHints): Voyage[] {
  return voyages.filter((voyage) => info.steps.some((step) => step.edge === voyage.path[0]));
}

export function epMovement(turn: TurnContext): BotCommand | null | undefined {
  const { view, ctx } = turn;
  const hints = epHints(view.hints);
  if (!hints || hints.phase !== 'movement') return undefined;
  // 0. 擱淺：下一個指令一定是 active 船的安全步（保底的脫困順序，§4.5）。
  if (hints.stranded) return explorersPiratesDuty(view, ctx.selfId) ?? null;
  const settled = trade(turn);
  if (settled) return settled;
  const ep = epView(view);
  const g = ep ? geometryOf(turn) : undefined;
  if (!ep || !g) return { type: 'turn.end' };
  const fleet = fleetOf(turn, g);
  // 能動的船與它們可執行的航程。
  const candidates = hints.ships
    .filter((info) => !info.done && info.movesLeft > 0 && info.steps.length > 0)
    .map((info) => {
      const ship = ep.ships.find((entry) => entry.id === info.id)!;
      const paid = ep.turn.ships[info.id]?.tribute ?? false;
      return { info, ship, voyages: executable(voyagesOf(fleet, ship, info.movesLeft, paid), info) };
    });
  // 追海盜是免費的、而且要在船移動之前（easy 一律追；standard 同樣有利無害，擲不中不損失）。
  const chaser = hints.ships.find((info) => info.chase && !info.done);
  if (chaser) return { type: 'ep.chase', ship: chaser.id };
  const free = freeAction(fleet, hints, new Map(candidates.map((entry) => [entry.info.id, entry.voyages[0]?.score ?? 0])));
  if (free) return free;
  for (const mission of activeMissions(fleet)) {
    const action = mission.free(fleet, hints);
    if (action) return action;
  }

  // active 船先走完；其餘依最佳航程分數。
  const active = activeShip(ep)?.id;
  const ready = candidates
    .filter((entry) => entry.voyages.length > 0)
    .sort((a, b) => Number(b.info.id === active) - Number(a.info.id === active) || b.voyages[0]!.score - a.voyages[0]!.score);
  const chosen = ready[0];
  if (!chosen) return { type: 'turn.end' };
  const { info, ship } = chosen;
  // easy 只在船還沒動時從前 3 名挑（之後沿同一條路，避免來回）；standard 取最佳。
  const fresh = (ep.turn.ships[info.id]?.used ?? 0) === 0;
  const scored: Scored<Voyage>[] = chosen.voyages.slice(0, 3).map((item) => ({ item, score: item.score }));
  const voyage = fleet.standard || !fresh ? chosen.voyages[0]! : (turn.pick(scored) ?? chosen.voyages[0]!);

  // extra move（standard）：差 1–2 步就能到、航程有價值，而且不動用計畫保留的羊毛。
  const short = voyage.path.length - info.movesLeft;
  if (fleet.standard && !info.extra && short > 0 && short <= EP_EXTRA_MP && voyage.value >= EXTRA_MIN_VALUE) {
    const reserved = turn.economy.plans[0]?.cost.wool ?? 0;
    if (woolOf(view, ctx.selfId) - 1 >= reserved) return { type: 'ep.extraMove', ship: ship.id };
  }
  return { type: 'ep.moveShip', ship: ship.id, edge: voyage.path[0]! };
}
