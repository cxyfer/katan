import { useEffect } from 'react';
import { canRetry, needsRefresh, needsResolve, type CommandStatus as Status } from '../state/commands.ts';
import { translateNotice } from '../i18n/events.ts';
import { useLocale, useT } from '../i18n/context.tsx';
import { activeTurnKey } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { GameIcon } from './GameArt.tsx';
import { NoticeDismiss } from './NoticeDismiss.tsx';
import {
  ACCEPTED_RECEIPT_MS,
  REJECTED_RECEIPT_MS,
  useNoticeHold,
  useTransientNotice,
} from './useTransientNotice.ts';

const TONE: Record<Status, { tone: string; icon: string }> = {
  submitting: { tone: 'pending', icon: 'refresh' },
  unknown: { tone: 'warning', icon: 'help' },
  stale: { tone: 'warning', icon: 'refresh' },
  rejected: { tone: 'error', icon: 'alert' },
  accepted: { tone: 'success', icon: 'check' },
};

/**
 * Command lifecycle feedback (docs/SPEC.md §8.2/§8.4).
 *
 * The important product rule is encoded in the button set: while the outcome is
 * unknown the only offered action is "resolve the receipt"; a retry appears
 * only after a definitive rejection, and after a stale revision only after a
 * refresh. Accepted and rejected feedback clears on its own (the rejection
 * shows its countdown around the close button); unknown/stale recovery stays
 * until it is resolved.
 */
export function CommandStatus({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const command = state.command;
  const receiptMs = command?.status === 'accepted' ? ACCEPTED_RECEIPT_MS
    : command?.status === 'rejected' ? REJECTED_RECEIPT_MS : null;
  const noticeKey = command ? `${command.commandId}:${command.status}` : null;
  const hold = useNoticeHold<HTMLDivElement>(noticeKey);
  const { visible, leaving, held, dismiss } = useTransientNotice(noticeKey, {
    timeoutMs: receiptMs,
    turnKey: activeTurnKey(state),
    dismissOnTurnChange: receiptMs != null,
    paused: hold.held,
  });
  useEffect(() => {
    // 右上訊息欄可捲動；新回執出現時捲到可見處，避免「再試一次」落在可視範圍外。
    if (visible) hold.ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [noticeKey, visible, hold.ref]);
  if (!command || !visible) return null;

  const { tone, icon } = TONE[command.status];
  const reason = command.error ? translateNotice(locale, command.error) : '';
  const recovery = command.status === 'unknown' || command.status === 'stale';
  const retry = canRetry(command);
  const headline = {
    submitting: t('command.submitting'),
    unknown: t('command.unknownTitle'),
    stale: t('command.staleTitle'),
    rejected: t('command.rejected', { reason: reason || '—' }),
    accepted: t('command.accepted'),
  }[command.status];
  const help = command.status === 'unknown' ? t('command.unknownHelp')
    : command.status === 'stale' ? t('command.staleHelp') : '';

  return (
    <div
      ref={hold.ref}
      className={`command-status command-status--${command.status} notice-card notice-card--${tone}`}
      data-testid="command-status"
      data-status={command.status}
      data-leaving={leaving ? 'true' : undefined}
      role="status"
      aria-live="polite"
      {...hold.handlers}
    >
      <span className="notice-card__icon"><GameIcon name={icon} size={16} /></span>
      <p className="notice-card__title">{headline}</p>
      {command.status !== 'accepted' && (
        <NoticeDismiss
          timeoutMs={receiptMs}
          paused={held}
          run={noticeKey ?? undefined}
          onClick={() => dismiss(() => actions.clearCommand())}
        />
      )}
      {(help || retry || recovery) && <div className="notice-card__detail">
        {help && <p className="notice-card__text">{help}</p>}

        {needsResolve(command) && <span className="visually-hidden">{t('command.retryUnavailable')}</span>}
        {needsRefresh(command) && <span className="visually-hidden">{t('command.staleHelp')}</span>}

        {(recovery || retry) && <div className="command-status__actions">
          {command.status === 'unknown' && (
            <button
              type="button"
              className="button"
              data-testid="command-resolve"
              onClick={() => void actions.resolveCommand()}
            >
              {t('command.resolve')}
            </button>
          )}
          {command.status === 'stale' && (
            <button
              type="button"
              className="button"
              data-testid="command-refresh"
              onClick={() => void actions.refreshSnapshot()}
            >
              {t('app.refresh')}
            </button>
          )}
          {retry && (
            <button
              type="button"
              className="button"
              data-testid="command-retry"
              onClick={() => void actions.retryCommand()}
            >
              {t('command.retry')}
            </button>
          )}
          {command.status === 'rejected' && <span className="muted">{t('command.draftPreserved')}</span>}
        </div>}
      </div>}
    </div>
  );
}
