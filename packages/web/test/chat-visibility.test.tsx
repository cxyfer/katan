import { useReducer, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameTools } from '../src/components/GameTools.tsx';
import { MobileDrawer } from '../src/components/MobileDrawer.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState, tableReducer } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeChatMessage, makeSnapshot } from '../src/test/fixtures.ts';

/** 和 GameScreen 相同的斷點掛載交接，保留單一 table/chat reducer。 */
function VisibilityHarness() {
  const [mobile, setMobile] = useState(true);
  const initial = initialTableState('en');
  const [state, dispatch] = useReducer(tableReducer, {
    ...initial,
    game: makeSnapshot(),
    drawer: 'chat' as const,
    chat: { ...initial.chat, draft: 'retained message' },
  });
  const controller: TableController = {
    state,
    dispatch,
    actions: {
      setDrawer: (drawer) => dispatch({ type: 'drawer', drawer }),
    } as TableController['actions'],
  };
  return <LocaleProvider locale="en">
    <button onClick={() => setMobile(!mobile)}>Toggle breakpoint</button>
    <button onClick={() => dispatch({ type: 'chat', event: {
      kind: 'server-message', message: makeChatMessage({ id: `message-${state.chat.server.length}`, seq: state.chat.server.length + 1, playerId: 'p2' }), selfId: 'p1',
    } })}>Receive message</button>
    <output data-testid="visibility-state">{`${state.chat.open}:${state.chat.unread}:${state.chat.draft}`}</output>
    {mobile ? <MobileDrawer controller={controller} /> : <GameTools controller={controller} />}
  </LocaleProvider>;
}

describe('responsive chat visibility', () => {
  it('resynchronizes retained mobile chat after desktop handoff, with unread only while hidden', () => {
    render(<VisibilityHarness />);
    expect(screen.getByTestId('visibility-state').textContent).toBe('true:0:retained message');
    fireEvent.click(screen.getByText('Receive message'));
    expect(screen.getByTestId('visibility-state').textContent).toBe('true:0:retained message');

    fireEvent.click(screen.getByText('Toggle breakpoint'));
    expect(screen.getByTestId('visibility-state').textContent).toBe('false:0:retained message');
    fireEvent.click(screen.getByText('Receive message'));
    expect(screen.getByTestId('visibility-state').textContent).toBe('false:1:retained message');

    fireEvent.click(screen.getByText('Toggle breakpoint'));
    expect(screen.getByTestId('drawer-tab-chat').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('visibility-state').textContent).toBe('true:0:retained message');
    fireEvent.click(screen.getByText('Receive message'));
    expect(screen.getByTestId('visibility-state').textContent).toBe('true:0:retained message');

    fireEvent.click(screen.getByTestId('drawer-tab-hand'));
    fireEvent.click(screen.getByText('Receive message'));
    expect(screen.getByTestId('visibility-state').textContent).toBe('false:1:retained message');
    fireEvent.click(screen.getByTestId('drawer-tab-chat'));
    expect(screen.getByTestId('visibility-state').textContent).toBe('true:0:retained message');
  });
});
