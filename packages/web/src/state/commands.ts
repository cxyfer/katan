/**
 * Command submission lifecycle (docs/SPEC.md §8.2, §8.4).
 *
 * The single invariant that matters: a command whose outcome is not known must
 * be *resolved* before the UI offers a retry, and a retry after a definitive
 * rejection must use a **new** command id. Retrying an unknown command id is
 * safe because the server replays the stored receipt, but offering "try again"
 * on top of an unresolved command would invite a double submission.
 */

import type { CommandReceipt, Notice } from '@catan/protocol';

export type CommandStatus = 'submitting' | 'unknown' | 'rejected' | 'stale' | 'accepted';

export interface CommandPayload {
  type: string;
  [key: string]: unknown;
}

export interface PendingCommand {
  commandId: string;
  /** Message id describing the attempted action, for status text. */
  labelId: string;
  command: CommandPayload;
  status: CommandStatus;
  /** Server-supplied reason for `rejected`/`stale`. */
  error: Notice | null;
  /** Revision the command was submitted against. */
  baseRevision: number;
  /** Revision reported by the receipt, when one arrived. */
  revision: number | null;
}

export interface BeginCommand {
  kind: 'begin';
  commandId: string;
  labelId: string;
  command: CommandPayload;
  baseRevision: number;
}

export interface ReceiptCommand {
  kind: 'receipt';
  receipt: CommandReceipt;
}

export interface TransportFailure {
  kind: 'transport-failure';
  error: Notice;
}

export interface ClearCommand {
  kind: 'clear';
}

/** Emitted after a successful snapshot refresh, unblocking a stale retry. */
export interface RefreshedCommand {
  kind: 'refreshed';
}

export type CommandEvent =
  | BeginCommand
  | ReceiptCommand
  | TransportFailure
  | ClearCommand
  | RefreshedCommand;

/** Error message ids that mean "your view was stale", not "your move was bad". */
export const STALE_MESSAGE_ID = 'error.E_STALE_REVISION';

export function beginCommand(event: BeginCommand): PendingCommand {
  return {
    commandId: event.commandId,
    labelId: event.labelId,
    command: event.command,
    status: 'submitting',
    error: null,
    baseRevision: event.baseRevision,
    revision: null,
  };
}

export function applyReceipt(state: PendingCommand, receipt: CommandReceipt): PendingCommand {
  if (receipt.outcome === 'accepted') {
    return {
      ...state,
      status: 'accepted',
      error: null,
      revision: receipt.revision,
    };
  }
  const error = receipt.error ?? null;
  const stale = error?.messageId === STALE_MESSAGE_ID;
  return {
    ...state,
    status: stale ? 'stale' : 'rejected',
    error,
    revision: receipt.revision,
  };
}

export function applyTransportFailure(state: PendingCommand, error: Notice): PendingCommand {
  // Only an in-flight command can become "unknown": a receipt that already
  // arrived is authoritative even if a later request failed.
  if (state.status !== 'submitting') return state;
  return { ...state, status: 'unknown', error };
}

export function commandReducer(
  state: PendingCommand | null,
  event: CommandEvent,
): PendingCommand | null {
  switch (event.kind) {
    case 'clear':
      return null;
    case 'begin':
      return beginCommand(event);
    case 'receipt':
      return state ? applyReceipt(state, event.receipt) : null;
    case 'transport-failure':
      return state ? applyTransportFailure(state, event.error) : null;
    case 'refreshed':
      // A stale rejection becomes retryable only once the view is fresh.
      return state && state.status === 'stale' ? { ...state, status: 'rejected' } : state;
    default:
      return state;
  }
}

/** True while the receipt is unresolved and no new attempt may be offered. */
export function needsResolve(state: PendingCommand | null): boolean {
  return state?.status === 'unknown';
}

/** True when the client must refetch the snapshot before offering a retry. */
export function needsRefresh(state: PendingCommand | null): boolean {
  return state?.status === 'stale';
}

/**
 * A retry is offered only after a definitive rejection. `submitting`,
 * `unknown` and `stale` all block it (resolve / refresh first).
 */
export function canRetry(state: PendingCommand | null): boolean {
  return state?.status === 'rejected';
}

export function isBusy(state: PendingCommand | null): boolean {
  return state?.status === 'submitting';
}

export function blocksNewCommands(state: PendingCommand | null): boolean {
  return state?.status === 'submitting' || state?.status === 'unknown';
}
