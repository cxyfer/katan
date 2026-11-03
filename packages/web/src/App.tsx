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
import { BootScreen } from './components/BootScreen.tsx';
import { EntryScreen } from './components/EntryScreen.tsx';
import { HomeScreen } from './components/HomeScreen.tsx';
import { LobbyScreen } from './components/LobbyScreen.tsx';
import { GameScreen } from './components/GameScreen.tsx';
import { ResultScreen } from './components/ResultScreen.tsx';
import { Toast } from './components/Toast.tsx';
import { activeTurnKey } from './state/table.ts';
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
  // 必要資源下載失敗時沒有樣式可用，停在啟動畫面的失敗提示。
  const ready = state.bootstrapped && state.boot.assets !== 'failed';

  return (
    <>
      {/* 啟動畫面沒有可略過的內容；樣式表失敗時這個連結也沒有隱藏樣式。 */}
      {ready && (
        <a className="skip-link" href="#main">
          {t('app.skipToContent')}
        </a>
      )}

      {!ready && <BootScreen boot={state.boot} />}

      {ready && state.screen === 'entry' && <EntryScreen controller={controller} />}
      {ready && state.screen === 'home' && <HomeScreen controller={controller} />}
      {ready && state.screen === 'lobby' && <LobbyScreen controller={controller} />}
      {ready && state.screen === 'game' && <GameScreen controller={controller} />}
      {ready && state.screen === 'result' && <ResultScreen controller={controller} />}

      {state.fatal && (
        <div className="notice notice--error" role="alert" data-testid="recovery-blocked">
          <strong>{t('play.recoveryBlocked')}</strong>
          <p>{t('play.recoveryBlockedHelp')}</p>
          <p className="muted">{translateNotice(locale, state.fatal)}</p>
        </div>
      )}

      <Toast
        notice={state.toast}
        toastId={state.toastId}
        turnKey={activeTurnKey(state)}
        onDismiss={() => controller.dispatch({ type: 'toast', notice: null })}
      />
    </>
  );
}
