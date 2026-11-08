/** 投影的銀行存量只到上限（#137）：顯示「2+」等可用性，並在拿不到時停用選項。 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BANK_VIEW_CAP, type GameView } from '@catan/rules';
import { DevCardChoicePicker } from '../src/components/DevCardChoicePicker.tsx';
import { ExchangePanel } from '../src/components/ExchangePanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { bankSupply, formatBankSupply } from '../src/i18n/format.ts';
import { initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeHints, makeSnapshot, makeView } from '../src/test/fixtures.ts';

function tableWith(view: GameView): TableState {
  return {
    ...initialTableState('en', 'Alex'),
    bootstrapped: true,
    session: { id: 'p1', nickname: 'Alex', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(view),
  };
}

describe('bank supply text', () => {
  it('shows exact counts below the cap and "N+" at the cap', () => {
    expect(BANK_VIEW_CAP).toBe(2);
    expect(formatBankSupply('en', 0)).toBe('0');
    expect(formatBankSupply('en', 1)).toBe('1');
    expect(formatBankSupply('en', 2)).toBe('2+');
    expect(formatBankSupply('zh-Hant', 2)).toBe('2+');
    // 已先拿走的張數從「至少」的值扣掉，仍是「至少」。
    expect(formatBankSupply('en', 2, 1)).toBe('1+');
    expect(formatBankSupply('en', 1, 1)).toBe('0');
    expect(bankSupply(2)).toEqual({ count: 2, atLeast: true });
    expect(bankSupply(1)).toEqual({ count: 1, atLeast: false });
    expect(bankSupply(2, 2)).toEqual({ count: 0, atLeast: false });
  });
});

describe('year of plenty picker', () => {
  const renderPicker = (bank: GameView['bank'], locale: 'en' | 'zh-Hant' = 'en') => render(
    <LocaleProvider locale={locale}>
      <DevCardChoicePicker card="yearOfPlenty" required={2} bank={bank} busy={false} onSubmit={vi.fn()} />
    </LocaleProvider>,
  );

  it('shows a capped pile as "2+" and a smaller pile as its exact count', () => {
    renderPicker({ lumber: 0, brick: 1, wool: 2, grain: 2, ore: 2 });
    expect(screen.getByTestId('choice-bank-grain').textContent).toBe('2+');
    expect(screen.getByTestId('choice-bank-brick').textContent).toBe('1');
    expect(screen.getByTestId('choice-bank-lumber').textContent).toBe('0');
    expect(screen.getByTestId('choice-add-grain').getAttribute('aria-label')).toBe('Grain, at least 2 left in the bank; take one');
    expect(screen.getByTestId('choice-add-brick').getAttribute('aria-label')).toBe('Brick, 1 left in the bank; take one');
    expect(screen.getByTestId('choice-add-lumber').getAttribute('aria-disabled')).toBe('true');

    // 從「2 張以上」拿一張後仍是「至少 1 張」；同種可以拿兩張。
    fireEvent.click(screen.getByTestId('choice-add-grain'));
    expect(screen.getByTestId('choice-bank-grain').textContent).toBe('1+');
    expect(screen.getByTestId('choice-add-grain').getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(screen.getByTestId('choice-add-grain'));
    expect(screen.getByTestId('choice-submit').hasAttribute('disabled')).toBe(false);
  });

  it('words the at-least supply in Traditional Chinese', () => {
    renderPicker({ lumber: 2, brick: 1, wool: 0, grain: 0, ore: 0 }, 'zh-Hant');
    expect(screen.getByTestId('choice-add-lumber').getAttribute('aria-label')).toBe('木材，銀行至少剩 2 張；拿一張');
    expect(screen.getByTestId('choice-add-brick').getAttribute('aria-label')).toBe('磚塊，銀行剩 1 張；拿一張');
  });
});

describe('bank exchange supply', () => {
  const controllerFor = (view: GameView) => {
    const submitCommand = vi.fn();
    const controller = { state: tableWith(view), actions: { submitCommand } } as unknown as TableController;
    return { controller, submitCommand };
  };

  it('refuses to receive a resource the bank has run out of, and says why', () => {
    const view = makeView({ hints: makeHints() });
    view.bank = { lumber: 2, brick: 0, wool: 2, grain: 2, ore: 1 };
    const { controller, submitCommand } = controllerFor(view);
    render(<LocaleProvider locale="en"><ExchangePanel controller={controller} /></LocaleProvider>);
    // 預設是給木材、拿磚塊：銀行沒有磚塊。
    const submit = screen.getByTestId('bank-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('bank-empty').textContent).toBe('The bank has no Brick left.');
    expect(submit.getAttribute('aria-describedby')).toBe('bank-empty');
    fireEvent.click(submit);
    expect(submitCommand).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'ore' } });
    expect(screen.queryByTestId('bank-empty')).toBeNull();
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(submitCommand).toHaveBeenCalledWith({ type: 'trade.bank', give: 'lumber', receive: 'ore' }, 'play.bankTrade');
  });

  it('checks a commodity against the commodity supply', () => {
    const view = makeView({ hints: makeHints() });
    view.modules = { citiesKnights: { barbarian: { position: 0, length: 7, attacks: 0 }, commodityBank: { paper: 0, cloth: 2, coin: 1 } } };
    view.hints = { ...view.hints!, modules: { citiesKnights: { commodityRates: { paper: 4, cloth: 4, coin: 4 } } } };
    const { controller } = controllerFor(view);
    render(<LocaleProvider locale="en"><ExchangePanel controller={controller} /></LocaleProvider>);
    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'paper' } });
    expect((screen.getByTestId('bank-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('bank-empty').textContent).toBe('The bank has no Paper left.');
    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'coin' } });
    expect((screen.getByTestId('bank-submit') as HTMLButtonElement).disabled).toBe(false);
  });
});
