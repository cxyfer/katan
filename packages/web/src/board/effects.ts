import type { GameEvent } from '@catan/protocol';
import { RESOURCES, type PublicBoardView } from '@catan/rules';
import type { BoardEffectGroup } from './animation.ts';

export const MAX_FLIGHT_ICONS = 24;
export type Grant = { playerId: string; resource: typeof RESOURCES[number]; amount: number };

/** 只取實際彙總支付；不推算逐地塊來源，也不讀取私人偷竊卡種。 */
export function productionGrants(events: readonly GameEvent[]): Grant[] {
  const totals = new Map<string, Grant>();
  for (const event of events) {
    if (event.type !== 'production.resolved') continue;
    const grants = event.params.grants;
    if (!grants || typeof grants !== 'object' || Array.isArray(grants)) continue;
    for (const [playerId, resources] of Object.entries(grants)) {
      if (!resources || typeof resources !== 'object' || Array.isArray(resources)) continue;
      for (const resource of RESOURCES) {
        const amount = (resources as Record<string, unknown>)[resource];
        if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) continue;
        const key = `${playerId}:${resource}`;
        const previous = totals.get(key)?.amount ?? 0;
        if (Number.isSafeInteger(previous + amount)) totals.set(key, { playerId, resource, amount: previous + amount });
      }
    }
  }
  return [...totals.values()];
}

export function confirmedPlacement(events: readonly GameEvent[], board: PublicBoardView, kind: 'edge' | 'vertex', index: number): boolean {
  return events.some(({ type, params }) => {
    if (kind === 'edge') {
      const piece = board.roads[index];
      if (!piece || piece.player !== params.playerId) return false;
      if (piece.ship) {
        return (['ship.built', 'setup.ship'].includes(type) && params.edge === index) ||
          (type === 'ship.moved' && params.to === index);
      }
      return ['build.road', 'setup.road'].includes(type) && params.edge === index;
    }
    const building = board.buildings[index];
    return !!building && ['build.city', 'build.settlement', 'setup.building'].includes(type) && params.vertex === index &&
      building.player === params.playerId && building.city === (type === 'build.city');
  });
}

export function neutralThefts(events: readonly GameEvent[]): { seq: number; playerId: string; victim: string }[] {
  return events.filter((event) => event.type === 'robber.stole' && typeof event.params.playerId === 'string' && typeof event.params.victim === 'string')
    .map(({ seq, params }) => ({ seq, playerId: params.playerId as string, victim: params.victim as string }));
}

/** 多組落下並行時，以最新確認該位置的一組為準；同一位置先建村莊再升級城市只播城市。 */
export function placementArrival(
  arrivals: readonly BoardEffectGroup[], board: PublicBoardView, kind: 'edge' | 'vertex', index: number,
): BoardEffectGroup | null {
  return arrivals.findLast((group) => confirmedPlacement(group.events, board, kind, index)) ?? null;
}
