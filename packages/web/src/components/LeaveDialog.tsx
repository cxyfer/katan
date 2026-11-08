import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '../i18n/context.tsx';
import {
  abandonmentAllowed,
  absentOthers,
  isSelfWithdrawn,
  isSoloTable,
  joinNames,
  selfMemberOf,
} from '../state/leave.ts';
import type { TableController } from '../state/useTable.ts';
import { Dialog } from './Dialog.tsx';
import { GameIcon } from './GameArt.tsx';
import '../styles/leave.css';

export type LeaveStep = 'choose' | 'end' | 'withdraw';

/**
 * 離開對局（SPEC §4.6、§4.8）：牌桌上所有離開相關的操作只從這裡進入。保存並離開、全桌暫停、
 * 退出（投降）與結束對局是不同的事，不可逆的退出與結束都要在對話框內再確認一次。
 *
 * 單人桌（其餘座位皆為電腦）只問「保留」或「結束」；多人桌另有「提議全桌保存並暫停」與「退出」，
 * 並在有人缺席時提供「提議結束」。房間資料尚未載入時只提供保存並離開，其餘資格交給伺服器載入後再判斷。
 */
export function LeaveDialog({ controller, initialStep = 'choose', onClose }: {
  controller: TableController;
  initialStep?: LeaveStep;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const room = state.room;
  const selfId = state.session?.id ?? null;

  const solo = isSoloTable(room, selfId);
  const self = selfMemberOf(room, selfId);
  const withdrawn = isSelfWithdrawn(room, selfId);
  const allowed = abandonmentAllowed(room);
  const absent = absentOthers(room, selfId);
  const absentNames = joinNames(locale, absent.map((member) => member.nickname));
  // 多人桌的提議資格：政策允許、有其他真人缺席或已退出（全桌暫停中只算已退出），且自己是在線、未退出的投票者。
  const canProposeEnd = !solo && allowed && absent.length > 0 && self !== null && self.connected && !withdrawn;
  const knownTable = room !== null && self !== null;
  const suspended = room?.status === 'suspended';
  // 全桌暫停只對多人桌有意義（單人桌離開時電腦本來就不會繼續下）；已有提案時改在牌桌橫幅表態。
  const canProposeSuspend = knownTable && !solo && room.status === 'playing' && !room.pendingSuspend;

  const [step, setStep] = useState<LeaveStep>(
    initialStep === 'end' && !(solo ? allowed : canProposeEnd) ? 'choose' : initialStep,
  );
  const [busy, setBusy] = useState(false);
  const stepRef = useRef<HTMLDivElement>(null);
  const saving = state.save.status === 'pending';

  // 換步驟後原本的按鈕已卸載，把焦點移到新步驟，讀屏才會接著念新內容。
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepRef.current?.focus();
  }, [step]);

  // 保存並離開、退出要等伺服器處理完離開才會換畫面；這段期間不能關掉對話框或再按其他選項。
  const busyRef = useRef(false);
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    busyRef.current = true;
    const succeeded = await action();
    busyRef.current = false;
    setBusy(false);
    if (succeeded) onClose();
  };
  const guardedClose = useCallback(() => {
    if (!busyRef.current) onClose();
  }, [onClose]);
  const working = busy || saving;

  const cancel = (
    <button type="button" className="button button--ghost" data-testid="leave-cancel" disabled={busy} onClick={onClose}>
      {t('app.cancel')}
    </button>
  );
  const back = (
    <button type="button" className="button button--ghost" data-testid="leave-back" disabled={busy} onClick={() => setStep('choose')}>
      {t('app.back')}
    </button>
  );
  const workingNote = working && (
    <p className="muted" role="status" data-testid="leave-working">{t('play.leave.working')}</p>
  );
  const saveFailed = state.save.status === 'failed' && (
    <p className="error" role="alert" data-testid="leave-save-failed">{t('play.saveFailed')}</p>
  );
  // 回來時要用同一個瀏覽器：離開前提醒座位綁定的範圍。
  const identityNote = <p className="muted leave-identity" data-testid="leave-identity">{t('entry.identityNote')}</p>;
  const keepButton = (label: string, help: string, primary = true) => (
    <div className="leave-option">
      <button type="button" className={primary ? 'button button--primary' : 'button'} data-testid="leave-keep"
        aria-describedby="leave-keep-help" disabled={working}
        onClick={() => void run(async () => { await actions.saveGame(); return false; })}>
        <GameIcon name="anchor" />{saving ? t('play.savePending') : label}
      </button>
      <p className="muted" id="leave-keep-help">{help}</p>
    </div>
  );

  let body;
  if (step === 'end') {
    body = (
      <div className="leave-step" ref={stepRef} tabIndex={-1} data-testid="leave-confirm-end" aria-labelledby="leave-end-heading">
        <h3 id="leave-end-heading">{t('play.leave.confirmEnd.heading')}</h3>
        <p>{solo ? t('play.leave.confirmEnd.solo') : t('play.leave.confirmEnd.multi', { players: absentNames })}</p>
        {workingNote}
        <div className="form-actions">
          <button type="button" className="button button--primary leave-danger" data-testid="leave-end-confirm" disabled={busy}
            onClick={() => void run(() => actions.endGame())}>
            {solo ? t('play.leave.confirmEnd.submitSolo') : t('play.leave.confirmEnd.submitMulti')}
          </button>
          {back}
        </div>
      </div>
    );
  } else if (step === 'withdraw') {
    body = (
      <div className="leave-step" ref={stepRef} tabIndex={-1} data-testid="leave-confirm-withdraw" aria-labelledby="leave-withdraw-heading">
        <h3 id="leave-withdraw-heading">{t('play.leave.confirmWithdraw.heading')}</h3>
        <p>{t('play.leave.confirmWithdraw.body')}</p>
        {allowed && <p className="muted">{t('play.leave.withdrawEndsWhenAll')}</p>}
        {workingNote}
        <div className="form-actions">
          <button type="button" className="button button--primary leave-danger" data-testid="leave-withdraw-confirm" disabled={busy}
            onClick={() => void run(() => actions.withdrawGame())}>
            {t('play.leave.confirmWithdraw.submit')}
          </button>
          {back}
        </div>
      </div>
    );
  } else if (solo) {
    body = (
      <div className="leave-step" ref={stepRef} tabIndex={-1}>
        <p>{t('play.leave.soloIntro')}</p>
        {keepButton(t('play.leave.keepSolo'), t('play.leave.keepSoloHelp'))}
        <div className="leave-option">
          <button type="button" className="button leave-danger" data-testid="leave-end" disabled={busy || !allowed}
            aria-describedby="leave-end-help" onClick={() => setStep('end')}>
            <GameIcon name="flag" />{t('play.leave.endSolo')}
          </button>
          <p className="muted" id="leave-end-help" data-testid={allowed ? undefined : 'leave-end-disabled'}>
            {allowed ? t('play.leave.endSoloHelp') : t('play.leave.endDisabled')}
          </p>
        </div>
        {workingNote}
        {saveFailed}
        {identityNote}
        <div className="form-actions">{cancel}</div>
      </div>
    );
  } else if (withdrawn) {
    body = (
      <div className="leave-step" ref={stepRef} tabIndex={-1}>
        <p>{t('play.leave.withdrawnIntro')}</p>
        <div className="leave-option">
          <button type="button" className="button button--primary" data-testid="leave-return" disabled={busy}
            aria-describedby="leave-return-help" onClick={() => void run(() => actions.retractWithdrawal())}>
            <GameIcon name="arrow-right" />{t('play.leave.return')}
          </button>
          <p className="muted" id="leave-return-help">{t('play.leave.returnHelp')}</p>
        </div>
        {keepButton(t('play.saveAndLeave'), t('play.leave.keepMultiHelp'), false)}
        {workingNote}
        {saveFailed}
        {identityNote}
        <div className="form-actions">{cancel}</div>
      </div>
    );
  } else {
    body = (
      <div className="leave-step" ref={stepRef} tabIndex={-1}>
        <p>{t(suspended ? 'play.leave.suspendedIntro' : 'play.leave.multiIntro')}</p>
        {keepButton(t('play.saveAndLeave'), t(suspended ? 'play.leave.keepSuspendedHelp' : 'play.leave.keepMultiHelp'))}
        {canProposeSuspend && (
          <div className="leave-option">
            <button type="button" className="button" data-testid="leave-suspend" disabled={working}
              aria-describedby="leave-suspend-help" onClick={() => void run(() => actions.suspendGame())}>
              <GameIcon name="pause" />{t('play.leave.suspend')}
            </button>
            <p className="muted" id="leave-suspend-help">{t('play.leave.suspendHelp')}</p>
          </div>
        )}
        {knownTable && (
          <div className="leave-option">
            <button type="button" className="button leave-danger" data-testid="leave-withdraw" disabled={busy}
              aria-describedby="leave-withdraw-help" onClick={() => setStep('withdraw')}>
              <GameIcon name="exit" />{t('play.leave.withdraw')}
            </button>
            <p className="muted" id="leave-withdraw-help">{t('play.leave.withdrawHelp')}</p>
          </div>
        )}
        {canProposeEnd && (
          <div className="leave-option">
            <button type="button" className="button leave-danger" data-testid="leave-propose-end" disabled={busy}
              aria-describedby="leave-propose-help" onClick={() => setStep('end')}>
              <GameIcon name="flag" />{t('play.leave.proposeEnd')}
            </button>
            <p className="muted" id="leave-propose-help">{t('play.leave.proposeEndHelp', { players: absentNames })}</p>
          </div>
        )}
        {workingNote}
        {saveFailed}
        {identityNote}
        <div className="form-actions">{cancel}</div>
      </div>
    );
  }

  return (
    <Dialog title={t('play.leave.title')} onClose={guardedClose} testId="leave-dialog">
      {body}
    </Dialog>
  );
}
