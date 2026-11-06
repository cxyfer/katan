import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/context.tsx';
import { requiredActionAnnouncement, requiredActionFor } from '../state/pending.ts';
import type { TableController } from '../state/useTable.ts';
import { AbandonPanel } from './AbandonPanel.tsx';
import { ActionRail } from './ActionRail.tsx';
import '../styles/side-layout.css';
import { BoardView } from './BoardView.tsx';
import { GameTools } from './GameTools.tsx';
import { GameIcon } from './GameArt.tsx';
import { CommandStatus } from './CommandStatus.tsx';
import { HandPanel } from './HandPanel.tsx';
import { LeaveDialog, type LeaveStep } from './LeaveDialog.tsx';
import { PendingPrompt } from './PendingPrompt.tsx';
import { PlayersPanel } from './PlayersPanel.tsx';
import { PolicyProposalPanel } from './PolicyProposalPanel.tsx';
import { RotatePrompt } from './RotatePrompt.tsx';
import { SelectionPreview } from './SelectionPreview.tsx';
import { StatusStrip } from './StatusStrip.tsx';
import { useFullscreen } from './useFullscreen.ts';
import { COMPACT_LANDSCAPE_QUERY, useIsMobile } from './useIsMobile.ts';
import { useAutoDeclineTrades } from './useAutoDeclineTrades.ts';
import { useDevCardChoice } from './useDevCardChoice.ts';
import '../styles/compact-landscape.css';
import '../styles/mobile-hand.css';

