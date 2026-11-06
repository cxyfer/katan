import { useT } from '../i18n/context.tsx';
import { formatDateTime } from '../i18n/format.ts';
import { requiredActionFor } from '../state/pending.ts';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { SoundSettings } from './SoundSettings.tsx';
import { GameBrand, GameIcon } from './GameArt.tsx';
import type { TableController } from '../state/useTable.ts';
import '../styles/leave.css';

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
 * It stays visible on every viewport and is never inside a closable tool surface
 * (docs/SPEC.md §8.1/§8.4).
 */
export function StatusStrip({ controller, fullscreen, onLeave }: {
  controller: TableController;
  fullscreen?: { active: boolean; supported: boolean; toggle: () => Promise<void> };
  /** 牌桌專用：開啟離開對話框。結果畫面不傳，就不顯示離開鈕。 */
  onLeave?: () => void;
}) {
  const t = useT();
  const { state, actions } = controller;
  const action = requiredActionFor(state);
  const save = state.save;

  return (
    <header className="status-strip" data-testid="status-strip">
      <GameBrand compact />
      <span
        className={`status-strip__item status-strip__item--${state.connection}`}
        data-testid="connection-state"
        data-state={state.connection}
      >
        <span aria-hidden="true">{CONNECTION_GLYPH[state.connection] ?? '?'}</span>{' '}
        {t(CONNECTION_LABEL[state.connection] ?? 'app.online')}
      </span>

      <span className="status-strip__item status-strip__save" data-testid="save-state" data-state={save.status}>
        <GameIcon name="anchor" size={15} />
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

      <span className="visually-hidden" data-testid="turn-state" data-mine={action?.mine ? 'true' : 'false'}>
        {action ? t(action.messageId, action.params) : t('app.loading')}
      </span>

      <span className="status-strip__spacer" />
      <SoundSettings testId="sound-settings-game" />
      <LanguageSwitch onChange={actions.setLocale} testId="locale-switch-game" />
      {fullscreen && <button
        type="button"
        className="button table-fullscreen"
        data-testid="toggle-fullscreen"
        aria-label={t(fullscreen.active ? 'table.exitFullscreen' : 'table.fullscreen')}
        aria-pressed={fullscreen.active}
        disabled={!fullscreen.supported}
        title={t(!fullscreen.supported ? 'table.fullscreenUnavailable' : fullscreen.active ? 'table.exitFullscreen' : 'table.fullscreen')}
        onClick={() => void fullscreen.toggle()}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={fullscreen.active ? 'M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5' : 'M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5'} /></svg>
        <span>{t(fullscreen.active ? 'table.exitFullscreen' : 'table.fullscreen')}</span>
      </button>}
      {onLeave && <button
        type="button"
        className="button table-leave"
        data-testid="leave-game"
        aria-label={t('table.leaveGame')}
        title={t('table.leaveGame')}
        onClick={onLeave}
      >
        <GameIcon name="exit" size={19} />
        <span>{t('table.leave')}</span>
      </button>}
    </header>
  );
}
