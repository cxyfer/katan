import { describe, expect, it } from 'vitest';
import { initialTableState, tableReducer } from '../src/state/table.ts';
import { makeChatMessage } from '../src/test/fixtures.ts';

describe('drawer chat visibility', () => {
  it.each(['none', 'hand', 'trade', 'help'] as const)('counts messages after leaving chat for %s and keeps the draft', (drawer) => {
    let state = tableReducer(initialTableState('en'), { type: 'chat', event: { kind: 'draft', text: 'unfinished hello' } });
    state = tableReducer(state, { type: 'drawer', drawer: 'chat' });
    state = tableReducer(state, { type: 'chat', event: { kind: 'server-message', message: makeChatMessage({ id: 'visible', seq: 1, playerId: 'p2' }), selfId: 'p1' } });
    expect(state.chat.unread).toBe(0);
    state = tableReducer(state, { type: 'drawer', drawer });
    state = tableReducer(state, { type: 'chat', event: { kind: 'server-message', message: makeChatMessage({ id: 'unseen', seq: 2, playerId: 'p2' }), selfId: 'p1' } });
    expect(state.chat.unread).toBe(1);
    expect(state.chat.draft).toBe('unfinished hello');
    state = tableReducer(state, { type: 'drawer', drawer: 'chat' });
    expect(state.chat.unread).toBe(0);
    expect(state.chat.draft).toBe('unfinished hello');
  });
});
