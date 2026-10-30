import { useReducer } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileDrawer } from '../src/components/MobileDrawer.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState, tableReducer } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeIdentity, makeSnapshot } from '../src/test/fixtures.ts';

function DrawerHarness({ submit }: { submit: TableController['actions']['submitCommand'] }) {
  const [state, dispatch] = useReducer(tableReducer, {
    ...initialTableState('zh-Hant'),
    session: makeIdentity(),
    game: makeSnapshot(),
  });
  const controller: TableController = {
    state,
    dispatch,
    actions: {
      setDrawer: (drawer) => dispatch({ type: 'drawer', drawer }),
      submitCommand: submit,
    } as TableController['actions'],
  };
  return <LocaleProvider locale="zh-Hant"><MobileDrawer controller={controller} /></LocaleProvider>;
}

describe('mobile trade and exchange drawer entries', () => {
  it('keeps each draft while navigating by keyboard and closes with focus on its own entry', () => {
    const submit = vi.fn<TableController['actions']['submitCommand']>();
    render(<DrawerHarness submit={submit} />);
    const tradeTab = screen.getByTestId('drawer-tab-trade');
    const exchangeTab = screen.getByTestId('drawer-tab-exchange');
    expect(tradeTab.textContent).toBe('交易');
    expect(exchangeTab.textContent).toBe('兌換');

    fireEvent.click(tradeTab);
    const trade = screen.getByRole('tabpanel', { name: '交易' });
    expect(within(trade).queryByTestId('bank-submit')).toBeNull();
    fireEvent.click(within(trade).getByTestId('give-add-lumber'));
    fireEvent.click(within(trade).getByTestId('want-add-brick'));
    fireEvent.keyDown(tradeTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(exchangeTab);
    const exchange = screen.getByRole('tabpanel', { name: '兌換' });
    expect(within(exchange).queryByTestId('create-offer')).toBeNull();
    fireEvent.change(screen.getByTestId('bank-give'), { target: { value: 'grain' } });
    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'ore' } });

    fireEvent.click(screen.getByTestId('drawer-close'));
    expect(document.activeElement).toBe(exchangeTab);
    expect(screen.getByTestId('drawer-content').hidden).toBe(true);
    fireEvent.click(exchangeTab);
    expect((screen.getByTestId('bank-give') as HTMLSelectElement).value).toBe('grain');
    expect((screen.getByTestId('bank-receive') as HTMLSelectElement).value).toBe('ore');
    fireEvent.click(screen.getByTestId('bank-submit'));
    expect(submit).toHaveBeenLastCalledWith(
      { type: 'trade.bank', give: 'grain', receive: 'ore' }, 'play.bankTrade',
    );

    fireEvent.keyDown(exchangeTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tradeTab);
    expect(screen.getByTestId('give-lumber').textContent).toBe('1');
    expect(screen.getByTestId('want-brick').textContent).toBe('1');
    fireEvent.click(screen.getByTestId('create-offer'));
    expect(submit).toHaveBeenLastCalledWith(
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { brick: 1 } }, 'play.tradeNew',
    );
  });
});
