/** base 的保底義務：只做必定合法的最小動作（規格 I9）。 */

import { COMMODITIES, RESOURCES, type CardKind, type Command, type GameView } from '@catan/rules';
import { roadStockLeft } from '../board.ts';
import type { BotModule } from '../modules/types.ts';
import { banditTargets } from './robber.ts';

/**
 * 自己欠的待決效果；沒有則回傳 null。`modules` 只用在 moveRobber：取盜賊目標 fold 的第一項
 * （`banditTargets`）；省略時沒有模組，結果與 base 相同。
 */
export function pendingDuty(view: GameView, selfId: string, modules: readonly BotModule[] = []): Command | null {
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
      const hex = banditTargets(view, selfId, modules)[0];
      return hex === undefined ? null : { type: 'pending.moveRobber', hex };
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
      // `legalRoads` 不扣存量：道路用完時送 build.road 會得到 E_NO_PIECES，改交給模組（造船）。
      // base 的 frame 在存量為 0 時不會被投影，所以對 base 沒有影響。
      if (roadStockLeft(view, selfId) <= 0) return null;
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

/**
 * 依 `CARD_KINDS` 順序展開自己的手牌（資源在前、commodity 在後）。直接讀 `resources` 與 `commodities`，
 * 不經模組的 `cardKinds` 鉤子：保底沒有模型、不得 throw（E-3）。base 的 commodity 恆為空，結果與只有資源相同。
 */
export function handList(view: GameView, selfId: string): CardKind[] {
  const player = view.players.find((candidate) => candidate.id === selfId);
  const out: CardKind[] = [];
  const resources = player?.resources;
  if (!resources) return out;
  for (const resource of RESOURCES) {
    for (let i = 0; i < resources[resource]; i++) out.push(resource);
  }
  for (const commodity of COMMODITIES) {
    const amount = player?.commodities?.[commodity];
    if (typeof amount !== 'number') continue;
    for (let i = 0; i < amount; i++) out.push(commodity);
  }
  return out;
}
