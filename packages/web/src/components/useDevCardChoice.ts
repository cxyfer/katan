import { useEffect, useRef } from 'react';
import { blocksNewCommands } from '../state/commands.ts';
import { followUpsHeld, type TableState } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';

/** 現在能不能打出這張手上的發展卡；伺服器仍是出牌規則的唯一權威。 */
export function canPlayDevCard(state: TableState, card: string): boolean {
  const view = state.game?.view;
  const selfId = state.session?.id ?? null;
  if (!view || !selfId || followUpsHeld(state) || state.activeElsewhere) return false;
  const self = view.players.find((player) => player.id === selfId);
  return view.turn.playerId === selfId && !view.turn.devCardPlayed && view.pending === null &&
    !!self?.devCards?.includes(card as never);
}

/** 伺服器已打出豐收之年、正等自己領取資源時的 pending。 */
export function ownYearOfPlenty(state: TableState) {
  const pending = state.game?.view.pending;
  return pending?.kind === 'yearOfPlenty' && pending.actor === state.session?.id ? pending : null;
}

/**
 * 發展卡資源選擇的生命週期：
 * - 尚未打出的選擇在不能再出牌時（換人、已出過牌、卡不見了）自動關閉；
 * - 豐收之年確認後，伺服器開啟領取步驟就把排好的資源逐張送出，一次只送一張。
 */
export function useDevCardChoice(controller: TableController) {
  const { state, actions } = controller;
  const choice = state.devCardChoice;
  const pending = ownYearOfPlenty(state);
  const busy = blocksNewCommands(state.command);
  const startable = choice ? canPlayDevCard(state, choice.card) : false;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!choice || busy || inFlight.current) return;
    if (choice.card === 'yearOfPlenty' && pending) return;
    if (!startable) actions.setDevCardChoice(null);
  }, [choice, busy, pending, startable, actions]);

  const next = choice?.card === 'yearOfPlenty' ? choice.queued[0] : undefined;
  const held = followUpsHeld(state);
  useEffect(() => {
    if (!next || !pending || busy || held || inFlight.current) return;
    inFlight.current = true;
    void actions.submitCommand({ type: 'pending.takeResource', resource: next }, 'devCard.yearOfPlenty')
      .then((receipt) => {
        inFlight.current = false;
        // 被拒絕（例如銀行剛好被拿光）就停下來，改由玩家在選擇器裡重新挑選。
        const queued = receipt?.outcome === 'accepted' ? (choice?.queued ?? []).slice(1) : [];
        actions.setDevCardChoice({ card: 'yearOfPlenty', queued });
      }, () => {
        inFlight.current = false;
        actions.setDevCardChoice({ card: 'yearOfPlenty', queued: [] });
      });
  }, [next, pending, busy, held, choice, actions]);
}
