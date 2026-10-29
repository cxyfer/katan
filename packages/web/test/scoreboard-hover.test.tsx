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
  it('keeps seat order and the turn flag outside the hideable details', () => {
    const players = [makePlayer({ id: 'p3', seat: 2 }), makePlayer({ id: 'p1', seat: 0 }), makePlayer({ id: 'p2', seat: 1 })];
    const panel = open(makeView({ players }));
    expect([...screen.getByTestId('seat-list').children].map((seat) => seat.getAttribute('data-testid'))).toEqual(['seat-0', 'seat-1', 'seat-2']);
    const flag = screen.getByTestId('seat-turn-flag');
    expect(flag.parentElement).toBe(screen.getByTestId('seat-0'));
    expect(flag.closest('[hidden]')).toBeNull();
    pointer(panel, 'pointerover');
    expect(flag.parentElement).toBe(screen.getByTestId('seat-0'));
    expect(flag.closest('.players__details')).toBeNull();
  });

  it.each([
    { view: makeView(), selfId: 'p1', label: 'Your turn', mine: 'true' },
    { view: makeView({ turnPlayerId: 'p2' }), selfId: 'p1', label: 'Waiting for 小美', mine: 'false' },
    { view: makeView({ pending: { kind: 'moveRobber', actor: 'p1', cause: 'seven' } }), selfId: 'p1', label: 'Move the robber', mine: 'true' },
    { view: makeView({ turnPlayerId: 'p2' }), selfId: null, label: 'Waiting for 小美', mine: 'false' },
  ])('keeps the current obligation visible while collapsed: $label', ({ view, selfId, label, mine }) => {
    const panel = open(view, selfId);
    const obligation = within(panel).getByTestId('turn-state');
    expect(obligation.textContent).toContain(label);
    expect(obligation.getAttribute('data-mine')).toBe(mine);
    expect(obligation.closest('[hidden]')).toBeNull();
    expect(obligation.closest('.players__details')).toBeNull();
  });

  it('keeps six colors, turn indication and totals in the compact rail and reveals names and pinning on expansion', () => {
    const players = Array.from({ length: 6 }, (_, seat) => makePlayer({ id: `p${seat + 1}`, seat, nickname: `Player ${seat + 1}`, ownScore: 9 }));
    const panel = open(makeView({ players }));
    expect(panel.getAttribute('data-expanded')).toBe('false');
    expect(panel.querySelectorAll('[data-board-seat]')).toHaveLength(6);
    for (const player of players) {
      const seat = screen.getByTestId(`seat-${player.seat}`);
      expect(seat.querySelector('.seat__identity')?.hasAttribute('hidden')).toBe(true);
      expect(seat.querySelector('.seat__name')?.textContent).toContain(player.nickname);
      expect((seat as HTMLElement).style.getPropertyValue('--player-color')).not.toBe('');
      expect(seat.querySelector('.seat__score')?.textContent).toContain(player.seat === 0 ? '9' : '2');
      expect(seat.querySelector('.players__details')?.hasAttribute('hidden')).toBe(true);
    }
    expect(screen.getByTestId('seat-0').getAttribute('data-turn')).toBe('true');
    expect(within(screen.getByTestId('seat-0')).getByText('Turn owner')).toBeTruthy();
    expect(screen.getAllByTestId('players-hidden-vp')).toHaveLength(1);
    expect(screen.getByTestId('players-pin').hidden).toBe(true);
    pointer(panel, 'pointerover');
    expect(screen.getByTestId('players-pin').hidden).toBe(false);
    for (const player of players) {
      expect(screen.getByTestId(`seat-${player.seat}`).querySelector('.seat__identity')?.hasAttribute('hidden')).toBe(false);
    }
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

  it('opens on the first real touch tap when compatibility mouse focus follows pointerup', () => {
    const panel = open();
    const toggle = screen.getByTestId('players-toggle');
    pointer(toggle, 'pointerdown', 'touch');
    pointer(toggle, 'pointerup', 'touch');
    fireEvent.mouseDown(toggle);
    act(() => toggle.focus());
    fireEvent.mouseUp(toggle);
    fireEvent.click(toggle);
    expect(panel.getAttribute('data-expanded')).toBe('true');
    expect(panel.getAttribute('data-pinned')).toBe('false');

    pointer(toggle, 'pointerdown', 'touch');
    pointer(toggle, 'pointerup', 'touch');
    fireEvent.mouseDown(toggle);
    fireEvent.mouseUp(toggle);
    fireEvent.click(toggle);
    expect(panel.getAttribute('data-expanded')).toBe('false');
  });

  it('shows compact counters and award medals with accessible labels and only the owner’s private cards', () => {
    const view = makeView();
    view.board.buildings[0] = { player: 'p1', city: false };
    view.board.buildings[1] = { player: 'p1', city: true };
    view.awards.longestRoad = 'p1';
    view.awards.largestArmy = 'p2';
    view.players[0] = makePlayer({ publicScore: 6, ownScore: 9, bonusPoints: 1, longestRoadLength: 5, devCards: ['victoryPoint'], newDevCards: ['victoryPoint'] });
    // 即使測試輸入意外含有他人私密欄位，介面仍不得揭露。
    view.players[1]!.ownScore = 99;
    view.players[1]!.devCards = ['victoryPoint', 'victoryPoint'];
    view.players[1]!.playedKnights = 3;
    const panel = open(view);
    pointer(panel, 'pointerover');
    const ownSeat = within(screen.getByTestId('seat-0'));
    for (const label of ['Settlements (1 × 1): 1', 'Cities (1 × 2): 1', 'Public bonus points: 1',
      'Your hidden victory-point cards: 2', 'Your other hidden points: 1']) {
      expect(ownSeat.getByRole('img', { name: label }).getAttribute('title')).toBe(label);
    }
    const road = ownSeat.getByRole('img', { name: 'Longest route · Longest road (+2): 5' });
    expect(road.classList.contains('score-mark--medal')).toBe(true);
    expect(road.querySelector('.score-mark__points')?.textContent).toBe('+2');
    expect(screen.getByTestId('seat-0').querySelector('.seat__score')?.textContent).toBe('Your total: 9');
    const opponent = screen.getByTestId('seat-1');
    expect(within(opponent).getByRole('img', { name: 'Knights played · Largest army (+2): 3' }).classList.contains('score-mark--medal')).toBe(true);
    expect(opponent.textContent).not.toContain('99');
    expect(within(opponent).queryByRole('img', { name: /Your hidden/ })).toBeNull();
    expect(opponent.querySelector('.seat__score')?.textContent).toBe('Public score: 2');
    expect(panel.querySelectorAll('.score-mark--medal')).toHaveLength(2);
    expect(panel.querySelector('dl')).toBeNull();
    expect(panel.querySelector('.players__awards')).toBeNull();
    expect(ownSeat.queryByText('Your hidden victory-point cards')).toBeNull();
  });

  it('does not reveal private score fields without a matching signed-in player', () => {
    const panel = open(makeView(), null);
    pointer(panel, 'pointerover');
    expect(screen.queryByTestId('players-hidden-vp')).toBeNull();
    expect(panel.querySelector('.seat__own-score')).toBeNull();
  });
});
