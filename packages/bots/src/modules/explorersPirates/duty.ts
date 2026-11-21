/**
 * E&P 的保底義務（計畫 §4.1；規格 I9）：只做必定合法的最小動作，不得 throw
 * （server 的保底呼叫不在 try 裡），其餘回 undefined 交給 base 的 `turn.roll`／`turn.end`／棄牌。
 *
 * - setup：harbor、settlement 取 `H.setup.*[0]`；route 有 `ship[0]` 就放船，否則放 `road[0]`。
 * - 海盜 frame：只有 `responders[0]` 才作答，place 取 `H.pirateTargets[0]`，rob 取 `H.robCandidates[0]`。
 * - Movement 擱淺（`H.stranded`）：active 船的安全步 → `ep.extraMove` → `ep.found` → 交給 `turn.end`。
 *   ep-2025.2 起無出口的擱淺船 `stranded` 為 false、`canEndTurn` 為 true，所以沒有「無解」的情況。
 */

import { EP_PIRATE_FRAME, type GameView } from '@katan/rules';
import type { BotCommand, BotModule } from '../types.ts';
import { epGeometry } from './geometry.ts';
import { isSafeStep, routeWorld, type RouteStep } from './route.ts';
import { activeShip, epHints, epPlayer, epView, shipHints, woolOf, type EpHints } from './view.ts';

type Duty = ReturnType<NonNullable<BotModule['duty']>>;

export const explorersPiratesDuty: NonNullable<BotModule['duty']> = (view, selfId) => {
  try {
    return dutyOf(view, selfId);
  } catch {
    // 保底不得 throw：資料形狀不對時當作不歸我管。
    return undefined;
  }
};

function dutyOf(view: GameView, selfId: string): Duty {
  if (view.result) return undefined;
  const hints = epHints(view.hints);
  const pending = view.pending;
  if (pending) return pending.kind === EP_PIRATE_FRAME ? pirateDuty(view, selfId, hints) : undefined;
  if (view.turn?.playerId !== selfId || !hints) return undefined;
  if (hints.setup) return setupDuty(hints);
  if (hints.phase === 'movement' && hints.stranded) return strandedDuty(view, selfId, hints);
  return undefined;
}

/** setup 游標上的指令；也供 `setup` 鉤子使用。 */
export function setupDuty(hints: EpHints): BotCommand | undefined {
  const setup = hints.setup;
  if (!setup) return undefined;
  if (setup.step === 'harbor') return setup.harbor[0] === undefined ? undefined : { type: 'ep.setupHarbor', vertex: setup.harbor[0] };
  if (setup.step === 'settlement') {
    return setup.settlement[0] === undefined ? undefined : { type: 'ep.setupSettlement', vertex: setup.settlement[0] };
  }
  if (setup.ship[0] !== undefined) return { type: 'ep.setupShip', edge: setup.ship[0] };
  return setup.road[0] === undefined ? undefined : { type: 'ep.setupRoad', edge: setup.road[0] };
}

function pirateDuty(view: GameView, selfId: string, hints: EpHints | undefined): Duty {
  const frame = view.pending;
  if (!frame || !('responders' in frame) || frame.responders[0] !== selfId) return null;
  const stage = (frame.data as { stage?: string } | undefined)?.stage;
  if (stage === 'place') {
    const hex = hints?.pirateTargets?.[0];
    return hex === undefined ? null : { type: 'ep.placePirate', hex };
  }
  if (stage === 'rob') {
    const victim = hints?.robCandidates?.[0];
    return victim === undefined ? null : { type: 'ep.robPlayer', victim };
  }
  return null;
}

function strandedDuty(view: GameView, selfId: string, hints: EpHints): Duty {
  const ep = epView(view);
  const ship = activeShip(ep);
  const info = ship ? shipHints(hints, ship.id) : undefined;
  if (!ship || !info) return undefined;
  // 1. active 船的安全步：非滿格優先，滿格步要驗證之後仍有出口。
  const step = safeStepOf(view, selfId, info.steps, ship.id, info.movesLeft);
  if (step !== undefined) return { type: 'ep.moveShip', ship: ship.id, edge: step };
  // 2. 買 extra move；3. 以船上 settler 就地定居。
  if (!info.extra && woolOf(view, selfId) >= 1) return { type: 'ep.extraMove', ship: ship.id };
  const vertex = info.found[0];
  if (vertex !== undefined) return { type: 'ep.found', ship: ship.id, vertex };
  return undefined;
}

/** hints 的步（規則已過濾出口）再以 `route.ts` 驗一次；找不到時退回第一步，仍以 hints 為準。 */
function safeStepOf(
  view: GameView,
  selfId: string,
  steps: readonly RouteStep[],
  shipId: string,
  left: number,
): number | undefined {
  const open = steps.find((step) => !step.full);
  if (open) return open.edge;
  const ep = epView(view);
  const g = ep ? epGeometry(view, ep) : undefined;
  const world = g ? routeWorld(g, shipId) : undefined;
  const paid = ep?.turn.ships[shipId]?.tribute ?? false;
  const gold = epPlayer(ep, selfId)?.gold ?? 0;
  const safe = steps.find((step) => !world || isSafeStep(world, step, left, paid, gold));
  return (safe ?? steps[0])?.edge;
}
