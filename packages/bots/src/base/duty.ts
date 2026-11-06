/** base 的保底義務：只做必定合法的最小動作（規格 I9）。 */

import { RESOURCES, type Command, type GameView, type Resource } from '@catan/rules';

/** 自己欠的待決效果；沒有則回傳 null。 */
export function pendingDuty(view: GameView, selfId: string): Command | null {
  const pending = view.pending;
  if (!pending) return null;
  switch (pending.kind) {
    case 'discard': {
      if (!pending.waitingFor.includes(selfId)) return null;
      const count = pending.required[selfId] ?? 0;
      return { type: 'pending.discard', resources: handList(view, selfId).slice(0, count) };
    }
    case 'moveRobber': {
      if (pending.actor !== selfId) return null;
      const hex = view.board.terrain.findIndex(
        (terrain, index) => index !== view.board.robber && terrain !== 'sea',
      );
      return hex < 0 ? null : { type: 'pending.moveRobber', hex };
    }
    case 'steal': {
      if (pending.actor !== selfId) return null;
      const victim = pending.candidates[0];
      return victim === undefined ? null : { type: 'pending.steal', victim };
    }
    case 'yearOfPlenty': {
      if (pending.actor !== selfId) return null;
      const resource = RESOURCES.find((candidate) => view.bank[candidate] > 0);
      return resource === undefined ? null : { type: 'pending.takeResource', resource };
    }
    case 'freeRoads': {
      if (pending.actor !== selfId) return null;
      const edge = view.hints?.legalRoads[0];
      return edge === undefined ? null : { type: 'build.road', edge };
    }
    default:
      // 模組 frame 由各模組的 duty 處理。
      return null;
  }
}

/** 初始放置階段自己欠的動作：取第一個合法位置。 */
export function setupDuty(view: GameView): Command | null {
  const hints = view.hints;
  if (!hints) return null;
  const stage = view.turn.setup?.stage;
  if (stage === 'building' && hints.legalSettlements[0] !== undefined) {
    return { type: 'setup.placeBuilding', vertex: hints.legalSettlements[0] };
  }
  if (stage === 'road' && hints.legalRoads[0] !== undefined) {
    return { type: 'setup.placeRoad', edge: hints.legalRoads[0] };
  }
  return null;
}

/** 依 `RESOURCES` 順序展開自己的手牌。 */
export function handList(view: GameView, selfId: string): Resource[] {
  const resources = view.players.find((player) => player.id === selfId)?.resources;
  const out: Resource[] = [];
  if (!resources) return out;
  for (const resource of RESOURCES) {
    for (let i = 0; i < resources[resource]; i++) out.push(resource);
  }
  return out;
}
