import { useId, useState } from 'react';
import type { RoomView, SuspendProposalView } from '@catan/protocol';
import { useLocale, useT } from '../i18n/context.tsx';
import { awaitingResume, awaitingSuspendConsent, joinNames, nicknameOf, selfMemberOf } from '../state/leave.ts';
import type { TableController } from '../state/useTable.ts';
import '../styles/leave.css';

/**
 * 全桌保存並暫停（SPEC §4.8）在牌桌上的狀態橫幅：進行中的暫停投票，以及暫停後的「準備繼續」。
 *
 * 與結束對局投票一樣放在訊息欄，不會被可關閉的工具面板蓋住。提議入口在離開對話框。
 */
export function SuspendPanel({ controller }: { controller: TableController }) {
  const room = controller.state.room;
  if (!room) return null;
  if (room.status === 'suspended') return <ResumeBar controller={controller} room={room} />;
  const proposal = room.status === 'playing' ? room.pendingSuspend ?? null : null;
  // 換了一個提案就重新開始，不沿用上一個提案的按鈕狀態。
  return proposal ? <SuspendVote key={proposal.id} controller={controller} room={room} proposal={proposal} /> : null;
}

function useBusy(): [boolean, (action: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const guard = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  return [busy, guard];
}

/** 進行中的暫停投票。暫停可以再繼續，所以「同意」不需要像結束對局那樣再確認一次。 */
function SuspendVote({ controller, room, proposal }: {
  controller: TableController;
  room: RoomView;
  proposal: SuspendProposalView;
}) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const { state, actions } = controller;
  const [busy, guard] = useBusy();
  const selfId = state.session?.id ?? null;
  const seated = selfMemberOf(room, selfId) !== null;
  const youAgreed = selfId !== null && proposal.consents.includes(selfId);
  const voting = seated && !youAgreed;
  const waiting = awaitingSuspendConsent(room, proposal).filter((member) => member.playerId !== selfId);
  const proposer = proposal.proposedBy === selfId;

  return (
    <section className={`prompt abandon-panel suspend-panel${voting ? ' prompt--mine' : ''}`} aria-labelledby={`${id}-vote`}
      data-testid="suspend-proposal">
      <h2 id={`${id}-vote`}>{t('play.suspendVote.title')}</h2>
      <p data-testid="suspend-summary">{t('play.suspendVote.body', { proposer: nicknameOf(room, proposal.proposedBy) })}</p>
      <p className="muted">{t('play.suspendVote.note')}</p>
      {voting ? (
        <div className="abandon-panel__actions">
          <button type="button" className="button button--primary" data-testid="suspend-approve" disabled={busy}
            onClick={() => void guard(() => actions.respondSuspend(proposal.id, true))}>
            {t('play.suspendVote.approve')}
          </button>
          <button type="button" className="button" data-testid="suspend-reject" disabled={busy}
            onClick={() => void guard(() => actions.respondSuspend(proposal.id, false))}>
            {t('play.suspendVote.reject')}
          </button>
        </div>
      ) : (
        <>
          <p className="muted" data-testid="suspend-waiting">
            {youAgreed && <>{t('play.suspendVote.youAgreed')} </>}
            {waiting.length > 0 && t('play.suspendVote.waiting', { players: joinNames(locale, waiting.map((member) => member.nickname)) })}
          </p>
          {proposer && (
            <div className="abandon-panel__actions">
              <button type="button" className="button" data-testid="suspend-withdraw" disabled={busy}
                onClick={() => void guard(() => actions.respondSuspend(proposal.id, false))}>
                {t('play.suspendVote.withdraw')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 暫停中：所有真人都連線並表示準備好才會繼續；已準備的人可以收回。 */
function ResumeBar({ controller, room }: { controller: TableController; room: RoomView }) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const { state, actions } = controller;
  const [busy, guard] = useBusy();
  const selfId = state.session?.id ?? null;
  const seated = selfMemberOf(room, selfId) !== null;
  const selfReady = selfId !== null && (room.resumeReady ?? []).includes(selfId);
  const waiting = awaitingResume(room).filter((member) => member.playerId !== selfId);

  return (
    <section className="prompt abandon-panel suspend-panel" aria-labelledby={`${id}-suspended`} data-testid="resume-bar"
      data-ready={selfReady ? 'true' : 'false'}>
      <h2 id={`${id}-suspended`}>{t('play.suspendedBar.title')}</h2>
      <p>{t('play.suspendedBar.body')}</p>
      {selfReady && waiting.length > 0 && (
        <p className="muted" role="status" data-testid="resume-waiting">
          {t('play.resumeWaiting', { players: joinNames(locale, waiting.map((member) => member.nickname)) })}
        </p>
      )}
      {seated && (
        <div className="abandon-panel__actions">
          {selfReady ? (
            <button type="button" className="button" data-testid="resume-not-ready" disabled={busy}
              onClick={() => void guard(() => actions.resumeTable(false))}>
              {t('play.resumeNotReady')}
            </button>
          ) : (
            <button type="button" className="button button--primary" data-testid="resume-ready" disabled={busy}
              onClick={() => void guard(() => actions.resumeTable(true))}>
              {t('play.resumeReady')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
