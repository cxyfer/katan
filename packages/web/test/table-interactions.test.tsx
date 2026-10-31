import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { NOTICE_EXIT_MS } from '../src/components/useTransientNotice.ts';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makePlayer, makeSnapshot, makeView } from '../src/test/fixtures.ts';

async function open(view = makeView()) {
  const api = createFakeApi({ snapshot: makeSnapshot(view, Math.max(view.seq, ...view.events.map((event) => event.seq))) });
  render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
  return api;
}
function pointerEnter(element: Element, type = 'mouse') {
  const event = new Event('pointerover', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: type });
  fireEvent(element, event);
}
afterEach(() => vi.useRealTimers());

describe('table interactions', { timeout: 15000 }, () => {
  it('docks the scoreboard and build rail beside the board on wide landscape screens', async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    try {
      await open();
      expect(screen.getByTestId('game-stage').getAttribute('data-docked')).toBe('true');
      const players = screen.getByTestId('players-panel');
      const actions = screen.getByTestId('action-rail');
      expect(players.getAttribute('data-expanded')).toBe('true');
      expect(actions.getAttribute('data-expanded')).toBe('true');
      expect(screen.getByTestId('players-toggle').hidden).toBe(true);
      expect(screen.getByTestId('action-rail-toggle').hidden).toBe(true);
      // 提示與建造列同在右側欄，依序堆疊。
      const side = actions.parentElement!;
      expect(side.classList.contains('game__side')).toBe(true);
      expect(side.firstElementChild?.classList.contains('game__messages')).toBe(true);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }
  });

  it('keeps collapsible rails on short landscape screens', async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 520 });
    try {
      await open();
      expect(screen.getByTestId('game-stage').getAttribute('data-docked')).toBe('false');
      expect(screen.getByTestId('players-panel').getAttribute('data-expanded')).toBe('false');
      expect(screen.getByTestId('action-rail').getAttribute('data-expanded')).toBe('false');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }
  });

  it('unpins and closes the opposite rail on narrow screens without remounting actions', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      await open();
      const players = screen.getByTestId('players-panel');
      const actions = screen.getByTestId('action-rail');
      const road = screen.getByTestId('action-build.road');
      fireEvent.click(screen.getByTestId('players-pin'));
      expect(players.getAttribute('data-expanded')).toBe('true');
      expect(players.getAttribute('data-pinned')).toBe('true');
      act(() => screen.getByTestId('action-rail-toggle').focus());
      expect(actions.getAttribute('data-expanded')).toBe('true');
      expect(players.getAttribute('data-expanded')).toBe('false');
      expect(players.getAttribute('data-pinned')).toBe('false');
      const flag = screen.getByTestId('seat-turn-flag');
      expect(flag.parentElement?.classList.contains('game__table')).toBe(true);
      act(() => road.focus());
      pointerEnter(players);
      expect(players.getAttribute('data-expanded')).toBe('true');
      expect(actions.getAttribute('data-expanded')).toBe('false');
      expect(document.activeElement).toBe(screen.getByTestId('action-rail-toggle'));
      expect(screen.getByTestId('action-build.road')).toBe(road);
      expect(screen.getByTestId('seat-turn-flag').parentElement).toBe(screen.getByTestId('seat-0'));
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });

  it('keeps both rails available together on desktop', async () => {
    await open();
    fireEvent.click(screen.getByTestId('players-pin'));
    act(() => screen.getByTestId('action-rail-toggle').focus());
    expect(screen.getByTestId('players-panel').getAttribute('data-expanded')).toBe('true');
    expect(screen.getByTestId('players-panel').getAttribute('data-pinned')).toBe('true');
    expect(screen.getByTestId('action-rail').getAttribute('data-expanded')).toBe('true');
  });

  it('keeps six public seats visible while details collapse and only shows own private score', async () => {
    const players = Array.from({ length: 6 }, (_, seat) => makePlayer({ id: `p${seat + 1}`, seat, nickname: 'ABCDEFGHIJKLMNOPQRSTUVWX', ownScore: 9 }));
    await open(makeView({ players }));
    const panel = screen.getByTestId('players-panel');
    expect(panel.getAttribute('data-expanded')).toBe('false');
    expect(panel.querySelectorAll('.seat__score')).toHaveLength(6);
    expect(panel.querySelectorAll('.seat__own-score')).toHaveLength(1);
    expect(screen.queryByTestId('own-player-hud')).toBeNull();
    fireEvent.click(screen.getByTestId('players-toggle'));
    expect(panel.getAttribute('data-expanded')).toBe('true');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(panel.getAttribute('data-expanded')).toBe('false');
    expect(document.activeElement).toBe(screen.getByTestId('players-toggle'));
  });

  it('fans actual card faces on hover, bridges gaps, and keeps keyboard focus until Escape', async () => {
    await open();
    vi.useFakeTimers();
    const hand = screen.getByTestId('hand-panel');
    expect(hand.getAttribute('data-expanded')).toBe('false');
    expect(screen.queryByTestId('hand-toggle')).toBeNull();
    expect(screen.queryByTestId('hand-pin')).toBeNull();
    // 每張資源各自成卡（10 張）加上一張發展卡
    expect(hand.querySelectorAll('.hand-fan__card')).toHaveLength(11);
    pointerEnter(hand, 'touch');
    expect(hand.getAttribute('data-expanded')).toBe('false');
    pointerEnter(hand);
    expect(hand.getAttribute('data-expanded')).toBe('true');
    fireEvent.pointerLeave(hand);
    act(() => vi.advanceTimersByTime(200));
    expect(hand.getAttribute('data-expanded')).toBe('true');
    pointerEnter(hand);
    act(() => vi.advanceTimersByTime(121));
    expect(hand.getAttribute('data-expanded')).toBe('true');
    fireEvent.pointerLeave(hand);
    act(() => vi.advanceTimersByTime(321));
    expect(hand.getAttribute('data-expanded')).toBe('false');
    const resource = screen.getByTestId('resource-card-lumber-0').querySelector('button')!;
    act(() => resource.focus());
    fireEvent.pointerLeave(hand);
    act(() => vi.advanceTimersByTime(500));
    expect(hand.getAttribute('data-expanded')).toBe('true');
    fireEvent.keyDown(resource, { key: 'Escape' });
    expect(hand.getAttribute('data-expanded')).toBe('false');
    expect(document.activeElement).toBe(hand);
    fireEvent.keyDown(hand, { key: 'Enter' });
    expect(hand.getAttribute('data-expanded')).toBe('true');
    expect(document.activeElement).toBe(resource);
    act(() => screen.getByTestId('players-toggle').focus());
    act(() => vi.advanceTimersByTime(500));
    expect(hand.getAttribute('data-expanded')).toBe('false');
  });
  it('preserves monopoly choice across collapse and never offers new or victory-point cards for play', async () => {
    const view = makeView();
    view.players[0]!.devCards = ['monopoly', 'victoryPoint'];
    view.players[0]!.newDevCards = ['knight', 'roadBuilding'];
    const api = await open(view);
    fireEvent.focus(screen.getByTestId('hand-panel'));
    fireEvent.change(screen.getByTestId('monopoly-resource'), { target: { value: 'ore' } });
    fireEvent.keyDown(screen.getByTestId('hand-panel'), { key: 'Escape' });
    fireEvent.focus(screen.getByTestId('hand-panel'));
    expect((screen.getByTestId('monopoly-resource') as HTMLSelectElement).value).toBe('ore');
    expect(screen.getByTestId('new-devcards').querySelector('.development-card__play')).toBeNull();
    expect(screen.queryByTestId('play-victoryPoint-1')).toBeNull();
    fireEvent.click(screen.getByTestId('play-monopoly-0'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(api.callsOf('sendCommand')[0]!.args[1]).toMatchObject({ command: { type: 'dev.playMonopoly', resource: 'ore' } });
  });

  it('auto-hides accepted feedback and retains unknown results in the side recovery area', async () => {
    const api = await open();
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByTestId('action-endTurn')); });
    const corner = screen.getByTestId('accepted-notice');
    expect(corner.contains(screen.getByTestId('command-status'))).toBe(true);
    expect(corner.querySelector('button')).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    act(() => vi.advanceTimersByTime(NOTICE_EXIT_MS));
    expect(screen.queryByTestId('command-status')).toBeNull();
    vi.useRealTimers();
    api.setCommandResult({ ok: false, error: { code: 'E_NETWORK', messageId: 'error.E_NETWORK' } });
    fireEvent.click(screen.getByTestId('action-endTurn'));
    await screen.findByTestId('command-resolve');
    expect(screen.getByTestId('command-status').closest('.game__messages')).toBeTruthy();
    expect(screen.queryByTestId('accepted-notice')).toBeNull();
  }, 15000);

  it('plays a new command-refresh snapshot once and preserves it across locale / panel changes', async () => {
    const api = await open();
    const next = makeView({ events: [{ seq: 13, type: 'turn.rolled', params: { playerId: 'p1', dice: [6, 6], total: 12 } }] });
    next.seq = 13;
    next.turn.dice = [6, 6];
    api.setSnapshot(makeSnapshot(next, 13));
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByTestId('action-endTurn')); });
    expect(screen.getByTestId('dice-focus').getAttribute('data-phase')).toBe('rolling');
    expect(screen.getByTestId('dice-announcement').textContent).toBe('');
    const panel = screen.getByTestId('dice-focus').querySelector('.dice-focus__panel');
    fireEvent.change(screen.getByTestId('locale-switch-game'), { target: { value: 'zh-Hant' } });
    fireEvent.focus(screen.getByTestId('hand-panel'));
    fireEvent.click(screen.getByTestId('zoom-in'));
    expect(screen.getByTestId('dice-focus').querySelector('.dice-focus__panel')).toBe(panel);
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByTestId('dice-announcement').textContent).toContain('6 + 6 = 12');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('action-endTurn')); });
    expect(api.callsOf('sendCommand')).toHaveLength(2);
    expect(screen.queryByTestId('dice-focus')).toBeNull();
  });

  it('retains compact dice from initial history without a central replay (E01)', async () => {
    const view = makeView({ events: [{ seq: 13, type: 'turn.rolled', params: { playerId: 'p1', dice: [2, 5], total: 7 } }] });
    view.turn.dice = [2, 5];
    view.seq = 13;
    await open(view);
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    fireEvent.change(screen.getByTestId('locale-switch-game'), { target: { value: 'zh-Hant' } });
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(screen.getByTestId('dice-roll-animation').textContent).toContain('2');
    expect(screen.getByTestId('dice-roll-animation').textContent).toContain('5');
  });
});
