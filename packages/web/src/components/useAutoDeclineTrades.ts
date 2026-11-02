import { useEffect, useRef, useState } from 'react';
import type { Offer } from '@catan/rules';
import { blocksNewCommands, STALE_MESSAGE_ID } from '../state/commands.ts';
import { followUpsHeld, shownHand, type TableState } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { tradeShortfall } from './TradePanel.tsx';

/**
 * 勾選「自動拒絕自己資源不足的提案」後，客戶端可以代為拒絕的提案。
 *
 * 只有在自己看得到手牌、而且現在真的能送出指令時才成立：離線、擲骰演出、投影
 * 尚未追上、另一個分頁持有座位或有指令在途時一律回傳空陣列，等狀態恢復再判斷。
 * 已經回應過的提案也不在此列——玩家明確表達的意願優先於自動化偏好。
 */
export function autoDeclineTargets(state: TableState): Offer[] {
  const view = state.game?.view;
  const selfId = state.session?.id ?? null;
  if (!state.tradeAutoDecline || !view || !selfId) return [];
  if (
    state.connection !== 'online' ||
    followUpsHeld(state) ||
    state.activeElsewhere ||
    blocksNewCommands(state.command)
  ) return [];
  const owned = shownHand(state);
  if (!owned) return [];
  return view.offers.filter(
    (offer) =>
      offer.status === 'open' &&
      offer.windowId === view.windowId &&
      offer.from !== selfId &&
      (offer.to === selfId || offer.to === 'all') &&
      offer.responses[selfId] === undefined &&
      // 條款以提案者視角儲存：`want` 就是收件者要付出的資源。
      tradeShortfall(owned, offer.want) !== null,
  );
}

/** 同一份提案的同一版只拒絕一次；改版或換局都是新的決定。 */
function declineKey(state: TableState, offer: Offer): string {
  return `${state.game?.gameId ?? ''}:${offer.id}:${offer.revision}`;
}

/**
 * 交易介面的「自動拒絕」偏好生效處。
 *
 * 掛在整個牌桌（而不是交易面板）上，手機把抽屜收起來時仍會送出拒絕；真正的
 * 裁決仍在伺服器，這裡只是替玩家送出一次普通的 `trade.respond`。指令一次只送
 * 一個：每筆接受的指令都會推進 revision，並行送出必然有一筆被判為過期。每次
 * 嘗試結束後都重新以最新投影挑下一個目標，避免在指令狀態尚未落到 ref 時誤判。
 */
export function useAutoDeclineTrades(controller: TableController): void {
  const latest = useRef(controller);
  latest.current = controller;
  const submitted = useRef(new Set<string>());
  const retryAfter = useRef(new Map<string, number>());
  const inFlight = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const revision = controller.state.game?.revision ?? 0;
  const next = autoDeclineTargets(controller.state).find((offer) => {
    const key = declineKey(controller.state, offer);
    if (submitted.current.has(key)) return false;
    // 失敗後先等投影真的前進，避免在同一份過時狀態上重送。
    const barrier = retryAfter.current.get(key);
    return barrier === undefined || revision >= barrier;
  });
  const nextKey = next ? declineKey(controller.state, next) : null;

  useEffect(() => {
    if (!next || !nextKey || inFlight.current) return;
    inFlight.current = nextKey;
    submitted.current.add(nextKey);
    void (async () => {
      const { state, actions } = latest.current;
      const receipt = await actions.submitCommand(
        { type: 'trade.respond', offerId: next.id, response: 'declined' },
        'play.tradeDecline',
      );
      // 只有被接受的回執才代表這一版已回答。過期、被拒或根本沒送出的嘗試
      // 若也永久占位，投影追上後就再也不會替玩家拒絕。
      if (receipt?.outcome !== 'accepted') {
        submitted.current.delete(nextKey);
        if (receipt) {
          // 過期回執帶著伺服器當下的 revision：投影追上就能安全重送；其他
          // 拒絕原因則等投影越過這次嘗試，避免在同一份狀態上反覆送出。
          retryAfter.current.set(
            nextKey,
            receipt.error?.messageId === STALE_MESSAGE_ID ? receipt.revision : (state.game?.revision ?? 0) + 1,
          );
        }
      }
      inFlight.current = null;
      setAttempt((value) => value + 1);
    })();
  }, [next, nextKey, revision, attempt]);
}
