import type { CSSProperties } from 'react';

export type NoticeProgressVariant = 'accepted' | 'rejected' | 'toast';

/**
 * Depleting strip that shows how long a transient notice will remain.
 *
 * The strip is decorative: the text already has a live region, and a progress
 * bar that updates continuously must not be announced. Its duration and paused
 * state mirror the notice's JavaScript timer.
 */
export function NoticeProgress({
  timeoutMs,
  paused,
  variant,
}: {
  timeoutMs: number;
  paused: boolean;
  variant: NoticeProgressVariant;
}) {
  const style: CSSProperties = {
    animationDuration: `${timeoutMs}ms`,
    animationPlayState: paused ? 'paused' : 'running',
  };
  return (
    <span
      className={`notice-progress notice-progress--${variant}`}
      data-testid="notice-progress"
      data-paused={paused ? 'true' : 'false'}
      aria-hidden="true"
      style={style}
    />
  );
}
