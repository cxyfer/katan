/**
 * React binding for the message catalogs. The provider value is only the
 * locale, so changing language re-renders text without touching any draft,
 * selection or pending command id held in the table state.
 */

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { Locale } from '@catan/protocol';
import { DEFAULT_LOCALE, t } from './index.ts';

export const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export type Translate = (messageId: string, params?: Record<string, unknown>) => string;

export function useT(): Translate {
  const locale = useLocale();
  return useCallback<Translate>((messageId, params) => t(locale, messageId, params), [locale]);
}
