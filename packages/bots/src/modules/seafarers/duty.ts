/**
 * Seafarers 的保底義務（規格 I9；SF 計畫 §4.1）：只做必定合法的最小動作，不得 throw
 * （server 的保底呼叫不在 try 裡，例外會讓這一局不斷重試）。
 *
 * - setup 的 road 階段：有 `legalRoads` 就放路，否則放 `setupShips[0]`。
 * - freeRoads：道路存量 > 0 且有 `legalRoads` 就蓋路，否則蓋 `legalShips[0]`（Road Building 中造船免費）。
 *   `legalRoads` 不扣存量，所以存量用完時不能送 build.road（E_NO_PIECES）。
 * - `seafarers.gold`：只有 `responders[0]` 才作答；依 `RESOURCES` 順序湊滿 `goldRequired` 張，每種都
 *   不超過銀行存量（否則 E_BANK_EMPTY）。
 * - 保底只在 freeRoads 造船，不在其他時機造船或移船；其他模組的 frame 回 undefined。
 */

import { GOLD_FRAME, RESOURCES, type GameView, type PublicModulePendingView, type Resource } from '@catan/rules';
import { roadStockLeft } from '../../board.ts';
import type { BotModule } from '../types.ts';
import { moduleHints } from '../view.ts';

export const seafarersDuty: NonNullable<BotModule['duty']> = (view, selfId) => {
  if (view.result) return undefined;
  const pending = view.pending;
  if (pending) {
    if (pending.kind === 'freeRoads') return pending.actor === selfId ? freeRoadsDuty(view, selfId) : undefined;
    if (pending.kind === GOLD_FRAME) return goldDuty(view, pending, selfId);
    return undefined;
  }
  if (view.turn?.phase === 'setup' && view.turn.setup?.stage === 'road') return setupRoadDuty(view);
  return undefined;
};

/** setup 的 road 階段：路優先，否則放船；兩者都沒有（不是自己的回合）時不歸我管。 */
function setupRoadDuty(view: GameView): ReturnType<NonNullable<BotModule['duty']>> {
  const road = view.hints?.legalRoads?.[0];
  if (road !== undefined) return { type: 'setup.placeRoad', edge: road };
  const ship = moduleHints(view.hints, 'seafarers')?.setupShips?.[0];
  return ship === undefined ? undefined : { type: 'setup.placeShip', edge: ship };
}

function freeRoadsDuty(view: GameView, selfId: string): ReturnType<NonNullable<BotModule['duty']>> {
  const road = view.hints?.legalRoads?.[0];
  if (road !== undefined && roadStockLeft(view, selfId) > 0) return { type: 'build.road', edge: road };
  const ship = moduleHints(view.hints, 'seafarers')?.legalShips?.[0];
  // 容量為 0 的 frame 會被截斷、不會投影出來；到這裡卻沒有任何選項時，不送指令。
  return ship === undefined ? null : { type: 'build.ship', edge: ship };
}

function goldDuty(view: GameView, frame: PublicModulePendingView, selfId: string): ReturnType<NonNullable<BotModule['duty']>> {
  if (frame.responders?.[0] !== selfId) return null;
  const stock = (resource: Resource): number => {
    const amount = view.bank?.[resource];
    return typeof amount === 'number' && Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  };
  const hinted = moduleHints(view.hints, 'seafarers')?.goldRequired;
  const required = typeof hinted === 'number' ? hinted : owedFromFrame(frame, selfId, stock);
  if (!Number.isInteger(required) || required < 0) return null;
  const resources: Resource[] = [];
  for (const resource of RESOURCES) {
    for (let left = stock(resource); left > 0 && resources.length < required; left--) resources.push(resource);
  }
  // 銀行不足以湊滿時不送一個必定被拒絕的指令。
  return resources.length === required ? { type: 'gold.choose', resources } : null;
}

/** 沒有 hints 時的後備：frame 的公開欠額，不超過銀行總數。 */
function owedFromFrame(frame: PublicModulePendingView, selfId: string, stock: (resource: Resource) => number): number {
  const picks = (frame.data as { picks?: Record<string, unknown> } | undefined)?.picks;
  const owed = picks?.[selfId];
  if (typeof owed !== 'number') return NaN;
  return Math.min(owed, RESOURCES.reduce((sum, resource) => sum + stock(resource), 0));
}
