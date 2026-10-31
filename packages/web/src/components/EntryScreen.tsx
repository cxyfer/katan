import { useState } from 'react';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { SoundSettings } from './SoundSettings.tsx';
import { GameIcon, GameLogo, IslandIllustration, PregameScene } from './GameArt.tsx';
import { useT } from '../i18n/context.tsx';
import type { ScreenProps } from './props.ts';

/**
 * First entry: nickname plus language switch (docs/SPEC.md §4.1, §8.7).
 *
 * The nickname lives in `draftNickname`, not in local component state, so
 * switching language cannot discard what the player already typed.
 */
export function EntryScreen({ controller }: ScreenProps) {
  const t = useT();
  const { state, dispatch, actions } = controller;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = state.config?.limits.nicknameMaxLength ?? 24;
  const draft = state.draftNickname;

  const submit = async () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError(t('entry.nicknameRequired'));
      return;
    }
    if (trimmed.length > max) {
      setError(t('entry.nicknameTooLong', { max }));
      return;
    }
    setError(null);
    setSubmitting(true);
    await actions.submitNickname(trimmed);
    setSubmitting(false);
  };

  return (
    <main className="screen screen--entry pregame" id="main">
      <PregameScene />
      <header className="pregame__topbar">
        <div className="pregame__topbar-end">
          <SoundSettings />
          <LanguageSwitch onChange={actions.setLocale} />
        </div>
      </header>

      <div className="entry-stage">
        <section className="entry-stage__title" aria-labelledby="entry-logo">
          <GameLogo id="entry-logo" />
          <p className="entry-stage__lede">{t('island.entry.title')}</p>
        </section>

        <div className="entry-stage__island"><IslandIllustration /></div>

        <section aria-labelledby="entry-heading" className="plaque entry-card">
          <h2 id="entry-heading" className="entry-card__heading">{t('entry.heading')}</h2>
          <p className="entry-card__intro">{t('entry.intro')}</p>
          <form
            className="entry-card__form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label htmlFor="nickname-input" className="visually-hidden">{t('entry.nicknameLabel')}</label>
            <input
              id="nickname-input"
              data-testid="nickname-input"
              name="nickname"
              type="text"
              autoComplete="nickname"
              maxLength={max + 8}
              placeholder={t('entry.nicknamePlaceholder')}
              value={draft}
              aria-invalid={error !== null}
              aria-describedby={error ? 'nickname-error' : undefined}
              onChange={(event) =>
                dispatch({ type: 'draft-nickname', value: event.target.value })
              }
            />
            <button type="submit" className="button button--primary button--hero" disabled={submitting}>
              {submitting ? t('app.loading') : t('entry.continue')}
              <GameIcon name="arrow-right" />
            </button>
          </form>
          {error && (
            <p className="error" id="nickname-error" role="alert">
              {error}
            </p>
          )}
          <ul className="entry-card__features">
            <li><GameIcon name="home" size={16} />{t('island.feature.build')}</li>
            <li><GameIcon name="trade" size={16} />{t('island.feature.trade')}</li>
            <li><GameIcon name="users" size={16} />{t('island.feature.together')}</li>
          </ul>
          <p className="entry-card__note"><GameIcon name="shield" size={16} />{t('entry.identityNote')}</p>
        </section>
      </div>
    </main>
  );
}
