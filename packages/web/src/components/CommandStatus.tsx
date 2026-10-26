import { canRetry, needsRefresh, needsResolve } from '../state/commands.ts';
import { translateNotice } from '../i18n/events.ts';
import { useLocale, useT } from '../i18n/context.tsx';
import type { TableController } from '../state/useTable.ts';

/**
 * Command lifecycle feedback (docs/SPEC.md §8.2/§8.4).
 *
 * The important product rule is encoded in the button set: while the outcome is
 * unknown the only offered action is "resolve the receipt"; a retry appears
 * only after a definitive rejection, and after a stale revision only after a
 * refresh.
 */
export function CommandStatus({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const command = state.command;
  if (!command) return null;

  const reason = command.error ? translateNotice(locale, command.error) : '';

  return (
    <div
      className={`command-status command-status--${command.status}`}
      data-testid="command-status"
      data-status={command.status}
      role="status"
      aria-live="polite"
    >
      {command.status === 'submitting' && <p>{t('command.submitting')}</p>}
      {command.status === 'unknown' && (
        <>
          <p>
            <strong>{t('command.unknownTitle')}</strong> {t('command.unknownHelp')}
          </p>
          <button type="button" className="button" onClick={() => void actions.resolveCommand()}>
            {t('command.resolve')}
          </button>
        </>
      )}
      {command.status === 'stale' && (
        <>
          <p>
            <strong>{t('command.staleTitle')}</strong> {t('command.staleHelp')}
          </p>
          <button type="button" className="button" onClick={() => void actions.refreshSnapshot()}>
            {t('app.refresh')}
          </button>
        </>
      )}
      {command.status === 'rejected' && (
        <>
          <p>{t('command.rejected', { reason })}</p>
          <p className="muted">{t('command.draftPreserved')}</p>
        </>
      )}
      {command.status === 'accepted' && <p>{t('command.accepted')}</p>}

      {needsResolve(command) && <span className="visually-hidden">{t('command.retryUnavailable')}</span>}
      {needsRefresh(command) && <span className="visually-hidden">{t('command.staleHelp')}</span>}

      <div className="command-status__actions">
        {canRetry(command) && (
          <button type="button" className="button" onClick={() => void actions.retryCommand()}>
            {t('command.retry')}
          </button>
        )}
        <button type="button" className="button button--ghost" onClick={() => actions.clearCommand()}>
          {t('app.dismiss')}
        </button>
      </div>
    </div>
  );
}
