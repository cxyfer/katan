import { useEffect, useRef } from 'react';
import type { Offer } from '@catan/rules';
import { blocksNewCommands } from '../state/commands.ts';
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

/**
 * 交易介面的「自動拒絕」偏好生效處。
 *
 * 掛在整個牌桌（而不是交易面板）上，手機把抽屜收起來時仍會送出拒絕；真正的
 * 裁決仍在伺服器，這裡只是替玩家送出一次普通的 `trade.respond`。指令一次只送
 * 一個：每筆接受的指令都會推進 revision，並行送出必然有一筆被判為過期。
 */
export function useAutoDeclineTrades(controller: TableController): void {
  const latest = useRef(controller);
  latest.current = controller;
  const submitted = useRef(new Set<string>());
  const draining = useRef(false);
  // 只在「該拒絕哪些提案」變化時觸發；逐次狀態更新不重送同一份拒絕。
  const signature = autoDeclineTargets(controller.state)
    .map((offer) => `${offer.id}:${offer.revision}`)
    .join(',');

  useEffect(() => {
    if (signature === '' || draining.current) return;
    draining.current = true;
    void (async () => {
      try {
        for (;;) {
          const { state, actions } = latest.current;
          const gameId = state.game?.gameId ?? '';
          const next = autoDeclineTargets(state).find(
            (offer) => !submitted.current.has(`${gameId}:${offer.id}:${offer.revision}`),
          );
          if (!next) return;
          submitted.current.add(`${gameId}:${next.id}:${next.revision}`);
          await actions.submitCommand(
            { type: 'trade.respond', offerId: next.id, response: 'declined' },
            'play.tradeDecline',
          );
        }
      } finally {
        draining.current = false;
      }
    })();
  }, [signature]);
}
