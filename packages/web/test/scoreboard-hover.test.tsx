import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeIdentity, makePlayer, makeSnapshot, makeView } from '../src/test/fixtures.ts';

function open(view = makeView(), selfId: string | null = 'p1') {
  const state = initialTableState('en');
  state.session = selfId ? makeIdentity({ id: selfId }) : null;
  state.game = makeSnapshot(view);
  const controller = { state, dispatch: vi.fn(), actions: {} } as unknown as TableController;
  render(<LocaleProvider locale="en"><button>Outside</button><PlayersPanel controller={controller} /></LocaleProvider>);
  return screen.getByTestId('players-panel');
}

function pointer(element: Element, eventName: string, pointerType = 'mouse') {
  const event = new Event(eventName, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(element, event);
}

afterEach(() => vi.useRealTimers());

describe('player scoreboard previews', () => {
  it('keeps six names, colors, turn indication and authoritative totals visible when collapsed', () => {
    const players = Array.from({ length: 6 }, (_, seat) => makePlayer({ id: `p${seat + 1}`, seat, nickname: `Player ${seat + 1}`, ownScore: 9 }));
    const panel = open(makeView({ players }));
    expect(panel.getAttribute('data-expanded')).toBe('false');
    expect(panel.querySelectorAll('[data-board-seat]')).toHaveLength(6);
    for (const player of players) {
      const seat = screen.getByTestId(`seat-${player.seat}`);
      expect(seat.querySelector('.seat__name')?.hasAttribute('hidden')).toBe(false);
      expect(seat.querySelector('.seat__name')?.textContent).toContain(player.nickname);
      expect((seat as HTMLElement).style.getPropertyValue('--player-color')).not.toBe('');
      expect(seat.querySelector('.seat__score')?.textContent).toContain(player.seat === 0 ? '9' : '2');
      expect(seat.querySelector('.players__details')?.hasAttribute('hidden')).toBe(true);
    }
    expect(screen.getByTestId('seat-0').getAttribute('data-turn')).toBe('true');
    expect(within(screen.getByTestId('seat-0')).getByText('Turn owner')).toBeTruthy();
    expect(screen.getAllByTestId('players-hidden-vp')).toHaveLength(1);
  });

  it('opens on mouse hover, tolerates re-entry, and closes after leaving without pinning', () => {
    vi.useFakeTimers();
    const panel = open();
    pointer(panel, 'pointerover');
    expect(panel.getAttribute('data-expanded')).toBe('true');
    expect(panel.getAttribute('data-pinned')).toBe('false');
    pointer(panel, 'pointerout');
    act(() => vi.advanceTimersByTime(200));
    expect(panel.getAttribute('data-expanded')).toBe('true');
    pointer(panel, 'pointerover');
    act(() => vi.advanceTimersByTime(200));
    expect(panel.getAttribute('data-expanded')).toBe('true');
    pointer(panel, 'pointerout');
    act(() => vi.advanceTimersByTime(321));
    expect(panel.getAttribute('data-expanded')).toBe('false');
  });

  it('only pins from the pin control and keeps an unpinned preview until the pointer leaves', () => {
    vi.useFakeTimers();
    const panel = open();
    pointer(panel, 'pointerover');
    const pin = screen.getByTestId('players-pin');
    pointer(pin, 'pointerdown');
    act(() => pin.focus());
    pointer(pin, 'pointerup');
    fireEvent.click(pin);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    pointer(panel, 'pointerout');
    act(() => vi.advanceTimersByTime(500));
    expect(panel.getAttribute('data-expanded')).toBe('true');
    pointer(panel, 'pointerover');
    fireEvent.click(pin);
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    expect(panel.getAttribute('data-expanded')).toBe('true');
    pointer(panel, 'pointerout');
    act(() => vi.advanceTimersByTime(321));
    expect(panel.getAttribute('data-expanded')).toBe('false');
  });

  it('supports keyboard focus, delayed blur, and Escape without reopening from restored focus', () => {
    vi.useFakeTimers();
    const panel = open();
    const toggle = screen.getByTestId('players-toggle');
    act(() => toggle.focus());
    expect(panel.getAttribute('data-expanded')).toBe('true');
    pointer(panel, 'pointerout');
    act(() => vi.advanceTimersByTime(500));
    expect(panel.getAttribute('data-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('players-pin'));
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(panel.getAttribute('data-expanded')).toBe('false');
    expect(panel.getAttribute('data-pinned')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    act(() => toggle.focus());
    expect(panel.getAttribute('data-expanded')).toBe('true');
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    act(() => vi.advanceTimersByTime(321));
    expect(panel.getAttribute('data-expanded')).toBe('false');
  });

  it('opens on a touch tap without accidental pinning and dismisses on an outside tap', () => {
    const panel = open();
    const toggle = screen.getByTestId('players-toggle');
    pointer(panel, 'pointerover', 'touch');
    expect(panel.getAttribute('data-expanded')).toBe('false');
    pointer(toggle, 'pointerdown', 'touch');
    act(() => toggle.focus());
    pointer(toggle, 'pointerup', 'touch');
    fireEvent.click(toggle);
    expect(panel.getAttribute('data-expanded')).toBe('true');
    expect(panel.getAttribute('data-pinned')).toBe('false');
    pointer(screen.getByRole('button', { name: 'Outside' }), 'pointerdown', 'touch');
    expect(panel.getAttribute('data-expanded')).toBe('false');
  });

  it('derives point sources from projected buildings, awards and only the owner’s private cards', () => {
    const view = makeView();
    view.board.buildings[0] = { player: 'p1', city: false };
    view.board.buildings[1] = { player: 'p1', city: true };
    view.awards.longestRoad = 'p1';
    view.players[0] = makePlayer({ publicScore: 6, ownScore: 9, bonusPoints: 1, devCards: ['victoryPoint'], newDevCards: ['victoryPoint'] });
    // 即使測試輸入意外含有他人私密欄位，介面仍不得揭露。
    view.players[1]!.ownScore = 99;
    view.players[1]!.devCards = ['victoryPoint', 'victoryPoint'];
    const panel = open(view);
    pointer(panel, 'pointerover');
    const ownBreakdown = screen.getByTestId('seat-0').querySelector('.players__breakdown')!;
    const pointsFor = (label: string) => within(ownBreakdown as HTMLElement).getByText(label).nextElementSibling?.textContent;
    expect(pointsFor('Settlements (1 × 1)')).toBe('1');
    expect(pointsFor('Cities (1 × 2)')).toBe('2');
    expect(pointsFor('Longest road')).toBe('2');
    expect(pointsFor('Public bonus points')).toBe('1');
    expect(pointsFor('Your hidden victory-point cards')).toBe('2');
    expect(pointsFor('Your other hidden points')).toBe('1');
    expect(pointsFor('Your total')).toBe('9');
    expect(screen.getByTestId('seat-1').textContent).not.toContain('99');
    expect(within(screen.getByTestId('seat-1')).queryByText('Your hidden victory-point cards')).toBeNull();
    expect(within(screen.getByTestId('seat-1')).getAllByText(/Public score/)).toHaveLength(2);
  });

  it('does not reveal private score fields without a matching signed-in player', () => {
    const panel = open(makeView(), null);
    pointer(panel, 'pointerover');
    expect(screen.queryByTestId('players-hidden-vp')).toBeNull();
    expect(panel.querySelector('.seat__own-score')).toBeNull();
  });
});
