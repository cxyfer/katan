/**
 * 海盜巢穴任務（計畫 §4.3、§4.6；E3）：造 crew、載到巢穴、`ep.dropCrew`。
 *
 * 目標過濾：巢穴尚未攻下且 crew 少於 3。價值以 `EP_LAIR_TOKENS` 估金礦：揭曉的數字均勻抽自這幾個，
 * 平均點數乘以 2 金的產出。easy 不看價值（一律 1，近的先去），也不規劃 hero。
 */

import { EP_CARGO_SIZE, EP_HOLD_CAPACITY, EP_LAIR_TOKENS, type EpCargo } from '@katan/rules';
import { PIP_VALUE } from '../../../economy.ts';
import type { BotCommand } from '../../types.ts';
import { isSeaRoute, type EpGeometry } from '../geometry.ts';
import type { Fleet } from '../movement.ts';
import { epPlayer, type EpHints, type EpShipView, type EpView } from '../view.ts';
import { farmsToCrew } from './tracks.ts';
import type { Mission, MissionTarget } from './index.ts';

type LairSite = Extract<EpView['sites'][number], { kind: 'lair' }>;

/** 巢穴需要的 crew 數（第三個 crew 攻下）。 */
const CREWS_NEEDED = 3;
/** 同時帶在身上、尚未上岸的 crew 上限。 */
const UNLANDED_MAX = 3;
const MEAN_PIPS = EP_LAIR_TOKENS.reduce((sum, n) => sum + (6 - Math.abs(7 - n)), 0) / EP_LAIR_TOKENS.length;
const LAIR_VALUE = 1;
/** 攻下後金礦每次產 2 金，以點數當量計。 */
const FIELD_VALUE = MEAN_PIPS * PIP_VALUE * 2;
/** 差一個就攻下：多拿 2 金與軌道進度。 */
const CAPTURE_BONUS = 0.5;
const FETCH_VALUE = 0.9;
const PICK_VALUE = 0.8;

export const openLairs = (ep: EpView): LairSite[] =>
  ep.sites.filter((site): site is LairSite => site.kind === 'lair' && !site.captured && site.crews.length < CREWS_NEEDED);

const load = (cargo: readonly EpCargo[]): number => cargo.reduce((sum, piece) => sum + EP_CARGO_SIZE[piece], 0);
export const hasRoom = (cargo: readonly EpCargo[], piece: EpCargo): boolean => load(cargo) + EP_CARGO_SIZE[piece] <= EP_HOLD_CAPACITY;

/** 自己在船與 harbour 上、還沒上岸的 crew 數。 */
function unlanded(ep: EpView, me: string): number {
  const holders = [...ep.ships.filter((ship) => ship.player === me), ...ep.harbors.filter((harbor) => harbor.player === me)];
  return holders.reduce((sum, holder) => sum + holder.cargo.filter((piece) => piece === 'crew').length, 0);
}

/**
 * 還值得再造一個 crew：供應有餘，而且手上未上岸的不超過剩餘需求。需求來自開放的巢穴（有 lairs 任務時）
 * 與還沒放 crew 的香料農場（有 spices 任務時）；兩者互相獨立，香料劇本沒有巢穴也成立。
 */
export function crewWanted(g: EpGeometry, me: string): boolean {
  if ((epPlayer(g.ep, me)?.supply.crews ?? 0) < 1) return false;
  const lairs = g.ep.missions.includes('lairs') ? openLairs(g.ep).reduce((sum, site) => sum + CREWS_NEEDED - site.crews.length, 0) : 0;
  const need = lairs + (g.ep.missions.includes('spices') ? farmsToCrew(g.ep, me).length : 0);
  return unlanded(g.ep, me) < Math.min(need, UNLANDED_MAX);
}

/**
 * 造 crew 的位置：先放有空位的船（可直接出航，集中在已有 crew 的船），再放 harbour；
 * 全都滿了才替換一個用不到的 settler（`remove`，規則要求沒有空位才能換）。
 */
export function crewBuild(g: EpGeometry, hints: EpHints, me: string, keepSettler: boolean): BotCommand | null {
  if (hints.crewsLeft < 1 || !crewWanted(g, me)) return null;
  const crews = (cargo: readonly EpCargo[]): number => cargo.filter((piece) => piece === 'crew').length;
  const ships = g.ep.ships.filter((ship) => ship.player === me && hints.pieceShips.includes(ship.id));
  const harbors = g.ep.harbors.filter((harbor) => harbor.player === me && hints.pieceHarbors.includes(harbor.vertex));
  const holders = [
    ...ships.slice().sort((a, b) => crews(b.cargo) - crews(a.cargo)).map((ship) => ({ at: { ship: ship.id }, cargo: ship.cargo })),
    ...harbors.map((harbor) => ({ at: { harbor: harbor.vertex }, cargo: harbor.cargo })),
  ];
  const free = holders.find((holder) => hasRoom(holder.cargo, 'crew'));
  if (free) return { type: 'ep.buildCrew', ...free.at };
  const swap = keepSettler ? undefined : holders.find((holder) => holder.cargo.includes('settler'));
  return swap ? { type: 'ep.buildCrew', ...swap.at, remove: 'settler' } : null;
}

