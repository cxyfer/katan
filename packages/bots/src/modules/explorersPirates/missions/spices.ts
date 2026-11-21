/**
 * 香料任務（計畫 §4.3、§4.6；E4b）：造 crew 放到香料農場（`ep.dropCrew`，每個農場每人一個）、
 * 在農場 `ep.loadSpice` 裝袋（一袋佔 1 格，可與 crew 同船）、載到 Council anchor 交付。
 *
 * 價值與魚相同：取香料軌道的邊際分（`haulValue`）；農場另加能力價值（Swift 多 MP、Fast Gold、Pirate Bonus 多追逐點數），
 * 能力本身由規則自動生效（`H.ships[i].movesLeft`、`H.fastGoldLeft`、`chaseNumbers`），策略只在選農場時計入。
 * easy 不看價值（一律 1，近的先去）。crew 的需求由 `lairs.crewWanted` 一併計算，不依賴巢穴。
 */

import { EP_SWIFT_MAX } from '@katan/rules';
import type { BotCommand } from '../../types.ts';
import { isSeaRoute } from '../geometry.ts';
import type { Fleet } from '../movement.ts';
import { epPlayer, type EpShipView } from '../view.ts';
import { atAnchor } from './fish.ts';
import { edgesAround, hasRoom, hexesAt } from './lairs.ts';
import { farmsToCrew, farmsToLoad, haulValue, trackOpen } from './tracks.ts';
import type { Mission, MissionTarget } from './index.ts';

const FARM_FACTOR = 0.9;
const LOAD_FACTOR = 0.8;
const DELIVER_FACTOR = 1.5;
const FETCH_VALUE = 0.9;
/** 能力的勝利分當量：多 1 MP、一次 1 金換牌、更多追逐點數。 */
const SWIFT_VALUE = 0.5;
const FAST_GOLD_VALUE = 0.25;
const PIRATE_BONUS_VALUE = 0.3;

/** 農場能力的價值：Swift 已到上限就不再加分。 */
function abilityValue(f: Fleet, ability: string): number {
  const mine = epPlayer(f.g.ep, f.me)?.abilities;
  if (ability === 'swift') return (mine?.swift ?? 0) < EP_SWIFT_MAX ? SWIFT_VALUE : 0;
  return ability === 'fastGold' ? FAST_GOLD_VALUE : PIRATE_BONUS_VALUE;
}

function targets(f: Fleet, ship: EpShipView): ReadonlyMap<number, MissionTarget> {
  const out = new Map<number, MissionTarget>();
  const { g } = f;
  if (!trackOpen(g.ep, f.me, 'spices')) return out;
  const value = f.standard ? haulValue(g.ep, f.me, 'spices') : 1;
  const add = (edge: number, kind: MissionTarget['kind'], score: number): void => {
    if ((out.get(edge)?.value ?? 0) < score) out.set(edge, { kind, value: score });
  };
  if (ship.cargo.includes('spice')) {
    for (const anchor of g.ep.anchors) for (const edge of g.topo.vertices[anchor]!.edges) if (isSeaRoute(g, edge)) add(edge, 'spice', f.standard ? value * DELIVER_FACTOR : 1);
  }
  const farms = farmsToCrew(g.ep, f.me);
  if (ship.cargo.includes('crew')) {
    for (const farm of farms) for (const edge of edgesAround(g, farm.hex)) add(edge, 'spice', f.standard ? value * FARM_FACTOR + abilityValue(f, farm.ability) : 1);
  }
  if (hasRoom(ship.cargo, 'spice')) {
    for (const farm of farmsToLoad(g.ep, f.me)) for (const edge of edgesAround(g, farm.hex)) add(edge, 'spice', f.standard ? value * LOAD_FACTOR : 1);
  }
  if (farms.length > 0 && hasRoom(ship.cargo, 'crew')) {
    for (const harbor of g.ep.harbors) {
      if (harbor.player !== f.me || !harbor.cargo.includes('crew')) continue;
      for (const edge of g.topo.vertices[harbor.vertex]!.edges) add(edge, 'fetch', FETCH_VALUE);
    }
  }
  return out;
}

export const spicesMission: Mission = {
  id: 'spices',
  targets,
  here(f, ship) {
    const { ep } = f.g;
    if (!trackOpen(ep, f.me, 'spices')) return false;
    const hexes = hexesAt(f.g, ship);
    if (ship.cargo.includes('spice') && atAnchor(f, ship)) return true;
    if (ship.cargo.includes('crew') && farmsToCrew(ep, f.me).some((farm) => hexes.includes(farm.hex))) return true;
    return hasRoom(ship.cargo, 'spice') && farmsToLoad(ep, f.me).some((farm) => hexes.includes(farm.hex));
  },
  free(f, hints): BotCommand | null {
    const { ep } = f.g;
    // 交付：`H.ships[i].deliver` 對魚與香料都成立；fish.free 通常已先處理，這裡只是保險（香料劇本一定有魚任務）。
    for (const info of hints.ships) {
      if (info.deliver && ep.ships.find((ship) => ship.id === info.id)?.cargo.includes('spice')) return { type: 'ep.deliver', ship: info.id };
    }
    if (!trackOpen(ep, f.me, 'spices')) return null;
    const wanted = farmsToCrew(ep, f.me).map((farm) => farm.hex);
    for (const info of hints.ships) {
      const hex = info.dropCrew.find((candidate) => wanted.includes(candidate));
      if (hex !== undefined) return { type: 'ep.dropCrew', ship: info.id, hex };
    }
    const loadable = farmsToLoad(ep, f.me).map((farm) => farm.hex);
    for (const info of hints.ships) {
      const hex = info.loadSpice.find((candidate) => loadable.includes(candidate));
      if (hex !== undefined) return { type: 'ep.loadSpice', ship: info.id, hex };
    }
    if (wanted.length === 0) return null;
    // 在 harbour 載 crew（lairs.free 只在有開放巢穴時載）。
    for (const info of hints.ships) {
      const ship = ep.ships.find((entry) => entry.id === info.id);
      if (!ship || !hasRoom(ship.cargo, 'crew')) continue;
      const harbor = ep.harbors.find((entry) => info.harbors.includes(entry.vertex) && entry.cargo.includes('crew'));
      if (harbor) return { type: 'ep.load', ship: info.id, harbor: harbor.vertex, piece: 'crew' };
    }
    return null;
  },
};
