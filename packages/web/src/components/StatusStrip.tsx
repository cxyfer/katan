import { useT } from '../i18n/context.tsx';
import { formatDateTime } from '../i18n/format.ts';
import { requiredActionFor } from '../state/pending.ts';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import type { TableController } from '../state/useTable.ts';

const CONNECTION_LABEL: Record<string, string> = {
  online: 'app.online',
  offline: 'app.offline',
  reconnecting: 'app.reconnecting',
};

const CONNECTION_GLYPH: Record<string, string> = {
  online: '●',
  offline: '✕',
  reconnecting: '◐',
};

/**
 * Compact status strip: connectivity, save state and the current obligation.
 * It stays visible on every viewport and is never inside the mobile drawer
 * (docs/SPEC.md §8.1/§8.4).
 */
export function StatusStrip({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const action = requiredActionFor(state);
  const save = state.save;

  return (
    <header className="status-strip" data-testid="status-strip">
      <span
        className={`status-strip__item status-strip__item--${state.connection}`}
        data-testid="connection-state"
        data-state={state.connection}
      >
        <span aria-hidden="true">{CONNECTION_GLYPH[state.connection] ?? '?'}</span>{' '}
        {t(CONNECTION_LABEL[state.connection] ?? 'app.online')}
      </span>

      <span className="status-strip__item" data-testid="save-state" data-state={save.status}>
        {save.status === 'idle' && t('play.save')}
        {save.status === 'pending' && t('play.savePending')}
        {save.status === 'saved' && t('play.saveSaved')}
        {save.status === 'failed' && t('play.saveFailed')}
      </span>

      {save.status === 'saved' && (
        <span className="status-strip__item muted" data-testid="save-time">
          {t('play.saveLastSavedAt', {
            time: formatDateTime(state.locale, save.savedAt),
            revision: save.revision,
          })}
        </span>
      )}

      <span className="status-strip__item" data-testid="turn-state" data-mine={action?.mine ? 'true' : 'false'}>
        {action ? t(action.messageId, action.params) : t('app.loading')}
      </span>

      <span className="status-strip__spacer" />
      <LanguageSwitch onChange={actions.setLocale} testId="locale-switch-game" />
    </header>
  );
}
