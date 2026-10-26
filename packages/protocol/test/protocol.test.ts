/** Wire-protocol invariants shared by the client and the service. */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  LOCALES,
  POLICY_BOUNDS,
  type ClientMessage,
  type ServerMessage,
} from '../src/index.ts';

describe('protocol contract', () => {
  it('supports exactly the two first-release locales', () => {
    expect(LOCALES).toEqual(['zh-Hant', 'en']);
  });

  it('ships the confirmed default room policy', () => {
    expect(DEFAULT_POLICY.turnClockSeconds).toBe(0);
    expect(DEFAULT_POLICY.disconnectGraceSeconds).toBe(300);
    expect(DEFAULT_POLICY.allowAbandonment).toBe(true);
    expect(DEFAULT_POLICY.hostSuccession).toBe('automatic');
  });

  it('keeps the documented policy bounds and a default inside them', () => {
    expect(POLICY_BOUNDS.turnClockSeconds.min).toBe(0);
    expect(POLICY_BOUNDS.disconnectGraceSeconds.min).toBeGreaterThan(0);
    expect(DEFAULT_POLICY.turnClockSeconds).toBeGreaterThanOrEqual(
      POLICY_BOUNDS.turnClockSeconds.min,
    );
    expect(DEFAULT_POLICY.disconnectGraceSeconds).toBeLessThanOrEqual(
      POLICY_BOUNDS.disconnectGraceSeconds.max,
    );
  });

  it('round-trips every server message shape through JSON', () => {
    const messages: ServerMessage[] = [
      { type: 'hello', payload: { playerId: 'p1', locale: 'en' } },
      { type: 'presence', payload: { roomId: 'r1', members: [] } },
      { type: 'notice', payload: { messageId: 'notice.test', params: { a: 1 } } },
      { type: 'error', payload: { code: 'E_TEST', messageId: 'error.E_TEST' } },
      { type: 'pong', payload: { at: '2026-10-26T00:00:00.000Z' } },
    ];
    for (const message of messages) {
      expect(JSON.parse(JSON.stringify(message))).toEqual(message);
    }
  });

  it('round-trips every client message shape through JSON', () => {
    const messages: ClientMessage[] = [
      { type: 'ping' },
      { type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } },
      {
        type: 'command',
        payload: {
          gameId: 'g1',
          commandId: 'c1',
          expectedRevision: 3,
          command: { type: 'turn.roll' },
        },
      },
      { type: 'chat', payload: { roomId: 'r1', clientMessageId: 'm1', text: 'hi' } },
    ];
    for (const message of messages) {
      expect(JSON.parse(JSON.stringify(message))).toEqual(message);
    }
  });
});

describe('message id coverage', () => {
  it('derives an error message id for every rejection the engine can return', async () => {
    const { ERROR_MESSAGE_IDS, COMMAND_ERROR_CODES } = await import('../src/index.ts');
    expect(ERROR_MESSAGE_IDS).toHaveLength(COMMAND_ERROR_CODES.length);
    expect(ERROR_MESSAGE_IDS).toContain('error.E_PAIRED_NO_DOMESTIC_TRADE');
    expect(ERROR_MESSAGE_IDS).toContain('error.E_GAME_OVER');
    expect(ERROR_MESSAGE_IDS).toContain('error.E_INSUFFICIENT_RESOURCES');
    for (const id of ERROR_MESSAGE_IDS) expect(id).toMatch(/^error\.E_[A-Z_]+$/);
  });

  it('derives an event message id for every event the engine emits', async () => {
    const { EVENT_MESSAGE_IDS } = await import('../src/index.ts');
    expect(EVENT_MESSAGE_IDS).toContain('event.game.created');
    expect(EVENT_MESSAGE_IDS).toContain('event.trade.completed');
    expect(EVENT_MESSAGE_IDS).toContain('event.game.abandoned');
    for (const id of EVENT_MESSAGE_IDS) expect(id).toMatch(/^event\.[a-z]+\.[a-zA-Z]+$/);
  });
});
