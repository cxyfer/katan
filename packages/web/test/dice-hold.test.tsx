import { StrictMode } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_PRESENTATION_DURATION_MS, MAX_EFFECT_DURATION_MS } from '../src/board/animation.ts';
import { useBoardAnimation } from '../src/board/useBoardAnimation.ts';
import { EventLog } from '../src/components/EventLog.tsx';
import { BoardView } from '../src/components/BoardView.tsx';
import { CitiesKnightsPanel } from '../src/components/CitiesKnightsPanel.tsx';
import { ExchangePanel } from '../src/components/ExchangePanel.tsx';
import { HandPanel } from '../src/components/HandPanel.tsx';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { TradePanel } from '../src/components/TradePanel.tsx';
import { TbPanel } from '../src/components/tb/TbPanel.tsx';
import { tbController, tbSlot, tbState } from './tb-helpers.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState, shownBank, shownCitiesKnights, shownExplorersPirates, shownHand, tableReducer, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import type { GameView } from '@catan/rules';
import { makeEvent, makeHints, makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

function base(): TableState {
  const view = makeView({ hints: makeHints() });
  view.seq = 12;
  view.events = [makeEvent(12, 'turn.started')];
  return { ...initialTableState('en', ''), session: makeIdentity(), game: makeSnapshot(view, 12) };
}

function rolledSnapshot(lumber: number) {
  const view = makeView({ hints: makeHints() });
  view.seq = 14;
  view.events = [makeEvent(12, 'turn.started'), makeEvent(13, 'turn.rolled', { dice: [3, 3], total: 6 }), makeEvent(14, 'production.resolved')];
  view.players[0]!.resources!.lumber = lumber;
  view.players[0]!.handSize = lumber + 8;
  view.players[1]!.handSize = 13;
  view.turn.dice = [3, 3];
  return makeSnapshot(view, 14);
}

describe('roll hold in the table state', () => {
  it.each(['snapshot', 'events'] as const)('holds E&P gold until dice settle (%s first)', (delivery) => {
    const before = base();
    before.game!.view.modules = { explorersPirates: { players: { p1: { gold: 1 } } } };
    const after = rolledSnapshot(9);
    after.view.modules = { explorersPirates: { players: { p1: { gold: 3 } } } };
    let state = delivery === 'events' ? tableReducer(before, { type: 'events', events: after.view.events }) : before;
    state = tableReducer(state, { type: 'snapshot', snapshot: after });
    expect(shownExplorersPirates(state)?.modules?.explorersPirates).toEqual({ players: { p1: { gold: 1 } } });
    state = tableReducer(state, { type: 'dice-presenting', value: false });
    expect(shownExplorersPirates(state)?.modules?.explorersPirates).toEqual({ players: { p1: { gold: 3 } } });
  });

  it.each(['snapshot', 'events'] as const)('holds the bank exchange supply until the dice settle (%s first)', (delivery) => {
    // 擲骰的產出把礦石與紙張從 1 張拿到 0：演出結束前不能先顯示「銀行沒有」（#137）。
    const ck = (paper: number) => ({ citiesKnights: { barbarian: { position: 2, length: 7, attacks: 0 }, commodityBank: { paper, cloth: 2, coin: 2 } } });
    const before = base();
    before.game!.view.bank = { lumber: 2, brick: 2, wool: 2, grain: 2, ore: 1 };
    before.game!.view.modules = ck(1);
    const after = rolledSnapshot(9);
    after.view.bank = { lumber: 2, brick: 2, wool: 2, grain: 2, ore: 0 };
    after.view.modules = ck(0);
    after.view.hints = { ...after.view.hints!, modules: { citiesKnights: { commodityRates: { paper: 4, cloth: 4, coin: 4 } } } };
    let held = delivery === 'events' ? tableReducer(before, { type: 'events', events: after.view.events }) : before;
    held = tableReducer(held, { type: 'snapshot', snapshot: after });
    expect(held.dicePresenting).toBe(true);
    expect(shownBank(held)).toEqual(before.game!.view.bank);
    const panel = (state: TableState) => {
      const controller = { state, dispatch: vi.fn(), actions: { submitCommand: vi.fn() } } as unknown as TableController;
      return <LocaleProvider locale="en"><ExchangePanel controller={controller} /></LocaleProvider>;
    };
    const submit = () => screen.getByTestId('bank-submit') as HTMLButtonElement;
    const { rerender } = render(panel(held));
    for (const receive of ['ore', 'paper']) {
      fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: receive } });
      expect(screen.queryByTestId('bank-empty')).toBeNull();
      expect(submit().disabled).toBe(false);
    }

    const revealed = tableReducer(held, { type: 'dice-presenting', value: false });
    expect(shownBank(revealed)).toEqual(after.view.bank);
    rerender(panel(revealed));
    expect(screen.getByTestId('bank-empty').textContent).toBe('The bank has no Paper left.');
    expect(submit().disabled).toBe(true);
    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'ore' } });
    expect(screen.getByTestId('bank-empty').textContent).toBe('The bank has no Ore left.');
    expect(submit().disabled).toBe(true);
  });

  it.each(['snapshot', 'events'] as const)('holds fish, boot and scores until the dice settle (%s first)', (delivery) => {
    const engine = tbState('tb-fishing-2025');
    const fish = tbSlot<{ hands: Record<string, number[]>; boot: string | null }>(engine, 'tb-fishing');
    fish.hands.p1 = [1];
    const before = tbController(engine).state;
    before.game!.view.seq = 12;
    before.game!.view.events = [makeEvent(12, 'turn.started')];
    const after = structuredClone(before.game!);
    after.view.seq = after.revision = 15;
    after.view.events.push(
      makeEvent(13, 'turn.rolled', { dice: [3, 3], total: 6 }),
      makeEvent(14, 'tb.fishDrawn', { playerId: 'p1', count: 1, tokens: [3] }),
      makeEvent(15, 'tb.bootDrawn', { playerId: 'p1' }),
    );
    const nextFish = (after.view.modules!.tradersBarbarians as Record<string, Record<string, unknown>>)['tb-fishing']!;
    nextFish.mine = [1, 3];
    nextFish.boot = 'p1';
    nextFish.tokenCounts = { p1: 2 };
    after.view.players[0]!.ownScore = 5;
    after.view.players[0]!.victoryTarget = 11;
    let held = delivery === 'events' ? tableReducer(before, { type: 'events', events: after.view.events }) : before;
    held = tableReducer(held, { type: 'snapshot', snapshot: after });
    const display = (state: TableState) => {
      const controller = { ...tbController(engine), state };
      return <LocaleProvider locale="en"><TbPanel controller={controller} /><PlayersPanel controller={controller} /></LocaleProvider>;
    };
    const { rerender } = render(display(held));
    expect(screen.queryByTestId('tb-fish-token-1')).toBeNull();
    expect(screen.getByTestId('tb-fishing').textContent).toContain('still in the supply');
    expect(screen.getByTestId('seat-0').querySelector('.seat__score')!.textContent).not.toContain('5');
    rerender(display(tableReducer(held, { type: 'dice-presenting', value: false })));
    expect(screen.getByTestId('tb-fish-token-1').textContent).toContain('3 fish');
    expect(screen.getByTestId('tb-fishing').textContent).toContain('needs 1 more VP');
    expect(screen.getByTestId('seat-0').querySelector('.seat__score')!.textContent).toContain('5');
  });

  it('freezes the pre-roll hand from the first render of a rolled update until the dice settle', () => {
    let state = tableReducer(base(), { type: 'snapshot', snapshot: rolledSnapshot(9) });
    expect(state.dicePresenting).toBe(true);
    expect(state.rollHold?.hand?.lumber).toBe(2);
    expect(shownHand(state)?.lumber).toBe(2);

    // 演出期間的後續投影不改寫已凍結的擲骰前手牌。
    const later = rolledSnapshot(9);
    later.view.seq = 15;
    later.revision = 15;
    later.view.events = [...later.view.events, makeEvent(15, 'turn.rolled', { dice: [1, 2], total: 3 })];
    state = tableReducer(state, { type: 'snapshot', snapshot: later });
    expect(state.rollHold?.hand?.lumber).toBe(2);

    state = tableReducer(state, { type: 'dice-presenting', value: false });
    expect(state.rollHold).toBeNull();
    expect(shownHand(state)?.lumber).toBe(9);
  });

  it('also holds on an events-first roll and ignores updates without a new roll', () => {
    const events = tableReducer(base(), { type: 'events', events: [makeEvent(13, 'turn.rolled', { dice: [6, 6], total: 12 })] });
    expect(events.dicePresenting).toBe(true);
    expect(events.rollHold?.hand?.lumber).toBe(2);

    const quiet = makeSnapshot({ ...makeView({ hints: makeHints() }), seq: 13, events: [makeEvent(13, 'build.road')] }, 13);
    expect(tableReducer(base(), { type: 'snapshot', snapshot: quiet }).dicePresenting).toBe(false);
  });

  it('keeps public hand sizes and the event log at their pre-roll state until the dice settle', () => {
    const presenting = tableReducer(base(), { type: 'snapshot', snapshot: rolledSnapshot(9) });
    const view = (state: TableState) => {
      const controller: TableController = { state, dispatch: vi.fn(), actions: {} as TableController['actions'] };
      return <LocaleProvider locale="en"><PlayersPanel controller={controller} /><EventLog controller={controller} /></LocaleProvider>;
    };
    const handSize = (seat: number) =>
      screen.getByTestId(`seat-${seat}`).querySelector('[aria-label^="Cards in hand"]')!.getAttribute('aria-label');
    const seqs = () => [...screen.getByTestId('event-list').querySelectorAll('[data-event]')].map((item) => item.getAttribute('data-event'));

    const { rerender } = render(view(presenting));
    expect(handSize(0)).toBe('Cards in hand: 10');
    expect(handSize(1)).toBe('Cards in hand: 10');
    expect(seqs()).toEqual(['turn.started']);
    expect(screen.queryByTestId('last-dice')).toBeNull();

    rerender(view(tableReducer(presenting, { type: 'dice-presenting', value: false })));
    expect(handSize(0)).toBe('Cards in hand: 17');
    expect(handSize(1)).toBe('Cards in hand: 13');
    expect(seqs()).toEqual(['production.resolved', 'turn.rolled', 'turn.started']);
    expect(screen.getByTestId('last-dice').textContent).toContain('3');
  });

  it('checks trade terms against the held hand while the dice are presenting', () => {
    const state: TableState = { ...tableReducer(base(), { type: 'snapshot', snapshot: rolledSnapshot(9) }) };
    const controller: TableController = { state, dispatch: vi.fn(), actions: {} as TableController['actions'] };
    render(<TradePanel controller={controller} />);
    expect(screen.getByTestId('give-owned-lumber').textContent).toBe('持有 2');
  });

  it.each(['snapshot', 'events'] as const)('holds commodity cards, tallies and trade counts when the roll arrives as %s', (delivery) => {
    const before = base();
    const module = { citiesKnights: { barbarian: { position: 0, length: 7, attacks: 0 } } };
    before.game!.view.modules = module;
    before.game!.view.players[0]!.commodities = { paper: 1, cloth: 0, coin: 0 };
    before.game!.view.players[0]!.handSize = 11;
    const after = rolledSnapshot(9);
    after.view.modules = module;
    after.view.players[0]!.commodities = { paper: 3, cloth: 1, coin: 2 };
    after.view.players[0]!.handSize = 23;
    after.view.events.push(makeEvent(15, 'ck.commoditiesProduced', { total: 6, grants: { p1: { paper: 2, cloth: 1, coin: 2 } } }));
    after.view.seq = after.revision = 15;

    let presenting = delivery === 'events'
      ? tableReducer(before, { type: 'events', events: after.view.events }) : before;
    presenting = tableReducer(presenting, { type: 'snapshot', snapshot: after });
    const view = (state: TableState) => {
      const controller = { state, dispatch: vi.fn(), actions: {} as TableController['actions'] };
      return <LocaleProvider locale="en"><HandPanel controller={controller} /><TradePanel controller={controller} /></LocaleProvider>;
    };
    const count = (kind: string) => screen.getByTestId(`resource-${kind}`).querySelector('.resource-tally__count')!.textContent;
    const total = () => screen.getByTestId('resource-tally-total').querySelector('.resource-tally__count')!.textContent;
    const { rerender } = render(view(presenting));
    expect(shownHand(presenting)?.paper).toBe(1);
    expect(count('paper')).toBe('1');
    expect(count('cloth')).toBe('0');
    expect(count('coin')).toBe('0');
    expect(total()).toBe('12'); // 11 資源與商品 + 1 發展卡。
    expect(screen.queryAllByTestId(/^resource-card-paper-/)).toHaveLength(1);
    expect(screen.queryByTestId('resource-card-cloth-0')).toBeNull();
    expect(screen.queryByTestId('resource-card-coin-0')).toBeNull();
    expect(screen.getByTestId('give-owned-paper').textContent).toBe('Have 1');
    expect(screen.getByTestId('give-owned-cloth').textContent).toBe('Have 0');

    rerender(view(tableReducer(presenting, { type: 'dice-presenting', value: false })));
    expect(count('paper')).toBe('3');
    expect(count('cloth')).toBe('1');
    expect(count('coin')).toBe('2');
    expect(total()).toBe('24');
    expect(screen.queryAllByTestId(/^resource-card-paper-/)).toHaveLength(3);
    expect(screen.queryAllByTestId(/^resource-card-cloth-/)).toHaveLength(1);
    expect(screen.queryAllByTestId(/^resource-card-coin-/)).toHaveLength(2);
    expect(screen.getByTestId('give-owned-paper').textContent).toBe('Have 3');
    expect(screen.getByTestId('give-owned-cloth').textContent).toBe('Have 1');
  });

  it.each(['snapshot', 'events'] as const)('holds C&K badge, panel and scores when the roll arrives as %s', (delivery) => {
    const before = base();
    const previous = {
      barbarian: { position: 6, length: 7, attacks: 0 },
      barbarianStrength: 3, defenderStrength: 2,
      lastRoll: { event: 'science', red: 2, atSeq: 11 },
      knights: [{ player: 'p1', vertex: 0, level: 2, active: true }],
      progressCounts: { p1: 1 }, progressVp: { p1: [] as string[] },
      decks: { science: 18, trade: 18, politics: 18 },
      commodityBank: { paper: 2, cloth: 2, coin: 2 },
    };
    before.game!.view.modules = { citiesKnights: previous };
    before.game!.view.players[0]!.progressCards = ['alchemy'];
    before.game!.view.players[0]!.ownScore = 2;
    const after = rolledSnapshot(9);
    after.view.modules = { citiesKnights: {
      ...previous,
      barbarian: { position: 0, length: 7, attacks: 1 },
      defenderStrength: 0, robberActive: true,
      lastRoll: { event: 'ship', red: 6, atSeq: 13 },
      knights: [{ player: 'p1', vertex: 0, level: 2, active: false }],
      progressCounts: { p1: 2 }, progressVp: { p1: ['printing'] },
      decks: { science: 16, trade: 18, politics: 18 },
      commodityBank: { paper: 1, cloth: 2, coin: 2 },
    } };
    after.view.players[0]!.progressCards = ['alchemy', 'crane'];
    after.view.players[0]!.defenders = 1;
    after.view.players[0]!.publicScore = after.view.players[0]!.ownScore = 4;
    let presenting = delivery === 'events' ? tableReducer(before, { type: 'events', events: after.view.events }) : before;
    presenting = tableReducer(presenting, { type: 'snapshot', snapshot: after });
    // 後續投影也不得取代擲骰前的 C&K baseline。
    const later = { ...after, revision: 15, view: { ...after.view, seq: 15 } };
    presenting = tableReducer(presenting, { type: 'snapshot', snapshot: later });
    expect(shownCitiesKnights(presenting)).toBe(before.game!.view);
    const view = (state: TableState) => {
      const controller = { state, dispatch: vi.fn(), actions: {} as TableController['actions'] };
      return <LocaleProvider locale="en"><BoardView controller={controller} /><CitiesKnightsPanel controller={controller} /><PlayersPanel controller={controller} /></LocaleProvider>;
    };
    const mark = (id: string) => screen.getByTestId(id).querySelector('.score-mark__value')!.textContent;
    const { rerender } = render(view(presenting));
    expect(screen.getByTestId('ck-badge').getAttribute('data-position')).toBe('6');
    expect(screen.getByTestId('ck-badge-event').getAttribute('data-face')).toBe('science');
    expect(screen.getByTestId('ck-barbarian-track').getAttribute('data-position')).toBe('6');
    expect(screen.getByTestId('ck-red-die').getAttribute('data-value')).toBe('2');
    expect(screen.getByTestId('ck-event-die').getAttribute('data-face')).toBe('science');
    expect(screen.queryByTestId('ck-card-crane')).toBeNull();
    expect(screen.getByTestId('ck-card-alchemy').getAttribute('data-card')).toBe('alchemy');
    expect(screen.queryByTestId('ck-progress-vp')).toBeNull();
    // 投影的商品存量只到 2（#137）：等於上限顯示「2+」，螢幕閱讀器讀「至少 2」。
    expect(screen.getByTestId('ck-supply-paper').querySelector('strong [aria-hidden="true"]')!.textContent).toBe('2+');
    expect(screen.getByTestId('ck-supply-paper').querySelector('strong .visually-hidden')!.textContent).toBe('at least 2');
    expect(mark('players-progress-0')).toBe('1');
    expect(mark('players-knights-0')).toBe('2');
    expect(screen.queryByTestId('players-defender-0')).toBeNull();
    expect(screen.queryByTestId('players-progress-vp-0')).toBeNull();
    expect(screen.getByTestId('seat-0').querySelector('.seat__score')!.textContent).toContain('2');

    const revealed = tableReducer(presenting, { type: 'dice-presenting', value: false });
    expect(revealed.rollHold).toBeNull();
    expect(shownCitiesKnights(revealed)).toBe(later.view);
    rerender(view(revealed));
    expect(screen.getByTestId('ck-badge').getAttribute('data-position')).toBe('0');
    expect(screen.getByTestId('ck-badge-event').getAttribute('data-face')).toBe('ship');
    expect(screen.getByTestId('ck-barbarian-track').getAttribute('data-position')).toBe('0');
    expect(screen.getByTestId('ck-red-die').getAttribute('data-value')).toBe('6');
    expect(screen.getByTestId('ck-event-die').getAttribute('data-face')).toBe('ship');
    expect(screen.getByTestId('ck-card-crane').getAttribute('data-card')).toBe('crane');
    expect(screen.getByTestId('ck-progress-vp').textContent).toContain('Printing');
    expect(screen.getByTestId('ck-supply-paper').querySelector('strong')!.textContent).toBe('1');
    expect(mark('players-progress-0')).toBe('2');
    expect(mark('players-knights-0')).toBe('0');
    expect(mark('players-defender-0')).toBe('1');
    expect(mark('players-progress-vp-0')).toBe('1');
    expect(screen.getByTestId('seat-0').querySelector('.seat__score')!.textContent).toContain('4');
  });
});

