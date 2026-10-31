import { useEffect, useRef, useState } from 'react';

/** Accepted receipts are quiet confirmations; they clear quickly. */
export const ACCEPTED_RECEIPT_MS = 4_000;
/** A rejection keeps its reason and retry affordance on screen longer. */
export const REJECTED_RECEIPT_MS = 8_000;
/** Non-blocking toasts disappear without user action. */
export const TOAST_DISMISS_MS = 6_000;

interface TransientNoticeOptions {
  /** `null` keeps the notice until the user dismisses it. */
  timeoutMs?: number | null;
  turnKey?: string | null;
  dismissOnTurnChange?: boolean;
  onDismiss?: () => void;
}

/**
 * Visibility for non-blocking feedback. The notice's `key` is its identity:
 * a command id, or the notice object itself. Comparing identity rather than
 * text means the same message can appear again with a fresh deadline.
 *
 * A notice shown before the active turn changed disappears with that turn.
 * A notice that arrives *with* the change keeps its own lifetime: the timeout
 * effect records the turn before the turn-change effect evaluates it.
 */
export function useTransientNotice<T>(
  key: T | null,
  { timeoutMs = null, turnKey = null, dismissOnTurnChange = false, onDismiss }: TransientNoticeOptions = {},
): boolean {
  const [dismissed, setDismissed] = useState<T | null>(null);
  const appearedTurn = useRef<string | null>(null);
  const previousTurn = useRef<string | null>(turnKey);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (key == null) {
      appearedTurn.current = null;
      return;
    }
    // Captured here on purpose: a later turn change must not extend the deadline.
    appearedTurn.current = turnKey;
    if (timeoutMs == null) return;
    const timer = globalThis.setTimeout(() => {
      setDismissed(key);
      dismissRef.current?.();
    }, timeoutMs);
    return () => globalThis.clearTimeout(timer);
  }, [key, timeoutMs]);

  useEffect(() => {
    if (previousTurn.current === turnKey) return;
    previousTurn.current = turnKey;
    if (!dismissOnTurnChange || key == null || appearedTurn.current === turnKey) return;
    setDismissed(key);
    dismissRef.current?.();
  }, [dismissOnTurnChange, key, turnKey]);

  return key != null && key !== dismissed;
}
