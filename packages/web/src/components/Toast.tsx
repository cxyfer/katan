import { useEffect, useState } from 'react';
import type { Notice } from '@catan/protocol';
import { translateNotice } from '../i18n/events.ts';
import { useLocale, useT } from '../i18n/context.tsx';
import { TOAST_DISMISS_MS, useTransientNotice } from './useTransientNotice.ts';

/**
 * Non-blocking notice. It stays dismissible but no longer requires a click:
 * the timer clears it, and a turn switch clears anything from the old turn.
 */
export function Toast({
  notice,
  turnKey,
  onDismiss,
}: {
  notice: Notice | null;
  turnKey: string | null;
  onDismiss: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [focused, setFocused] = useState(false);
  const visible = useTransientNotice(notice, {
    timeoutMs: TOAST_DISMISS_MS,
    turnKey,
    dismissOnTurnChange: true,
    paused: focused,
    onDismiss,
  });
  useEffect(() => {
    if (!visible) setFocused(false);
  }, [visible]);
  if (!notice || !visible) return null;

  return (
    <div
      className="toast"
      role="status"
      data-testid="toast"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      <span>{translateNotice(locale, notice)}</span>
      <button type="button" className="button button--ghost" onClick={onDismiss}>
        {t('app.dismiss')}
      </button>
    </div>
  );
}
