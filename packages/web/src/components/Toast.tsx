import type { Notice } from '@catan/protocol';
import { translateNotice } from '../i18n/events.ts';
import { useLocale } from '../i18n/context.tsx';
import { GameIcon } from './GameArt.tsx';
import { NoticeDismiss } from './NoticeDismiss.tsx';
import { TOAST_DISMISS_MS, useNoticeHold, useTransientNotice } from './useTransientNotice.ts';

/**
 * Non-blocking notice. It closes on its own after a countdown shown around the
 * close button, holds while hovered or focused, and fades out with the turn
 * it belonged to.
 */
export function Toast({
  notice,
  toastId,
  turnKey,
  onDismiss,
}: {
  notice: Notice | null;
  toastId: number;
  turnKey: string | null;
  onDismiss: () => void;
}) {
  const locale = useLocale();
  const key = notice ? toastId : null;
  const hold = useNoticeHold<HTMLDivElement>(key);
  const { visible, leaving, held, dismiss } = useTransientNotice(key, {
    timeoutMs: TOAST_DISMISS_MS,
    turnKey,
    dismissOnTurnChange: true,
    paused: hold.held,
    onDismiss,
  });
  if (!notice || !visible) return null;
  const tone = notice.messageId.startsWith('error.') ? 'error' : 'info';

  return (
    <div
      ref={hold.ref}
      className={`toast notice-card notice-card--${tone}`}
      role="status"
      data-testid="toast"
      data-tone={tone}
      data-leaving={leaving ? 'true' : undefined}
      {...hold.handlers}
    >
      <span className="notice-card__icon"><GameIcon name={tone === 'error' ? 'alert' : 'info'} size={16} /></span>
      <p className="notice-card__text">{translateNotice(locale, notice)}</p>
      <NoticeDismiss
        timeoutMs={TOAST_DISMISS_MS}
        paused={held}
        run={toastId}
        onClick={() => dismiss()}
      />
    </div>
  );
}