/** 與 `hex` 的任一角相連的海路邊。 */
export function edgesAround(g: EpGeometry, hex: number): Set<number> {
  const out = new Set<number>();
  for (const vertex of g.topo.vertices) {
    if (!vertex.hexes.includes(hex)) continue;
    for (const edge of vertex.edges) if (isSeaRoute(g, edge)) out.add(edge);
  }
  return out;
}

/** 船的兩端碰到的格子。 */
export const hexesAt = (g: EpGeometry, ship: EpShipView): number[] =>
  g.topo.edges[ship.edge]!.vertices.flatMap((vertex) => g.topo.vertices[vertex]!.hexes);

function targets(f: Fleet, ship: EpShipView): ReadonlyMap<number, MissionTarget> {
  const out = new Map<number, MissionTarget>();
  const { g } = f;
  const open = openLairs(g.ep);
  if (open.length === 0) return out;
  const add = (edge: number, kind: MissionTarget['kind'], value: number): void => {
    if ((out.get(edge)?.value ?? 0) < value) out.set(edge, { kind, value });
  };
  if (ship.cargo.includes('crew')) {
    for (const site of open) {
      const value = f.standard ? LAIR_VALUE + FIELD_VALUE + (site.crews.length === CREWS_NEEDED - 1 ? CAPTURE_BONUS : 0) : 1;
      for (const edge of edgesAround(g, site.hex)) add(edge, 'lair', value);
    }
  }
  if (hasRoom(ship.cargo, 'crew')) {
    for (const harbor of g.ep.harbors) {
      if (harbor.player !== f.me || !harbor.cargo.includes('crew')) continue;
      for (const edge of g.topo.vertices[harbor.vertex]!.edges) add(edge, 'fetch', FETCH_VALUE);
    }
    // hero：只有 standard，而且 crew 供應用完、還有巢穴要補人時，回收已攻下巢穴上自己的 crew。
    if (f.standard && (epPlayer(g.ep, f.me)?.supply.crews ?? 1) === 0) {
      for (const site of g.ep.sites) {
        if (site.kind === 'lair' && site.captured && site.crews.includes(f.me)) for (const edge of edgesAround(g, site.hex)) add(edge, 'fetch', PICK_VALUE);
      }
    }
  }
  return out;
}

export const lairsMission: Mission = {
  id: 'lairs',
  targets,
  here: (f, ship) => ship.cargo.includes('crew') && hexesAt(f.g, ship).some((hex) => openLairs(f.g.ep).some((site) => site.hex === hex)),
  free(f, hints) {
    const open = openLairs(f.g.ep).map((site) => site.hex);
    // 1. 上岸：優先補到差一個就攻下的巢穴。
    for (const info of hints.ships) {
      const hex = info.dropCrew.filter((candidate) => open.includes(candidate)).sort((a, b) => crewsAt(f, b) - crewsAt(f, a))[0];
      if (hex !== undefined) return { type: 'ep.dropCrew', ship: info.id, hex };
    }
    if (open.length === 0) return null;
    // 2. 在 harbour 載 crew；crew 用完時回收已攻下巢穴上的（standard）。
    for (const info of hints.ships) {
      const ship = f.g.ep.ships.find((entry) => entry.id === info.id);
      if (!ship || !hasRoom(ship.cargo, 'crew')) continue;
      const harbor = f.g.ep.harbors.find((entry) => info.harbors.includes(entry.vertex) && entry.cargo.includes('crew'));
      if (harbor) return { type: 'ep.load', ship: info.id, harbor: harbor.vertex, piece: 'crew' };
      const hex = f.standard && (epPlayer(f.g.ep, f.me)?.supply.crews ?? 1) === 0 ? info.pickCrew[0] : undefined;
      if (hex !== undefined) return { type: 'ep.pickCrew', ship: info.id, hex };
    }
    return null;
  },
};

function crewsAt(f: Fleet, hex: number): number {
  const site = f.g.ep.sites.find((entry) => entry.hex === hex);
  return site?.kind === 'lair' ? site.crews.length : 0;
}
