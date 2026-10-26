import { LocaleProvider } from './i18n/context.tsx';
import { useTable, type UseTableOptions } from './state/useTable.ts';
import { useT } from './i18n/context.tsx';
import { translateNotice } from './i18n/events.ts';
import { useLocale } from './i18n/context.tsx';
import { EntryScreen } from './components/EntryScreen.tsx';
import { HomeScreen } from './components/HomeScreen.tsx';
import { LobbyScreen } from './components/LobbyScreen.tsx';
import { GameScreen } from './components/GameScreen.tsx';
import { ResultScreen } from './components/ResultScreen.tsx';
import type { TableController } from './state/useTable.ts';

/**
 * Application root.
 *
 * All I/O is injected through `services`, so the whole SPA can be rendered in a
 * test with a fake API and no server, and the production entry only has to
 * supply `fetch`-backed defaults.
 */
export function App({ services }: { services: UseTableOptions }) {
  const controller = useTable(services);
  return (
    <LocaleProvider locale={controller.state.locale}>
      <AppShell controller={controller} />
    </LocaleProvider>
  );
}

function AppShell({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state } = controller;

  return (
    <>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>

      {!state.bootstrapped && <p className="muted">{t('app.loading')}</p>}

      {state.bootstrapped && state.screen === 'entry' && <EntryScreen controller={controller} />}
      {state.bootstrapped && state.screen === 'home' && <HomeScreen controller={controller} />}
      {state.bootstrapped && state.screen === 'lobby' && <LobbyScreen controller={controller} />}
      {state.bootstrapped && state.screen === 'game' && <GameScreen controller={controller} />}
      {state.bootstrapped && state.screen === 'result' && <ResultScreen controller={controller} />}

      {state.fatal && (
        <div className="notice notice--error" role="alert" data-testid="recovery-blocked">
          <strong>{t('play.recoveryBlocked')}</strong>
          <p>{t('play.recoveryBlockedHelp')}</p>
          <p className="muted">{translateNotice(locale, state.fatal)}</p>
        </div>
      )}

      {state.toast && (
        <div className="toast" role="status" data-testid="toast">
          <span>{translateNotice(locale, state.toast)}</span>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => controller.dispatch({ type: 'toast', notice: null })}
          >
            {t('app.dismiss')}
          </button>
        </div>
      )}
    </>
  );
}
