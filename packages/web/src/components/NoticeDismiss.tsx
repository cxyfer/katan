import type { CSSProperties } from 'react';
import { useT } from '../i18n/context.tsx';
import { GameIcon } from './GameArt.tsx';
import '../styles/notices.css';

/**
 * Close control for a notice. When the notice dismisses itself, a ring around
 * the × depletes over the deadline, so the countdown reads as "this closes on
 * its own" and the button is the way to close it sooner.
 *
 * The ring is decorative (the text already sits in a live region); its
 * duration and paused state mirror the notice's JavaScript timer. `run` is the
 * notice identity: a new notice restarts the ring without remounting the
 * button, so keyboard focus is not lost.
 */
export function NoticeDismiss({
  timeoutMs = null,
  paused = false,
  run,
  onClick,
}: {
  timeoutMs?: number | null;
  paused?: boolean;
  run?: string | number;
  onClick: () => void;
}) {
  const t = useT();
  const label = t('app.close');
  const style = {
    '--notice-countdown': `${timeoutMs ?? 0}ms`,
    animationPlayState: paused ? 'paused' : 'running',
  } as CSSProperties;
  return (
    <button
      type="button"
      className="notice-dismiss"
      data-testid="notice-dismiss"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {timeoutMs != null && (
        <svg className="notice-dismiss__ring" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
          <circle className="notice-dismiss__track" cx="18" cy="18" r="16" />
          <circle
            key={run}
            className="notice-dismiss__timer"
            data-testid="notice-countdown"
            data-paused={paused ? 'true' : 'false'}
            cx="18"
            cy="18"
            r="16"
            pathLength={100}
            style={style}
          />
        </svg>
      )}
      <GameIcon name="close" size={14} />
    </button>
  );
}
