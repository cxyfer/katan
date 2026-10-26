import { useEffect, useState } from 'react';
import { useT } from '../i18n/context.tsx';
import { requiredActionAnnouncement, requiredActionFor } from '../state/pending.ts';
import type { TableController } from '../state/useTable.ts';
import { ActionBar } from './ActionBar.tsx';
import { BoardView } from './BoardView.tsx';
import { GameTools } from './GameTools.tsx';
import { CommandStatus } from './CommandStatus.tsx';
import { DevCardPanel } from './DevCardPanel.tsx';
import { HandPanel } from './HandPanel.tsx';
import { PendingPrompt } from './PendingPrompt.tsx';
import { PlayersPanel } from './PlayersPanel.tsx';
import { PolicyProposalPanel } from './PolicyProposalPanel.tsx';
import { SelectionPreview } from './SelectionPreview.tsx';
import { StatusStrip } from './StatusStrip.tsx';
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

      <PolicyProposalPanel controller={controller} />

      <div className="game__grid">
        <div className="game__center">
          {!isMobile && <PlayersPanel controller={controller} />}
          <BoardView controller={controller} />
          <SelectionPreview controller={controller} />
          {!isMobile && (
            <div className="game__inventory">
              <HandPanel controller={controller} />
              <DevCardPanel controller={controller} />
            </div>
          )}
          {isMobile && <PlayersPanel controller={controller} />}
        </div>

        {!isMobile && (
          <aside className="game__side game__side--right" aria-label={t('play.hints')}>
            <ActionBar controller={controller} />
            <GameTools controller={controller} />
          </aside>
        )}
      </div>

      {isMobile && <MobileDrawer controller={controller} />}

      <section className="card persistence" aria-labelledby="persistence-heading" data-testid="persistence-bar">
        <h2 id="persistence-heading">{t('play.save')}</h2>
        <p className="muted">{t('entry.identityNote')}</p>
        <button
          type="button"
          className="button"
          data-testid="save-and-leave"
          disabled={state.save.status === 'pending'}
          onClick={() => void controller.actions.saveGame()}
        >
          {state.save.status === 'pending' ? t('play.savePending') : t('play.saveAndLeave')}
        </button>
        <button
          type="button"
          className="button"
          data-testid="suspend-propose"
          onClick={() => void controller.actions.suspendGame()}
        >
          {t('play.suspendPropose')}
        </button>
        {state.save.status === 'failed' && (
          <p className="error" role="alert" data-testid="save-failed">
            {t('play.saveFailed')}
          </p>
        )}
      </section>
    </div>
  );
}
