import type { GameEvent } from '@catan/protocol';
import { RESOURCES, type PublicBoardView } from '@catan/rules';

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
    if (kind === 'edge') return ['build.road', 'setup.road'].includes(type) && params.edge === index && board.roads[index]?.player === params.playerId;
    const building = board.buildings[index];
    return !!building && ['build.city', 'build.settlement', 'setup.building'].includes(type) && params.vertex === index &&
      building.player === params.playerId && building.city === (type === 'build.city');
  });
}

export function neutralThefts(events: readonly GameEvent[]): { seq: number; playerId: string; victim: string }[] {
  return events.filter((event) => event.type === 'robber.stole' && typeof event.params.playerId === 'string' && typeof event.params.victim === 'string')
    .map(({ seq, params }) => ({ seq, playerId: params.playerId as string, victim: params.victim as string }));
}
