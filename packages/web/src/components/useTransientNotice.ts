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
  /** A focused control must not disappear mid-interaction. */
  paused?: boolean;
  onDismiss?: () => void;
}

/**
 * Visibility for non-blocking feedback. The notice's `key` is its identity:
 * a command id plus status, or the notice object itself. Comparing identity
 * rather than text means the same message can appear again with a fresh
 * deadline, and a receipt that changes outcome gets its own visibility.
 *
 * A notice shown before the active turn changed disappears with that turn.
 * A notice that arrives *with* the change keeps its own lifetime: the timeout
 * effect records the turn before the turn-change effect evaluates it.
 */
export function useTransientNotice<T>(
  key: T | null,
  {
    timeoutMs = null,
    turnKey = null,
    dismissOnTurnChange = false,
    paused = false,
    onDismiss,
  }: TransientNoticeOptions = {},
): boolean {
  const [dismissed, setDismissed] = useState<T | null>(null);
  const appearedTurn = useRef<string | null>(null);
  const previousTurn = useRef<string | null>(turnKey);
  const keyRef = useRef<T | null>(key);
  const turnKeyRef = useRef<string | null>(turnKey);
  const lastKey = useRef<T | null>(null);
  const dismissRef = useRef(onDismiss);
  keyRef.current = key;
  turnKeyRef.current = turnKey;
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (key == null) {
      appearedTurn.current = null;
      lastKey.current = null;
      setDismissed(null);
      return;
    }
    if (lastKey.current !== key) {
      lastKey.current = key;
      // Captured here on purpose: a later turn change must not extend the deadline.
      appearedTurn.current = turnKeyRef.current;
    }
    if (timeoutMs == null || paused) return;
    const timer = globalThis.setTimeout(() => {
      // The passive cleanup for an older key may not have run yet. Never let
      // its deadline dismiss the notice that replaced it.
      if (keyRef.current !== key) return;
      setDismissed(key);
      dismissRef.current?.();
    }, timeoutMs);
    return () => globalThis.clearTimeout(timer);
  }, [key, paused, timeoutMs]);

  useEffect(() => {
    if (previousTurn.current === turnKey) return;
    previousTurn.current = turnKey;
    if (!dismissOnTurnChange || key == null || appearedTurn.current === turnKey) return;
    setDismissed(key);
    dismissRef.current?.();
  }, [dismissOnTurnChange, key, turnKey]);

  return key != null && key !== dismissed;
}
