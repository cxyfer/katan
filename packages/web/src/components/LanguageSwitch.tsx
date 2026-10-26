import type { Locale } from '@catan/protocol';
import { SUPPORTED_LOCALES } from '../i18n/catalogs.ts';
import { useLocale, useT } from '../i18n/context.tsx';

/**
 * Language switch available from first entry, the lobby and in-game settings.
 * It only changes the display locale: no draft, selection or pending command id
 * is discarded (docs/SPEC.md §8.7).
 */
export function LanguageSwitch({
  onChange,
  testId = 'locale-switch',
}: {
  onChange: (locale: Locale) => void;
  testId?: string;
}) {
  const locale = useLocale();
  const t = useT();
  return (
    <label className="language-switch">
      <span className="language-switch__label">{t('app.language')}</span>
      <select
        data-testid={testId}
        aria-label={t('app.language')}
        value={locale}
        onChange={(event) => onChange(event.target.value as Locale)}
      >
        {SUPPORTED_LOCALES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {t(`locale.${candidate}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
