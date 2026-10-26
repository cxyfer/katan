import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Modal dialog with the two accessibility behaviours that are easy to miss:
 * focus moves into the dialog on open, and returns to the element that opened
 * it on close (docs/SPEC.md §8.5, "dialog focus return").
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

  return (
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
          <button type="button" className="button button--ghost" onClick={onClose}>
            {/* Label is injected by the caller through `children` context; the
                visible text here stays a symbol so no catalog key is needed. */}
            ✕
          </button>
        </header>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  );
}
