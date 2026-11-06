import { useId, useState } from 'react';
import { useLocale, useT } from '../i18n/context.tsx';
import {
  abandonmentAllowed,
  awaitingConsent,
  isSelfWithdrawn,
  joinNames,
  mustVote,
  nicknameOf,
  selfMemberOf,
  withdrawnOthers,
} from '../state/leave.ts';
import type { TableController } from '../state/useTable.ts';
import '../styles/leave.css';

/**
 * 退出與結束對局在牌桌上的狀態橫幅（SPEC §4.6）。
 *
 * 放在訊息欄、不在可關閉的工具面板內，所以投票與「撤回退出」不會被其他面板蓋住。
 * 三種狀態可同時出現：自己已退出、進行中的結束對局投票、以及他人已退出的提示。
 */
export function AbandonPanel({ controller, onPropose }: {
  controller: TableController;
  /** 開啟離開對話框並直接停在「提議結束」的確認步驟。 */
  onPropose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const { state, actions } = controller;
  const [busy, setBusy] = useState(false);
  const room = state.room;
  const selfId = state.session?.id ?? null;
  if (!room) return null;

  const proposal = room.pendingAbandon ?? null;
  const selfWithdrawn = isSelfWithdrawn(room, selfId);
  const others = withdrawnOthers(room, selfId);
  const self = selfMemberOf(room, selfId);
  const showHint = !proposal && !selfWithdrawn && others.length > 0 && abandonmentAllowed(room)
    && self !== null && self.connected;
  if (!selfWithdrawn && !proposal && !showHint) return null;

  const guard = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {selfWithdrawn && (
        <section className="prompt prompt--mine abandon-panel" aria-labelledby={`${id}-withdrawn`} data-testid="withdrawn-banner">
          <h2 id={`${id}-withdrawn`}>{t('play.abandon.selfWithdrawn.title')}</h2>
          <p>{t('play.abandon.selfWithdrawn.body')}</p>
          <button type="button" className="button button--primary" data-testid="retract-withdrawal" disabled={busy}
            onClick={() => void guard(() => actions.retractWithdrawal())}>
            {t('play.leave.return')}
          </button>
        </section>
      )}

      {proposal && (() => {
        const voting = mustVote(room, proposal, selfId);
        const waiting = awaitingConsent(room, proposal);
        const youAgreed = selfId !== null && proposal.consents.includes(selfId);
        const absentNames = joinNames(locale, proposal.absent.map((playerId) => nicknameOf(room, playerId)));
        return (
          <section className={`prompt abandon-panel${voting ? ' prompt--mine' : ''}`} aria-labelledby={`${id}-vote`} data-testid="abandon-proposal">
            <h2 id={`${id}-vote`}>{t('play.abandon.vote.title')}</h2>
            <p data-testid="abandon-summary">
              {t('play.abandon.vote.body', { proposer: nicknameOf(room, proposal.proposedBy), players: absentNames })}
            </p>
            <p className="muted">{t('play.abandon.vote.note')}</p>
            {voting ? (
              <div className="abandon-panel__actions">
                <button type="button" className="button button--primary" data-testid="abandon-approve" disabled={busy}
                  onClick={() => void guard(() => actions.respondAbandon(proposal.id, true))}>
                  {t('play.abandon.approve')}
                </button>
                <button type="button" className="button" data-testid="abandon-reject" disabled={busy}
                  onClick={() => void guard(() => actions.respondAbandon(proposal.id, false))}>
                  {t('play.abandon.reject')}
                </button>
              </div>
            ) : (youAgreed || waiting.length > 0) && (
              <p className="muted" data-testid="abandon-waiting">
                {youAgreed && <>{t('play.abandon.youAgreed')} </>}
                {waiting.length > 0 && t('play.abandon.waiting', { players: joinNames(locale, waiting.map((member) => member.nickname)) })}
              </p>
            )}
          </section>
        );
      })()}

      {showHint && (
        <section className="prompt abandon-panel" aria-labelledby={`${id}-hint`} data-testid="withdrawn-hint">
          <h2 id={`${id}-hint`}>{t('play.abandon.hint.title')}</h2>
          <p>{t('play.abandon.hint.body', { players: joinNames(locale, others.map((member) => member.nickname)) })}</p>
          <button type="button" className="button" data-testid="abandon-propose" onClick={onPropose}>
            {t('play.leave.proposeEnd')}
          </button>
        </section>
      )}
    </>
  );
}
