import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';

/** Accepted receipts are quiet confirmations; they clear quickly. */
export const ACCEPTED_RECEIPT_MS = 4_000;
/** A rejection keeps its reason and retry affordance on screen longer. */
export const REJECTED_RECEIPT_MS = 8_000;
/** Non-blocking toasts disappear without user action. */
export const TOAST_DISMISS_MS = 6_000;
/** 淡出動畫長度；通知播完淡出後才自 DOM 移除。 */
export const NOTICE_EXIT_MS = 180;

interface TransientNoticeOptions {
  /** `null` keeps the notice until the user dismisses it. */
  timeoutMs?: number | null;
  turnKey?: string | null;
  dismissOnTurnChange?: boolean;
  /** Hover or focus inside the notice holds the deadline. */
  paused?: boolean;
  onDismiss?: () => void;
}

export interface TransientNotice {
  /** The notice is mounted (including while it fades out). */
  visible: boolean;
  /** The exit animation is playing; the element is removed afterwards. */
  leaving: boolean;
  /** The deadline is on hold (hover, focus or a hidden tab). */
  held: boolean;
  /** Fade the notice out, then run `then` (default: `onDismiss`). */
  dismiss: (then?: () => void) => void;
}

/**
 * Visibility for non-blocking feedback. The notice's `key` is its identity:
 * a command id plus status, or the toast run id. Comparing identity rather
 * than text means the same message can appear again with a fresh deadline,
 * and a receipt that changes outcome gets its own visibility.
 *
 * A notice shown before the active turn changed fades out with that turn.
 * A notice that arrives *with* the change keeps its own lifetime: the timeout
 * effect records the turn before the turn-change effect evaluates it.
 *
 * The deadline is held while `paused` or while the document is hidden, and
 * the remaining time is preserved rather than restarted.
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
): TransientNotice {
  const [dismissed, setDismissed] = useState<T | null>(null);
  const [leaving, setLeaving] = useState<T | null>(null);
  const hidden = useDocumentHidden();
  const held = paused || hidden;
  const appearedTurn = useRef<string | null>(null);
  const previousTurn = useRef<string | null>(turnKey);
  const keyRef = useRef<T | null>(key);
  const turnKeyRef = useRef<string | null>(turnKey);
  const lastKey = useRef<T | null>(null);
  const lastTimeout = useRef<number | null>(timeoutMs);
  const remaining = useRef<number | null>(timeoutMs);
  const deadline = useRef<number | null>(null);
  const leavingRef = useRef<T | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissRef = useRef(onDismiss);
  keyRef.current = key;
  turnKeyRef.current = turnKey;
  dismissRef.current = onDismiss;

  const leave = useCallback((target: T, then?: () => void) => {
    if (leavingRef.current === target) return;
    leavingRef.current = target;
    setLeaving(target);
    exitTimer.current = globalThis.setTimeout(() => {
      exitTimer.current = null;
      // A newer notice replaced this one during the fade; leave it alone.
      if (keyRef.current !== target) return;
      setDismissed(target);
      (then ?? dismissRef.current)?.();
    }, NOTICE_EXIT_MS);
  }, []);

  useEffect(() => () => {
    if (exitTimer.current != null) globalThis.clearTimeout(exitTimer.current);
  }, []);

  useEffect(() => {
    if (key == null) {
      appearedTurn.current = null;
      lastKey.current = null;
      lastTimeout.current = null;
      remaining.current = null;
      deadline.current = null;
      leavingRef.current = null;
      setDismissed(null);
      setLeaving(null);
      return;
    }
    if (lastKey.current !== key) {
      // Dismissal and fading belong to one appearance; an identity that comes
      // back after another notice is a new appearance.
      leavingRef.current = null;
      setDismissed(null);
    }
    if (lastKey.current !== key || lastTimeout.current !== timeoutMs) {
      lastKey.current = key;
      lastTimeout.current = timeoutMs;
      remaining.current = timeoutMs;
      deadline.current = null;
      // Captured here on purpose: a later turn change must not extend the deadline.
      appearedTurn.current = turnKeyRef.current;
    }
    if (timeoutMs == null || held) return;
    const delay = remaining.current ?? timeoutMs;
    const end = Date.now() + delay;
    deadline.current = end;
    const timer = globalThis.setTimeout(() => {
      // The passive cleanup for an older key may not have run yet. Never let
      // its deadline dismiss the notice that replaced it.
      if (keyRef.current !== key) return;
      remaining.current = 0;
      deadline.current = null;
      leave(key);
    }, delay);
    return () => {
      globalThis.clearTimeout(timer);
      if (deadline.current != null) {
        remaining.current = Math.max(0, deadline.current - Date.now());
        deadline.current = null;
      }
    };
  }, [key, held, timeoutMs, leave]);

  useEffect(() => {
    if (previousTurn.current === turnKey) return;
    previousTurn.current = turnKey;
    if (!dismissOnTurnChange || key == null || appearedTurn.current === turnKey) return;
    leave(key);
  }, [dismissOnTurnChange, key, turnKey, leave]);

  const dismiss = useCallback((then?: () => void) => {
    const current = keyRef.current;
    if (current != null) leave(current, then);
  }, [leave]);

  const visible = key != null && key !== dismissed;
  return { visible, leaving: visible && key === leaving, held, dismiss };
}

/**
 * Hover and focus inside a notice hold its deadline, so a control never
 * disappears under the pointer or the keyboard. `identity` changes when the
 * notice is replaced: a status change can remove the hovered/focused control
 * without a leave/blur event, so the hold is kept only while the pointer or
 * focus is still inside.
 */
export function useNoticeHold<E extends HTMLElement>(identity: unknown) {
  const ref = useRef<E>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element?.contains(document.activeElement)) setFocused(false);
    if (!element || !isHovered(element)) setHovered(false);
  }, [identity]);
  return {
    ref,
    held: hovered || focused,
    handlers: {
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocusCapture: () => setFocused(true),
      onBlurCapture: (event: FocusEvent<E>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      },
    },
  };
}

function isHovered(element: Element): boolean {
  try {
    return element.matches(':hover');
  } catch {
    return false;
  }
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}
