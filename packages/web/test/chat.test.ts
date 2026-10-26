import { describe, expect, it } from 'vitest';
import {
  chatReducer,
  initialChatState,
  isMuted,
  visibleMessages,
  type ChatState,
} from '../src/state/chat.ts';
import { makeChatMessage } from '../src/test/fixtures.ts';

function sending(): ChatState {
  return chatReducer(initialChatState(), {
    kind: 'local-send',
    clientMessageId: 'c1',
    text: 'hello',
  });
}

describe('chat send lifecycle', () => {
  it('tracks sending → sent and keeps the client message id', () => {
    const state = sending();
    expect(state.entries[0]).toMatchObject({ clientMessageId: 'c1', status: 'sending' });

    const sent = chatReducer(state, {
      kind: 'send-accepted',
      clientMessageId: 'c1',
      message: makeChatMessage({ id: 'm1', seq: 1, clientMessageId: 'c1', text: 'hello' }),
    });
    expect(sent.entries[0]!.status).toBe('sent');
    expect(sent.server).toHaveLength(1);
  });

  it('distinguishes a rejection from an unknown outcome and retries with the same id', () => {
    const rejected = chatReducer(sending(), {
      kind: 'send-rejected',
      clientMessageId: 'c1',
      error: { messageId: 'error.E_CHAT_RATE_LIMITED' },
    });
    expect(rejected.entries[0]!.status).toBe('rejected');

    const unknown = chatReducer(sending(), {
      kind: 'send-unknown',
      clientMessageId: 'c1',
      error: { messageId: 'error.E_NETWORK' },
    });
    expect(unknown.entries[0]!.status).toBe('unknown');

    const retried = chatReducer(unknown, { kind: 'retry-send', clientMessageId: 'c1' });
    expect(retried.entries[0]).toMatchObject({ clientMessageId: 'c1', status: 'sending' });
    expect(retried.entries).toHaveLength(1);
  });

  it('collapses a server echo of a local send instead of duplicating it', () => {
    const state = sending();
    const echoed = chatReducer(state, {
      kind: 'server-message',
      message: makeChatMessage({ id: 'm1', seq: 4, clientMessageId: 'c1', playerId: 'p1', text: 'hello' }),
      selfId: 'p1',
    });
    expect(echoed.server).toHaveLength(1);
    expect(echoed.entries[0]!.status).toBe('sent');

    const duplicate = chatReducer(echoed, {
      kind: 'server-message',
      message: makeChatMessage({ id: 'm1', seq: 4, clientMessageId: 'c1', playerId: 'p1', text: 'hello' }),
      selfId: 'p1',
    });
    expect(duplicate.server).toHaveLength(1);
  });

  it('counts unread messages only while the panel is closed and not from me', () => {
    const closed = chatReducer(initialChatState(), {
      kind: 'server-message',
      message: makeChatMessage({ id: 'm1', seq: 1, playerId: 'p2' }),
      selfId: 'p1',
    });
    expect(closed.unread).toBe(1);

    const open = chatReducer(chatReducer(initialChatState(), { kind: 'open' }), {
      kind: 'server-message',
      message: makeChatMessage({ id: 'm2', seq: 2, playerId: 'p2' }),
      selfId: 'p1',
    });
    expect(open.unread).toBe(0);

    const own = chatReducer(initialChatState(), {
      kind: 'server-message',
      message: makeChatMessage({ id: 'm3', seq: 3, playerId: 'p1' }),
      selfId: 'p1',
    });
    expect(own.unread).toBe(0);

    expect(chatReducer(closed, { kind: 'mark-read' }).unread).toBe(0);
  });

  it('pages history without duplicating already-seen messages', () => {
    const first = chatReducer(initialChatState(), {
      kind: 'page',
      messages: [makeChatMessage({ id: 'm1', seq: 1 }), makeChatMessage({ id: 'm2', seq: 2 })],
      nextSeq: 3,
      hasMore: true,
    });
    expect(first.server).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = chatReducer(first, {
      kind: 'page',
      messages: [makeChatMessage({ id: 'm2', seq: 2 }), makeChatMessage({ id: 'm3', seq: 3 })],
      nextSeq: 4,
      hasMore: false,
    });
    expect(second.server.map((message) => message.id)).toEqual(['m1', 'm2', 'm3']);
    expect(second.hasMore).toBe(false);
  });
});

describe('personal mute', () => {
  it('hides only that sender and never removes the message from history', () => {
    const state = chatReducer(
      chatReducer(initialChatState(), {
        kind: 'page',
        messages: [
          makeChatMessage({ id: 'm1', seq: 1, playerId: 'p2', nickname: '小美' }),
          makeChatMessage({ id: 'm2', seq: 2, playerId: 'p3', nickname: 'Bo' }),
        ],
        nextSeq: 3,
        hasMore: false,
      }),
      { kind: 'mute', playerId: 'p2' },
    );
    expect(isMuted(state, 'p2')).toBe(true);
    expect(state.server).toHaveLength(2);
    expect(visibleMessages(state).map((message) => message.id)).toEqual(['m2']);
    expect(visibleMessages(chatReducer(state, { kind: 'unmute', playerId: 'p2' }))).toHaveLength(2);
  });

  it('is idempotent when muting the same player twice', () => {
    const once = chatReducer(initialChatState(), { kind: 'mute', playerId: 'p2' });
    const twice = chatReducer(once, { kind: 'mute', playerId: 'p2' });
    expect(twice.muted).toEqual(['p2']);
    expect(twice).toBe(once);
  });
});
