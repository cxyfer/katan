import { useEffect, useState } from 'react';
import { useT } from '../i18n/context.tsx';
import { requiredActionAnnouncement, requiredActionFor } from '../state/pending.ts';
import type { TableController } from '../state/useTable.ts';
import { ActionBar } from './ActionBar.tsx';
import { BoardView } from './BoardView.tsx';
import { ChatPanel } from './ChatPanel.tsx';
import { CommandStatus } from './CommandStatus.tsx';
import { DevCardPanel } from './DevCardPanel.tsx';
import { EventLog } from './EventLog.tsx';
import { HandPanel } from './HandPanel.tsx';
import { PendingPrompt } from './PendingPrompt.tsx';
import { PlayersPanel } from './PlayersPanel.tsx';
import { SelectionPreview } from './SelectionPreview.tsx';
import { StatusStrip } from './StatusStrip.tsx';
import { TradePanel } from './TradePanel.tsx';
import { MobileDrawer } from './MobileDrawer.tsx';
import { useIsMobile } from './useIsMobile.ts';

/**
 * Play surface (docs/SPEC.md §8.1).
 *
 * Layout contract: the required-action prompt, the status strip and the
 * command-status region are siblings of the board and of the drawer — never
 * inside a closable panel — so a player can always see what is mandatory and
 * whether the table is reachable.
 */
export function GameScreen({ controller }: { controller: TableController }) {
  const t = useT();
  const isMobile = useIsMobile();
  const { state } = controller;
  const action = requiredActionFor(state);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const next = requiredActionAnnouncement(action, t);
    if (next) setAnnouncement(t(next.messageId, next.params));
  }, [action, t]);

  const suspended = state.room?.status === 'suspended';
  const interrupted = state.room?.status === 'playing' && state.connection !== 'online';

  return (
    <div className="screen screen--game" id="main">
      <StatusStrip controller={controller} />

      <div aria-live="polite" role="status" className="visually-hidden" data-testid="live-region">
        {announcement}
      </div>

      <PendingPrompt controller={controller} />

      {state.activeElsewhere && (
        <p className="notice notice--warning" data-testid="active-elsewhere" role="alert">
          {t('app.activeInAnotherTab')} — {t('app.activeInAnotherTabHelp')}
        </p>
      )}

      {(suspended || interrupted) && (
        <div className="notice" data-testid="resume-bar">
          <p>{t(suspended ? 'play.suspended' : 'play.interrupted')}</p>
          <button
            type="button"
            className="button"
            data-testid="resume-ready"
            onClick={() => void controller.actions.resumeTable(true)}
          >
            {t('play.resumeReady')}
          </button>
        </div>
      )}

      <CommandStatus controller={controller} />

      <div className="game__grid">
        {!isMobile && (
          <div className="game__side game__side--left">
            <PlayersPanel controller={controller} />
            <EventLog controller={controller} />
          </div>
        )}

        <div className="game__center">
          <BoardView controller={controller} />
          <SelectionPreview controller={controller} />
        </div>

        {!isMobile && (
          <div className="game__side game__side--right">
            <ActionBar controller={controller} />
            <HandPanel controller={controller} />
            <DevCardPanel controller={controller} />
            <TradePanel controller={controller} />
          </div>
        )}

        {isMobile && (
          <div className="game__side game__side--left">
            <PlayersPanel controller={controller} />
          </div>
        )}
      </div>

      {isMobile && <MobileDrawer controller={controller} />}

      {!isMobile && <ChatPanel controller={controller} />}
    </div>
  );
}
