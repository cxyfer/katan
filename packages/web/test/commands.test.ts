import { describe, expect, it } from 'vitest';
import {
  applyReceipt,
  applyTransportFailure,
  beginCommand,
  blocksNewCommands,
  canRetry,
  commandReducer,
  isBusy,
  needsRefresh,
  needsResolve,
  type PendingCommand,
} from '../src/state/commands.ts';
import { parseApiResult, NETWORK_ERROR } from '../src/api/client.ts';

const begin = beginCommand({
  kind: 'begin',
  commandId: 'cmd-1',
  labelId: 'play.roll',
  command: { type: 'turn.roll' },
  baseRevision: 12,
});

describe('command lifecycle', () => {
  it('starts submitting and is not retryable yet', () => {
    expect(begin.status).toBe('submitting');
    expect(isBusy(begin)).toBe(true);
    expect(canRetry(begin)).toBe(false);
    expect(needsResolve(begin)).toBe(false);
  });

  it('marks a transport failure as unknown and blocks a retry', () => {
    const unknown = applyTransportFailure(begin, NETWORK_ERROR);
    expect(unknown.status).toBe('unknown');
    expect(needsResolve(unknown)).toBe(true);
    expect(canRetry(unknown)).toBe(false);
    expect(unknown.error?.messageId).toBe('error.E_NETWORK');
  });

  it('never downgrades a settled receipt because a later request failed', () => {
    const accepted = applyReceipt(begin, {
      commandId: 'cmd-1',
      outcome: 'accepted',
      revision: 13,
      events: [],
    });
    const afterFailure = applyTransportFailure(accepted, NETWORK_ERROR);
    expect(afterFailure.status).toBe('accepted');
    expect(afterFailure.revision).toBe(13);
  });

  it('separates a definitive rejection from a stale revision', () => {
    const rejected = applyReceipt(begin, {
      commandId: 'cmd-1',
      outcome: 'rejected',
      revision: 12,
      error: { messageId: 'error.E_INSUFFICIENT_RESOURCES' },
      events: [],
    });
    expect(rejected.status).toBe('rejected');
    expect(canRetry(rejected)).toBe(true);
    // A rejected receipt is informational: hiding it must not gate a new action.
    expect(blocksNewCommands(rejected)).toBe(false);

    const stale = applyReceipt(begin, {
      commandId: 'cmd-1',
      outcome: 'rejected',
      revision: 15,
      error: { messageId: 'error.E_STALE_REVISION' },
      events: [],
    });
    expect(stale.status).toBe('stale');
    expect(needsRefresh(stale)).toBe(true);
    expect(canRetry(stale)).toBe(false);
  });

  it('allows a retry only after the view has been refreshed', () => {
    const stale: PendingCommand = {
      ...begin,
      status: 'stale',
      error: { messageId: 'error.E_STALE_REVISION' },
    };
    const refreshed = commandReducer(stale, { kind: 'refreshed' });
    expect(refreshed?.status).toBe('rejected');
    expect(canRetry(refreshed)).toBe(true);
    // Refreshing must not resurrect an unrelated state.
    expect(commandReducer(null, { kind: 'refreshed' })).toBeNull();
    expect(commandReducer(begin, { kind: 'refreshed' })?.status).toBe('submitting');
  });

  it('clears on demand and ignores receipts without a pending command', () => {
    expect(commandReducer(begin, { kind: 'clear' })).toBeNull();
    expect(
      commandReducer(null, { kind: 'receipt', receipt: { commandId: 'x', outcome: 'accepted', revision: 1, events: [] } }),
    ).toBeNull();
  });
});

describe('api result parsing', () => {
  it('unwraps ok envelopes', () => {
    expect(parseApiResult(200, { ok: true, data: { a: 1 } })).toEqual({ ok: true, data: { a: 1 } });
  });

  it('passes through server error envelopes', () => {
    const result = parseApiResult(200, {
      ok: false,
      error: { code: 'E_ILLEGAL_TARGET', messageId: 'error.E_ILLEGAL_TARGET', params: { edge: 3 } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.messageId).toBe('error.E_ILLEGAL_TARGET');
  });

  it('turns a malformed or unauthorised body into a usable error', () => {
    expect(parseApiResult(500, null).ok).toBe(false);
    const unauthorized = parseApiResult(401, {});
    expect(unauthorized.ok).toBe(false);
    if (!unauthorized.ok) expect(unauthorized.error.code).toBe('E_UNAUTHORIZED');
  });
});