describe('dice presentation flag', () => {
  let media: EventTarget & { matches: boolean };
  beforeEach(() => {
    vi.useFakeTimers();
    media = Object.assign(new EventTarget(), { matches: false });
    vi.spyOn(globalThis, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  });
  afterEach(() => vi.useRealTimers());

  it('stays presenting while a later roll waits behind an earlier roll’s effects', () => {
    const onDiceChange = vi.fn();
    const props = (seq: number, events = [makeEvent(seq, 'turn.rolled', { dice: [3, 4] })]) => ({
      snapshot: makeSnapshot({ ...makeView({ events }), seq }, seq),
      sync: { generation: 1, cause: 'snapshot' as const },
    });
    const { result, rerender, unmount } = renderHook(
      (input: ReturnType<typeof props>) => useBoardAnimation(input.snapshot, input.sync, true, false, onDiceChange),
      { initialProps: props(12), wrapper: StrictMode },
    );
    const latest = () => onDiceChange.mock.calls.at(-1)?.[0];
    expect(latest()).toBe(false);
    rerender(props(15, [
      makeEvent(13, 'turn.rolled', { dice: [2, 6] }),
      makeEvent(14, 'production.resolved'),
      makeEvent(15, 'turn.rolled', { dice: [1, 1] }),
    ]));
    expect(latest()).toBe(true);
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS));
    // 第一組特效播放、第二顆骰子排隊中：仍視為演出中。
    expect(result.current.activeDice).toBeNull();
    expect(result.current.active?.events[0]?.seq).toBe(13);
    expect(latest()).toBe(true);
    act(() => vi.advanceTimersByTime(MAX_EFFECT_DURATION_MS));
    expect(result.current.activeDice?.seq).toBe(15);
    expect(latest()).toBe(true);
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS));
    expect(latest()).toBe(false);
    unmount();
    expect(latest()).toBe(false);
  });

  it.each([
    ['an ordinary roll', [3, 4] as [number, number], undefined],
    ['a seven with its discard', [2, 5] as [number, number], { kind: 'discard', required: { p1: 1 }, waitingFor: ['p1'] } as GameView['pending']],
  ])('keeps %s that arrives as events before its projection', (_name, dice, pending) => {
    const onDiceChange = vi.fn();
    const preroll = makeView({ phase: 'preroll', hints: makeHints() });
    preroll.seq = 12;
    preroll.events = [makeEvent(12, 'turn.started')];
    const before = makeSnapshot(preroll, 12);
    // 事件先到：投影仍是擲骰前的 preroll，只多了擲骰事件。
    const eventsFirst = { ...before, view: { ...preroll, events: [...preroll.events, makeEvent(13, 'turn.rolled', { dice })] } };
    const projected = makeView({ phase: 'action', pending, hints: makeHints() });
    projected.seq = 14;
    projected.events = [makeEvent(13, 'turn.rolled', { dice }), makeEvent(14, pending ? 'discard.required' : 'production.resolved')];
    const after = makeSnapshot(projected, 14);
    type Step = { snapshot: typeof before; cause: 'snapshot' | 'events'; mandatory: boolean };
    const { result, rerender } = renderHook(
      (input: Step) => useBoardAnimation(input.snapshot, { generation: 1, cause: input.cause }, true, input.mandatory, onDiceChange),
      { initialProps: { snapshot: before, cause: 'snapshot', mandatory: true } as Step },
    );
    rerender({ snapshot: eventsFirst, cause: 'events', mandatory: true });
    expect(result.current.activeDice?.seq).toBe(13);
    expect(onDiceChange.mock.calls.at(-1)?.[0]).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    rerender({ snapshot: after, cause: 'snapshot', mandatory: !!pending });
    expect(result.current.activeDice?.seq).toBe(13);
    expect(onDiceChange.mock.calls.at(-1)?.[0]).toBe(true);
    act(() => vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS - 1000));
    expect(result.current.activeDice).toBeNull();
    expect(onDiceChange.mock.calls.at(-1)?.[0]).toBe(false);
  });

  it('corrects a provisional hold when no dice will be presented', () => {
    media.matches = true;
    const onDiceChange = vi.fn();
    const before = base().game;
    const snapshot = rolledSnapshot(9);
    const { rerender } = renderHook(
      (input: { seq: number }) => useBoardAnimation(input.seq === 12 ? before : snapshot, { generation: 1, cause: 'snapshot' }, true, false, onDiceChange),
      { initialProps: { seq: 12 } },
    );
    rerender({ seq: 14 });
    expect(onDiceChange.mock.calls.at(-1)?.[0]).toBe(false);
  });
});