/** 同一張遊戲桌涵蓋橫屏與直屏，切換尺寸不卸載手牌或工具草稿。 */
export function GameScreen({ controller }: { controller: TableController }) {
  const t = useT();
  const { state } = controller;
  const stageRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(stageRef);
  const action = requiredActionFor(state);
  const [announcement, setAnnouncement] = useState('');
  const narrow = useIsMobile('(max-width: 649px)');
  const compactLandscape = useIsMobile(COMPACT_LANDSCAPE_QUERY);
  const [activeRail, setActiveRail] = useState<'players' | 'actions' | null>(null);
  const openPlayers = useCallback(() => setActiveRail('players'), []);
  const openActions = useCallback(() => setActiveRail('actions'), []);
  // 離開對話框：null 為關閉；橫幅的「提議結束」直接停在確認步驟。
  const [leaveStep, setLeaveStep] = useState<LeaveStep | null>(null);
  const openLeave = useCallback(() => setLeaveStep('choose'), []);
  const proposeEnd = useCallback(() => setLeaveStep('end'), []);
  const closeLeave = useCallback(() => setLeaveStep(null), []);
  // 交易面板收起時（手機抽屜）仍要套用「自動拒絕」偏好。
  useAutoDeclineTrades(controller);
  // 壟斷／豐收之年的資源選擇：失效時關閉，豐收之年確認後逐張領取。
  useDevCardChoice(controller);

  useEffect(() => {
    const next = requiredActionAnnouncement(action, t);
    // A completed discarder no longer owes an action; leaving the previous
    // announcement in place would keep telling assistive tech to discard
    // (docs/SPEC.md §4.4).
    setAnnouncement(next ? t(next.messageId, next.params) : '');
  }, [action, t]);

  const suspended = state.room?.status === 'suspended';
  const interrupted = state.room?.status === 'playing' && state.connection !== 'online';

  return (
    <div className="screen screen--game" id="main" data-testid="game-stage" data-board-stage="" data-layout={compactLandscape ? 'compact-landscape' : undefined}
      data-hand-dock={narrow || compactLandscape ? 'tally' : undefined} ref={stageRef}>
      <div className="table-atmosphere" aria-hidden="true">
        <svg className="table-atmosphere__coast" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
          <path d="M0 110 100 165 130 230 70 300 145 380 100 455 0 510Z" fill="#082d32" />
          <path d="M0 95 80 130 115 200 65 290 110 350 60 415 0 430Z" fill="#173d38" />
          <path d="M1600 160 1510 210 1540 280 1445 365 1500 430 1440 500 1600 590Z" fill="#092e32" />
          <path d="M1600 140 1535 185 1560 260 1500 330 1550 395 1510 450 1600 480Z" fill="#193e38" />
          <g fill="none" stroke="#7faaa0" strokeWidth="1.5" opacity=".25">
            <path d="M18 470q85 25 145-15M1415 490q75-30 152 0M45 500q60 16 105-3M1405 520q100-30 165 0M200 240q80-20 130 0M1210 660q70-18 130 0M310 600q45-14 80 0" />
            <ellipse cx="800" cy="470" rx="535" ry="320" strokeDasharray="3 12" />
            <ellipse cx="800" cy="470" rx="565" ry="345" />
          </g>
          <g stroke="#cbd3b0" fill="none" strokeWidth="2" opacity=".55"><path d="m250 155 8-5 8 5m12 10 7-5 7 5M1320 180l8-5 8 5m12-10 7-5 7 5" /></g>
        </svg>
        <div className="table-atmosphere__compass"><GameIcon name="compass" size={150} /></div>
      </div>

      <StatusStrip controller={controller} fullscreen={fullscreen} onLeave={openLeave} />
      <div aria-live="polite" role="status" className="visually-hidden" data-testid="live-region">{announcement}</div>
      {fullscreen.failed && <p className="table-fullscreen-error notice" role="alert">{t('table.fullscreenFailed')}</p>}

      <div className="game__table">
        <PlayersPanel controller={controller} onExpand={openPlayers} collapseRequested={narrow && activeRail === 'actions'}
          floatingTurnFlag={narrow && activeRail === 'actions'} />
        <div className="game__playfield">
          <div className="game__messages">
            <PendingPrompt controller={controller} />
            {state.activeElsewhere && <p className="notice notice--warning" data-testid="active-elsewhere" role="alert">{t('app.activeInAnotherTab')} — {t('app.activeInAnotherTabHelp')}</p>}
            {(suspended || interrupted) && <div className="notice" data-testid="resume-bar">
              <p>{t(suspended ? 'play.suspended' : 'play.interrupted')}</p>
              <button type="button" className="button" data-testid="resume-ready" onClick={() => void controller.actions.resumeTable(true)}>{t('play.resumeReady')}</button>
            </div>}
            {state.command?.status !== 'accepted' && <CommandStatus controller={controller} />}
            <PolicyProposalPanel controller={controller} />
            <AbandonPanel controller={controller} onPropose={proposeEnd} />
          </div>
          <div className="game__map"><BoardView controller={controller} /></div>
          <div className="game__preview"><SelectionPreview controller={controller} /></div>
          <ActionRail controller={controller} onExpand={openActions} collapseRequested={narrow && activeRail === 'players'} />
        </div>
        <footer className="game__dock">
          <HandPanel controller={controller} />
        </footer>
        {state.command?.status === 'accepted' && <div className="game__receipt" data-testid="accepted-notice"><CommandStatus controller={controller} /></div>}
      </div>

      <GameTools controller={controller} />
      <details className="game__menu" data-testid="table-menu" onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}>
        <summary aria-label={t('table.settings')} title={t('table.settings')}><GameIcon name="settings" size={21} /><span>{t('table.settings')}</span></summary>
        <section className="persistence" aria-labelledby="persistence-heading" data-testid="persistence-bar">
          <h2 id="persistence-heading">{t('table.settings')}</h2>
          <p className="muted">{t('entry.identityNote')}</p>
          <button type="button" className="button" data-testid="save-and-leave" disabled={state.save.status === 'pending'} onClick={() => void controller.actions.saveGame()}>{state.save.status === 'pending' ? t('play.savePending') : t('play.saveAndLeave')}</button>
          <button type="button" className="button button--ghost" data-testid="suspend-propose" onClick={() => void controller.actions.suspendGame()}>{t('play.suspendPropose')}</button>
          {state.save.status === 'failed' && <p className="error" role="alert" data-testid="save-failed">{t('play.saveFailed')}</p>}
        </section>
      </details>
      {leaveStep && <LeaveDialog controller={controller} initialStep={leaveStep} onClose={closeLeave} />}
      <p className="game__orientation"><GameIcon name="refresh" size={14} />{t('table.landscapeHint')}</p>
      <RotatePrompt />
    </div>
  );
}
