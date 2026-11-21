/**
 * 魚場任務（計畫 §4.3、§4.6；E4a）：先擲魚、在淺灘 `ep.loadFish`、載到 Council anchor `ep.deliver`。
 *
 * 目標過濾：自己的魚軌道還沒走完；裝魚要有空位（魚佔 2 格），淺灘上有魚，或還能擲魚（供應有魚、海盜不在上面）；
 * 載著魚就前往 anchor。價值取軌道推進的邊際分：軌道顯示的是目前格子的分數，所以一份魚的價值是
 * 「下一次加分 ÷ 還要幾份」，領先者的 bonus 另計；easy 不看價值（一律 1，近的先去）。
 */

import type { BotCommand } from '../../types.ts';
import { isSeaRoute } from '../geometry.ts';
import type { Fleet } from '../movement.ts';
import type { EpShipView, EpView } from '../view.ts';
import { edgesAround, hasRoom, hexesAt } from './lairs.ts';
import { haulValue, trackOpen } from './tracks.ts';
import type { Mission, MissionTarget } from './index.ts';

/** 空淺灘（等擲魚）只給一點價值，讓船停在附近。 */
const WAIT_FACTOR = 0.3;
const LOAD_FACTOR = 0.8;
const DELIVER_FACTOR = 1.5;

/** 自己的魚軌道還有路可走。 */
export const fishOpen = (ep: EpView, me: string): boolean => trackOpen(ep, me, 'fish');

/** 這回合還值得擲魚：有空淺灘可以長魚、有船裝得下，而且軌道還沒走完。 */
function rollWanted(f: Fleet): boolean {
  const { ep } = f.g;
  if (ep.turn.fishRolled || ep.fishSupply < 1 || !fishOpen(ep, f.me)) return false;
  const open = ep.sites.some((site) => site.kind === 'shoal' && !site.fish && ep.pirate?.hex !== site.hex);
  return open && ep.ships.some((ship) => ship.player === f.me && hasRoom(ship.cargo, 'fish'));
}

function targets(f: Fleet, ship: EpShipView): ReadonlyMap<number, MissionTarget> {
  const out = new Map<number, MissionTarget>();
  const { g } = f;
  if (!fishOpen(g.ep, f.me)) return out;
  const value = f.standard ? haulValue(g.ep, f.me, 'fish') : 1;
  const add = (edge: number, kind: MissionTarget['kind'], score: number): void => {
    if ((out.get(edge)?.value ?? 0) < score) out.set(edge, { kind, value: score });
  };
  if (ship.cargo.includes('fish')) {
    for (const anchor of g.ep.anchors) for (const edge of g.topo.vertices[anchor]!.edges) if (isSeaRoute(g, edge)) add(edge, 'fish', f.standard ? value * DELIVER_FACTOR : 1);
  }
  if (!hasRoom(ship.cargo, 'fish')) return out;
  for (const site of g.ep.sites) {
    if (site.kind !== 'shoal') continue;
    const score = site.fish ? value * LOAD_FACTOR : f.standard && g.ep.fishSupply > 0 && g.ep.pirate?.hex !== site.hex ? value * WAIT_FACTOR : 0;
    if (score > 0) for (const edge of edgesAround(g, site.hex)) add(edge, 'fish', f.standard ? score : 1);
  }
  return out;
}

export const fishMission: Mission = {
  id: 'fish',
  targets,
  here(f, ship) {
    const { ep } = f.g;
    if (!fishOpen(ep, f.me)) return false;
    if (rollWanted(f)) return true;
    if (ship.cargo.includes('fish') && atAnchor(f, ship)) return true;
    return hasRoom(ship.cargo, 'fish') && hexesAt(f.g, ship).some((hex) => ep.sites.some((site) => site.hex === hex && site.kind === 'shoal' && site.fish));
  },
  free(f, hints): BotCommand | null {
    const { ep } = f.g;
    // 擲魚要在任何船移動之前（擲魚會結束移動中的那艘）。
    if (hints.fishRoll && ep.turn.active === null && rollWanted(f)) return { type: 'ep.fishRoll' };
    for (const info of hints.ships) if (info.deliver) return { type: 'ep.deliver', ship: info.id };
    if (!fishOpen(ep, f.me)) return null;
    for (const info of hints.ships) if (info.loadFish.length > 0) return { type: 'ep.loadFish', ship: info.id, hex: info.loadFish[0]! };
    return null;
  },
};

/** 船的任一端是 Council anchor。 */
export function atAnchor(f: Fleet, ship: EpShipView): boolean {
  return f.g.topo.edges[ship.edge]!.vertices.some((vertex) => f.g.ep.anchors.includes(vertex));
}
