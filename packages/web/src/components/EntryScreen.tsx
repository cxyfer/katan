import { useState } from 'react';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { GameBrand, GameIcon, IslandIllustration } from './GameArt.tsx';
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
    <main className="screen screen--entry" id="main">
      <header className="screen__header game-header">
        <GameBrand />
        <LanguageSwitch onChange={actions.setLocale} />
      </header>

      <div className="entry-layout">
        <section className="hero hero--entry" aria-labelledby="entry-hero-heading">
          <div className="hero__copy">
            <p className="hero__eyebrow"><GameIcon name="compass" />{t('island.entry.eyebrow')}</p>
            <h1 className="hero__title" id="entry-hero-heading">{t('island.entry.title')}</h1>
            <p className="hero__description">{t('island.entry.description')}</p>
            <ul className="hero__features">
              <li><GameIcon name="home" />{t('island.feature.build')}</li>
              <li><GameIcon name="trade" />{t('island.feature.trade')}</li>
              <li><GameIcon name="users" />{t('island.feature.together')}</li>
            </ul>
          </div>
          <div className="hero__art"><IslandIllustration /></div>
        </section>

        <section aria-labelledby="entry-heading" className="card entry-card">
          <div className="section-heading">
            <span className="section-heading__icon"><GameIcon name="ship" size={26} /></span>
            <div className="section-heading__copy">
              <p className="hero__eyebrow">{t('island.entry.cardEyebrow')}</p>
              <h2 id="entry-heading">{t('entry.heading')}</h2>
            </div>
          </div>
          <p className="muted">{t('entry.intro')}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="field">
              <label htmlFor="nickname-input">{t('entry.nicknameLabel')}</label>
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
            </div>
            {error && (
              <p className="error" id="nickname-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button button--primary" disabled={submitting}>
              {submitting ? t('app.loading') : t('entry.continue')}
              <GameIcon name="arrow-right" />
            </button>
          </form>
          <p className="entry-card__note muted"><GameIcon name="shield" />{t('entry.identityNote')}</p>
        </section>
      </div>
    </main>
  );
}
