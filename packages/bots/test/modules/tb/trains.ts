/**
 * `tb-merchant-trains` 的子 kit：車廂 + supply 恆為 `WAGON_SUPPLY`（22），每條邊最多一節車廂
 * （`rules/test/tb-trains.test.ts:411-412`）。
 *
 * 投標中的 wool 與 grain 暫時離開銀行（投標結束才歸還），所以 T&B 的資源守恆是「手牌 + 銀行 + 投標中的牌」恆為 profile 的
 * 供應量：`resourceSupplyProblems`。harness 的 base 守恆（`supplyTotal`）只算手牌與銀行，投標途中撞到步數上限的局會在
 * 那裡誤報差額，所以 T&B 的對局（`test/tb-game.ts`）改用 `tbConservationProblems`（`../tradersBarbarians.ts`），
 * 不讀 `RunResult.conservation`。
 *
 * S5 加上 B-FAIR 的 `hideDifferently`（對手的出價牌）與 Q2 的 `mechanics`（正出價、放置的車廂）。
 */

import { requireProfile, RESOURCES, TB_FRAME_KINDS, type GameState, type PendingFrame, type Resource } from '@catan/rules';
import type { MechanicsTally } from '../types.ts';
import { partStateOf, type TbPartKit } from './part.ts';

interface TrainsSlot {
  wagons: { edge: number; train: number }[];
  supply: number;
}

const VOTE_FRAMES: ReadonlySet<string> = new Set([TB_FRAME_KINDS.wagonBid, TB_FRAME_KINDS.wagonAssign, TB_FRAME_KINDS.wagonPlace]);

/** 進行中的投票（同一輪的出價、分配與放置共用一份 data，只取第一個）；沒有投票時是空物件。 */
export function voteBids(state: GameState): Record<string, { wool: number; grain: number }> {
  const frames: (PendingFrame | null | undefined)[] = [state.pending, ...(state.pendingQueue ?? [])];
  for (const frame of frames) {
    if (frame && 'module' in frame && VOTE_FRAMES.has(frame.kind)) {
      return ((frame.data as { bids?: Record<string, { wool: number; grain: number }> }).bids ?? {});
    }
  }
  return {};
}

function conservation(state: GameState): readonly string[] {
  const slot = partStateOf<TrainsSlot>(state, 'tb-merchant-trains');
  if (!slot) return ['tb-merchant-trains state missing'];
  const problems: string[] = [];
  const total = slot.wagons.length + slot.supply;
  if (total !== 22) problems.push(`wagons ${total} != 22`);
  if (slot.supply < 0) problems.push(`wagon supply < 0: ${slot.supply}`);
  if (new Set(slot.wagons.map((wagon) => wagon.edge)).size !== slot.wagons.length) problems.push('two wagons share an edge');
  return problems;
}

/** 各資源的「手牌 + 銀行 + 投標中的牌」等於 profile 的供應量，而且都不是負的；沒有投票時就是 base 的資源守恆。 */
export function resourceSupplyProblems(state: GameState): string[] {
  const problems: string[] = [];
  const bids = Object.values(voteBids(state));
  const expected = requireProfile(state.profileId).bankPerResource;
  for (const resource of RESOURCES) {
    const bid = resource === 'wool' || resource === 'grain' ? bids.reduce((sum, entry) => sum + entry[resource], 0) : 0;
    const held = state.players.reduce((sum, player) => sum + player.resources[resource], 0);
    const total = state.bank[resource] + held + bid;
    if (total !== expected) problems.push(`resource ${resource} with bids ${total} != ${expected}`);
    if (state.bank[resource] < 0) problems.push(`bank ${resource} < 0: ${state.bank[resource]}`);
    for (const player of state.players) {
      if (player.resources[resource] < 0) problems.push(`${player.id} ${resource} < 0: ${player.resources[resource]}`);
    }
  }
  return problems;
}

const BID_CARDS: readonly Resource[] = ['wool', 'grain'];

/**
 * B-FAIR：對手手上能出價的牌（wool、grain）是隱藏資訊（投影只有張數）。讓一位對手的一張 wool 或 grain 與另一位對手的一張
 * 非出價牌交換：兩人的張數不變、守恆不變，只改變誰能出價多少。出價本身是公開的，不擾動。
 */
function hideDifferently(variant: GameState, viewerId: string): boolean {
  const opponents = variant.players.filter((player) => player.id !== viewerId);
  for (const a of opponents) {
    for (const b of opponents) {
      if (a === b) continue;
      for (const give of BID_CARDS) {
        if (a.resources[give] === 0) continue;
        for (const take of RESOURCES) {
          if (BID_CARDS.includes(take) || b.resources[take] === 0) continue;
          a.resources[give] -= 1;
          a.resources[take] += 1;
          b.resources[take] -= 1;
          b.resources[give] += 1;
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Q2（§6.3）：只計策略送出的指令（`source === 'policy'`）。
 * - `positiveBids`：wool + grain > 0 的 `tb.bidWagon`；
 * - `wagonsPlaced`：`tb.wagonPlaced` 事件（放置或分配結算時發出）。
 */
function mechanics(): MechanicsTally {
  let positiveBids = 0;
  let wagonsPlaced = 0;
  return {
    observe(step) {
      if (step.source !== 'policy') return;
      if (step.command.type === 'tb.bidWagon') {
        const bid = step.command as unknown as { wool?: number; grain?: number };
        if ((bid.wool ?? 0) + (bid.grain ?? 0) > 0) positiveBids += 1;
      }
      wagonsPlaced += step.events.filter((event) => event.type === 'tb.wagonPlaced').length;
    },
    snapshot: () => ({ positiveBids, wagonsPlaced }),
  };
}

export const trainsPartKit: TbPartKit = { id: 'tb-merchant-trains', conservation, hideDifferently, mechanics };
