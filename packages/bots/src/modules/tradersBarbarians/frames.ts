/**
 * T&B 的 frame kind 與作答資格（T&B 計畫 §3.2、§4.1；策略原則 P3）。
 *
 * - 依序回應的 frame（除了 `wagonAssign` 以外全部）：只有 `responders[0]` 能作答。
 * - 同時回應的 frame（`wagonAssign`）：策略以 `responders.includes(self)` 作答；保底保守起見仍只在
 *   `responders[0] === self` 時動作，與 `fallbackDecision`、`botOwesAction` 一致。
 */

import { TB_FRAME_KINDS, type PublicModulePendingView } from '@catan/rules';
import { TRADERS_BARBARIANS } from './view.ts';

export { TB_FRAME_KINDS };

export type TbFrameStep = keyof typeof TB_FRAME_KINDS;
export type TbFrameKind = (typeof TB_FRAME_KINDS)[TbFrameStep];

/** 全部 12 種 T&B frame kind。 */
export const TB_FRAMES: readonly TbFrameKind[] = Object.values(TB_FRAME_KINDS);

/** 同時回應的 frame：所有出價者一起分配票數（`TB/trains/index.ts:139-154`）。 */
export const TB_SIMULTANEOUS_FRAMES: ReadonlySet<string> = new Set([TB_FRAME_KINDS.wagonAssign]);

/**
 * 回合結束時排入的 frame（`onEndTurn` 回 defer）：Trains 投標、BA 騎士移動、Traders 車隊移動。
 * 這些 frame 在 `turn.end` 被接受之後才出現，回合要等它們結束才換人。
 */
export const TB_END_TURN_FRAMES: ReadonlySet<string> = new Set([
  TB_FRAME_KINDS.wagonBid,
  TB_FRAME_KINDS.baKnights,
  TB_FRAME_KINDS.tbWagon,
]);

/** pending 是不是 T&B 的 frame（kind 以 `tradersBarbarians.` 開頭）；其他模組與 base 的 frame 回 false。 */
export function isTbFrame(pending: unknown): pending is PublicModulePendingView {
  if (typeof pending !== 'object' || pending === null) return false;
  const kind = (pending as { kind?: unknown }).kind;
  const responders = (pending as { responders?: unknown }).responders;
  return typeof kind === 'string' && kind.startsWith(`${TRADERS_BARBARIANS}.`) && Array.isArray(responders);
}

/**
 * `selfId` 此刻能不能回應這個 frame。`purpose` 為 `'duty'`（保底）時一律看 `responders[0]`；`'answer'`（策略）時，
 * 同時回應的 frame 看 `includes`，其餘看 `responders[0]`。
 */
export function isMine(frame: PublicModulePendingView, selfId: string, purpose: 'answer' | 'duty' = 'answer'): boolean {
  const responders = frame.responders ?? [];
  if (purpose === 'answer' && TB_SIMULTANEOUS_FRAMES.has(frame.kind)) return responders.includes(selfId);
  return responders[0] === selfId;
}
