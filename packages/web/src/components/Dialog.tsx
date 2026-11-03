import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/context.tsx';

/**
 * Modal dialog with the two accessibility behaviours that are easy to miss:
 * focus moves into the dialog on open, and returns to the element that opened
 * it on close (docs/SPEC.md §8.5, "dialog focus return").
 *
 * The backdrop is portalled out of the table chrome: `.game-tools` carries a
 * `translate` (safe-area insets) and the tool surface clips overflow, either
 * of which would anchor the fixed backdrop to the floating panel instead of
 * the viewport. Fullscreen also only paints the fullscreen element's subtree.
 */
export function Dialog({
  title,
  onClose,
  children,
  testId,
  labelledBy,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  labelledBy?: string;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    restoreRef.current = typeof document === 'undefined' ? null : document.activeElement;
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      const previous = restoreRef.current;
      if (previous && typeof (previous as HTMLElement).focus === 'function') {
        (previous as HTMLElement).focus();
      }
    };
  }, [onClose]);

  const titleId = labelledBy ?? 'dialog-title';

  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
        {...(testId ? { 'data-testid': testId } : {})}
      >
        <header className="dialog__header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="button button--ghost"
            aria-label={t('app.close')}
            onClick={onClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="dialog__body">{children}</div>
      </div>
    </div>,
    document.fullscreenElement ?? document.body,
  );
}
