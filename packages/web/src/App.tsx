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
import { Toast } from './components/Toast.tsx';
import { activeTurnKey } from './state/table.ts';
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

      <Toast
        notice={state.toast}
        turnKey={activeTurnKey(state)}
        onDismiss={() => controller.dispatch({ type: 'toast', notice: null })}
      />
    </>
  );
}
