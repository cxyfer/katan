import { useState } from 'react';
import { LanguageSwitch } from './LanguageSwitch.tsx';
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
      <header className="screen__header">
        <h1>{t('app.title')}</h1>
        <p className="muted">{t('app.tagline')}</p>
        <LanguageSwitch onChange={actions.setLocale} />
      </header>

      <section aria-labelledby="entry-heading" className="card">
        <h2 id="entry-heading">{t('entry.heading')}</h2>
        <p>{t('entry.intro')}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
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
          {error && (
            <p className="error" id="nickname-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button button--primary" disabled={submitting}>
            {submitting ? t('app.loading') : t('entry.continue')}
          </button>
        </form>
        <p className="muted">{t('entry.identityNote')}</p>
      </section>
    </main>
  );
}
