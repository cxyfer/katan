import { useEffect, useId, useRef } from 'react';
import { useAudio } from '../audio/context.tsx';
import type { AudioPreferences } from '../audio/preferences.ts';
import { useT } from '../i18n/context.tsx';
import { GameIcon } from './GameArt.tsx';
import '../styles/sound-settings.css';

/** 會改變滑桿數值的按鍵；放開時試聽一次新的音量。 */
const VALUE_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

const SLIDERS = [
  { key: 'effects', label: 'audio.effects', preview: 'build.settlement' },
  { key: 'music', label: 'audio.music', preview: null },
] as const;

/**
 * 音效設定彈出面板：靜音、效果音量、音樂音量與試聽。與語言切換並排出現在
 * 入口、大廳與牌桌，任何畫面都能立即靜音（docs/SPEC.md §8.2）。
 */
export function SoundSettings({ testId = 'sound-settings' }: { testId?: string }) {
  const t = useT();
  const { supported, preferences, updatePreferences, play } = useAudio();
  const ref = useRef<HTMLDetailsElement>(null);
  const headingId = useId();
  const silent = preferences.muted || !supported;

  // 點擊面板外或按 Escape 收合，焦點回到觸發按鈕。
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  const setLevel = (key: keyof Pick<AudioPreferences, 'effects' | 'music'>, value: number) => {
    updatePreferences({ [key]: value, ...(value > 0 && preferences.muted ? { muted: false } : {}) });
  };

  return (
    <details className="sound-settings" ref={ref} data-testid={testId} data-muted={silent ? 'true' : 'false'}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }}>
      <summary className="sound-settings__toggle" aria-label={t('audio.settingsOpen')} title={t('audio.settingsOpen')}>
        <GameIcon name={silent ? 'sound-off' : 'sound'} size={19} />
        <span className="sound-settings__summary-label">{t('audio.settings')}</span>
      </summary>
      <section className="sound-settings__panel" aria-labelledby={headingId}>
        <h2 id={headingId} className="sound-settings__title">{t('audio.settingsOpen')}</h2>
        {!supported && <p className="sound-settings__note notice notice--warning" data-testid="sound-unavailable">{t('audio.unavailable')}</p>}
        <label className="sound-settings__mute">
          <input type="checkbox" checked={preferences.muted} disabled={!supported} data-testid="sound-mute"
            onChange={(event) => updatePreferences({ muted: event.target.checked })} />
          <span>{t('audio.mute')}</span>
          <span className="sound-settings__state" aria-hidden="true">{t(preferences.muted ? 'audio.muted' : 'audio.on')}</span>
        </label>
        {SLIDERS.map(({ key, label, preview }) => (
          <label key={key} className="sound-settings__slider">
            <span className="sound-settings__slider-label">
              <span>{t(label)}</span>
              {/* 數值已由 aria-valuetext 朗讀；output 隱含 live region，隱藏以免拖曳時每一格都被播報。 */}
              <output aria-hidden="true">{t('audio.level', { value: preferences[key] })}</output>
            </span>
            <input type="range" min={0} max={100} step={5} value={preferences[key]} disabled={!supported}
              data-testid={`sound-${key}`} aria-valuetext={t('audio.level', { value: preferences[key] })}
              onChange={(event) => setLevel(key, Number(event.target.value))}
              onPointerUp={() => { if (preview) play(preview); }}
              onKeyUp={(event) => { if (preview && VALUE_KEYS.has(event.key)) play(preview); }} />
          </label>
        ))}
        <button type="button" className="button button--ghost sound-settings__test" disabled={silent || preferences.effects === 0}
          data-testid="sound-test" onClick={() => play('turn.yours')}>
          <GameIcon name="sound" size={16} />{t('audio.test')}
        </button>
        <p className="sound-settings__note muted">{t('audio.note')}</p>
      </section>
    </details>
  );
}
