import { useMemo } from 'react';
import { AudioProvider, useAudio } from './audio/context.tsx';
import type { AudioEngine, MusicScene } from './audio/engine.ts';
import { useGameSounds } from './audio/useGameSounds.ts';
import { LocaleProvider } from './i18n/context.tsx';
import { browserStorage } from './state/session.ts';
import type { Screen } from './state/table.ts';
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

export interface AppServices extends UseTableOptions {
  /** 音效引擎；省略時（例如測試）整個 App 保持安靜。 */
  audio?: AudioEngine;
}

/** 牌桌上播放島嶼主題，其餘畫面（入口、大廳、結算）播放港口主題。 */
function musicScene(screen: Screen): MusicScene {
  return screen === 'game' ? 'island' : 'harbor';
}

/**
 * Application root.
 *
 * All I/O is injected through `services`, so the whole SPA can be rendered in a
 * test with a fake API and no server, and the production entry only has to
 * supply `fetch`-backed defaults.
 */
export function App({ services }: { services: AppServices }) {
  const controller = useTable(services);
  const storage = useMemo(() => services.storage ?? browserStorage(), [services.storage]);
  return (
    <LocaleProvider locale={controller.state.locale}>
      <AudioProvider engine={services.audio} storage={storage} scene={musicScene(controller.state.screen)}>
        <AppShell controller={controller} />
      </AudioProvider>
    </LocaleProvider>
  );
}

function AppShell({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state } = controller;
  useGameSounds(state, useAudio());

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
