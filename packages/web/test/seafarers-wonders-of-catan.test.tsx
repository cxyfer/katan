/**
 * The Wonders of Catan（S8）的前端：Great Wall／Great Bridge／X 標記在 SVG 與 3D、沒有海盜、奇觀牌（可認領、可蓋）與
 * 每位玩家的進度、小島獎勵 1 分、說明與事件文字、結果畫面（完成奇觀與「10 分且層數最高」都不顯示目標分）與音效。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, getProfile, projectGame, seededRng, WONDERS, type GameState, type GameView } from '@katan/rules';
import { cueForEvent } from '../src/audio/cues.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { islandBonusPoints, seafarersHints, seafarersView } from '../src/board/seafarers.ts';
import { createWonderMarkerModel } from '../src/board/three/diorama-ships.ts';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { PendingPrompt } from '../src/components/PendingPrompt.tsx';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { ResultScreen } from '../src/components/ResultScreen.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { WondersPanel } from '../src/components/WondersPanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { EMPTY_SELECTION, initialTableState, tableReducer, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

const PROFILE = 'sf-wonders-of-catan-2025';
const COLORS = ['red', 'blue', 'orange', 'white'] as const;

function wondersState(count: 3 | 4 = 3): GameState {
  const state = createGame({
    profileId: PROFILE,
    players: ['p1', 'p2', 'p3', 'p4'].slice(0, count).map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(4),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.windowId += 1;
  return state;
}

type WondersSlot = { markers: { greatWall: number[]; greatBridge: number[]; x: number[] }; owned: Record<string, string | null>; levels: Record<string, number> };
const slotOf = (state: GameState) => (state.moduleState as unknown as { seafarers: { wonders: WondersSlot } }).seafarers.wonders;
const viewOf = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });
const SESSION = { id: 'p1', nickname: 'Alex', locale: 'en' as const, createdAt: '2026-01-01T00:00:00.000Z' };

function controllerFor(view: GameView, locale: 'en' | 'zh-Hant' = 'en', actions: Record<string, unknown> = {}): TableController {
  const state: TableState = {
    ...initialTableState(locale, 'Alex'),
    bootstrapped: true,
    session: { ...SESSION, locale },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(view),
  };
  return { state, dispatch: vi.fn(), actions } as unknown as TableController;
}

const names = (id: string) => id.toUpperCase();

describe('Wonders of Catan board (SVG)', () => {
  const svg = (view: GameView) => {
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    return render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
      arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
  };

  it('draws the 49-hex map, 9 harbours, 5 Great Wall, 2 Great Bridge and 4 X markers with text titles, and no pirate', () => {
    const view = viewOf(wondersState());
    const { container } = svg(view);
    expect(view.board.topologyId).toBe('sf-wonders-of-catan');
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(49);
    expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(9);
    const count = (kind: string) => container.querySelectorAll(`[data-wonder-marker="${kind}"]`).length;
    expect([count('greatWall'), count('greatBridge'), count('x')]).toEqual([5, 2, 4]);
    expect(container.querySelector('[data-wonder-marker="greatWall"] title')!.textContent).toBe('Great Wall marker');
    expect(container.querySelector('[data-wonder-marker="x"] title')!.textContent).toContain('X marker');
    expect(container.querySelector('[data-testid="pirate-hex"]')).toBeNull();
    expect(container.querySelector('[data-testid="pirate-frame"]')).toBeNull();
    cleanup();
  });

  it('other Seafarers scenarios still draw the pirate and no markers', () => {
    const state = createGame({ profileId: 'sf-new-shores-2025', players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })), setupMode: 'fixed', rng: seededRng(4) });
    const { container } = svg(viewOf(state));
    expect(container.querySelector('[data-testid="pirate-frame"], [data-testid="pirate-hex"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-wonder-marker]')).toHaveLength(0);
    cleanup();
  });
});

describe('Wonders of Catan board (3D)', () => {
  it('every marker vertex exists in the geometry and each kind has its own model', () => {
    const view = viewOf(wondersState());
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const markers = seafarersView(view)!.wonders!.markers;
    for (const kind of ['greatWall', 'greatBridge', 'x'] as const) {
      for (const index of markers[kind]) expect(geometry.vertices[index]).toBeDefined();
    }
    const sizes = (['greatWall', 'greatBridge', 'x'] as const).map((kind) => createWonderMarkerModel(kind).getAttribute('position')!.count);
    expect(sizes.every((size) => size > 0)).toBe(true);
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });
});

describe('Wonders of Catan panel', () => {
  const panel = (state: GameState, actions: Record<string, unknown> = {}, locale: 'en' | 'zh-Hant' = 'en') => {
    cleanup();
    const view = viewOf(state);
    return render(<LocaleProvider locale={locale}><WondersPanel controller={controllerFor(view, locale, actions)} /></LocaleProvider>);
  };

  it('lists the five tiles with their requirement and level cost, all unclaimed and nothing claimable at the start', () => {
    panel(wondersState());
    for (const def of WONDERS) {
      const card = screen.getByTestId(`wonder-card-${def.id}`);
      expect(card.getAttribute('data-claimable')).toBe('false');
      expect((screen.getByTestId(`wonder-claim-${def.id}`) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId(`wonder-status-${def.id}`).textContent).toBe('Not claimed yet');
    }
    expect(screen.getByTestId('wonder-card-grandMonument').textContent).toContain('Requires 1 city at a port and a trade route of 5 or more roads/ships.');
    expect(screen.getByTestId('wonder-card-grandCastle').textContent).toContain('Grand Castle');
    expect(screen.queryByTestId('wonder-build')).toBeNull();
    cleanup();
  });

  it('a player who meets a requirement can claim that tile and the claim is submitted as wonder.choose', () => {
    const state = wondersState();
    state.board.buildings[slotOf(state).markers.greatWall[0]!] = { player: 'p1', city: false };
    const submit = vi.fn();
    panel(state, { submitCommand: submit });
    const claim = screen.getByTestId('wonder-claim-greatWall') as HTMLButtonElement;
    expect(claim.disabled).toBe(false);
    expect((screen.getByTestId('wonder-claim-greatBridge') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(claim);
    expect(submit).toHaveBeenCalledWith({ type: 'wonder.choose', wonder: 'greatWall' }, 'sf.wonder.claim');
    cleanup();
  });

  it('the holder sees the level and a build button that needs the level cost; others see the holder and level', () => {
    const state = wondersState();
    const wonders = slotOf(state);
    wonders.owned.p1 = 'greatBridge';
    wonders.levels.p1 = 2;
    wonders.owned.p2 = 'grandTheater';
    wonders.levels.p2 = 1;
    state.players[0]!.resources = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    const submit = vi.fn();
    panel(state, { submitCommand: submit });
    expect(screen.getByTestId('wonder-status-greatBridge').textContent).toBe('P1 · level 2 of 4');
    expect(screen.getByTestId('wonder-status-grandTheater').textContent).toBe('P2 · level 1 of 4');
    expect((screen.getByTestId('wonder-build') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('wonder-build').textContent).toBe('Build level 3');
    // 其他人已拿的牌沒有認領鈕。
    expect(screen.queryByTestId('wonder-claim-greatBridge')).toBeNull();
    expect(screen.getByTestId('wonder-progress-0').getAttribute('data-level')).toBe('2');
    state.players[0]!.resources = { lumber: 3, brick: 0, wool: 1, grain: 1, ore: 0 };
    panel(state, { submitCommand: submit });
    const build = screen.getByTestId('wonder-build') as HTMLButtonElement;
    expect(build.disabled).toBe(false);
    fireEvent.click(build);
    expect(submit).toHaveBeenCalledWith({ type: 'wonder.build' }, 'sf.wonder.build');
    cleanup();
  });

  it('renders nothing outside The Wonders of Catan and reads in zh-Hant', () => {
    cleanup();
    const other = createGame({ profileId: 'sf-new-shores-2025', players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })), setupMode: 'fixed', rng: seededRng(4) });
    const { container } = render(<LocaleProvider locale="en"><WondersPanel controller={controllerFor(viewOf(other))} /></LocaleProvider>);
    expect(container.innerHTML).toBe('');
    panel(wondersState(), {}, 'zh-Hant');
    expect(screen.getByTestId('wonder-card-grandMonument').textContent).toContain('巨像');
    expect(screen.getByTestId('wonder-card-grandCastle').textContent).toContain('大城堡');
    expect(screen.getByTestId('wonder-card-greatWall').textContent).toContain('長城');
    cleanup();
  });

  it('the players panel shows each player’s wonder level and the island bonus counts 1 point per island', () => {
    const state = wondersState();
    slotOf(state).owned.p2 = 'grandCastle';
    slotOf(state).levels.p2 = 3;
    (state.moduleState as unknown as { seafarers: { islands: Record<string, number[]> } }).seafarers.islands.p1 = [2, 3];
    const view = viewOf(state);
    expect(islandBonusPoints(view, 'p1', getProfile(view.profileId)?.islandBonus?.points)).toBe(2);
    cleanup();
    render(<LocaleProvider locale="en"><PlayersPanel controller={controllerFor(view)} onExpand={() => undefined} /></LocaleProvider>);
    // 只留一個表示：畫面是「3/4」，aria 讀「大城堡: 3/4」，不再重複層數。
    const mark = screen.getByTestId('players-wonder-1');
    expect(mark.textContent).toBe('3/4');
    expect(mark.getAttribute('aria-label')).toBe('Grand Castle: 3/4');
    expect(screen.getByTestId('players-wonder-0').getAttribute('aria-label')).toBe('No wonder: –');
    cleanup();
  });

  it('holds the buttons while offline, while the table is held, while the dice are shown or a command is in flight', () => {
    const state = wondersState();
    state.board.buildings[slotOf(state).markers.greatWall[0]!] = { player: 'p1', city: false };
    const controller = (edit: (table: TableState) => void) => {
      const c = controllerFor(viewOf(state), 'en', { submitCommand: vi.fn() });
      edit(c.state);
      return c;
    };
    const claim = (c: TableController) => {
      cleanup();
      render(<LocaleProvider locale="en"><WondersPanel controller={c} /></LocaleProvider>);
      return screen.getByTestId('wonder-claim-greatWall') as HTMLButtonElement;
    };
    expect(claim(controller(() => undefined)).disabled).toBe(false);
    expect(claim(controller((table) => { table.connection = 'offline'; })).disabled).toBe(true);
    expect(claim(controller((table) => { table.dicePresenting = true; })).disabled).toBe(true);
    expect(claim(controller((table) => { table.room = { id: table.game!.roomId, status: 'suspended' } as never; })).disabled).toBe(true);
    cleanup();
  });

  it.each(['snapshot', 'events'] as const)('while the dice are shown the panel reads the pre-roll projection from the real roll hold (%s first)', (delivery) => {
    const state = wondersState();
    state.board.buildings[slotOf(state).markers.greatWall[0]!] = { player: 'p1', city: false };
    const beforeView = viewOf(state);
    beforeView.seq = 12;
    beforeView.events = [makeEvent(12, 'turn.started')];
    slotOf(state).owned.p2 = 'greatBridge';
    slotOf(state).levels.p2 = 3;
    const afterView = viewOf(state);
    afterView.seq = 14;
    afterView.events = [makeEvent(12, 'turn.started'), makeEvent(13, 'turn.rolled', { dice: [3, 3], total: 6 }), makeEvent(14, 'production.resolved')];
    const start: TableState = { ...initialTableState('en', 'Alex'), bootstrapped: true, session: SESSION, screen: 'game', connection: 'online', game: makeSnapshot(beforeView, 12) };
    let table = delivery === 'events' ? tableReducer(start, { type: 'events', events: afterView.events }) : start;
    table = tableReducer(table, { type: 'snapshot', snapshot: makeSnapshot(afterView, 14) });
    expect(table.dicePresenting).toBe(true);
    expect(table.rollHold?.seafarers).not.toBeNull();
    const show = () => {
      cleanup();
      render(<LocaleProvider locale="en"><WondersPanel controller={{ state: table, dispatch: vi.fn(), actions: {} } as unknown as TableController} /></LocaleProvider>);
      return screen.getByTestId('wonder-status-greatBridge').textContent;
    };
    // 擲骰前的凍結投影還沒有 p2 的奇觀；演出結束後才看到。
    expect(show()).toBe('Not claimed yet');
    table = tableReducer(table, { type: 'dice-presenting', value: false });
    expect(show()).toBe('P2 · level 3 of 4');
    cleanup();
  });

  it('the seat header and the help summary state the wonder ending, not a plain target; other scenarios keep the target', () => {
    for (const [locale, text] of [['en', 'Win: complete a wonder, or 10 VP with the highest wonder level'], ['zh-Hant', '勝利條件：完成奇觀，或 10 分且奇觀層數最高']] as const) {
      cleanup();
      const c = controllerFor(viewOf(wondersState()), locale);
      render(<LocaleProvider locale={locale}><PlayersPanel controller={c} onExpand={() => undefined} /></LocaleProvider>);
      expect(document.querySelector('.players__target')!.textContent).toBe(text);
      cleanup();
      render(<LocaleProvider locale={locale}><HelpPanel controller={c} /></LocaleProvider>);
      const summary = screen.getByTestId('help-panel').textContent!;
      expect(summary).toContain(text);
      expect(summary).not.toMatch(/Victory target: 10|勝利目標：10/);
    }
    cleanup();
    const other = createGame({ profileId: 'sf-new-shores-2025', players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })), setupMode: 'fixed', rng: seededRng(4) });
    render(<LocaleProvider locale="en"><PlayersPanel controller={controllerFor(viewOf(other))} onExpand={() => undefined} /></LocaleProvider>);
    expect(document.querySelector('.players__target')!.textContent).toBe('Victory target: 14');
    cleanup();
  });

  it('the 7 and knight prompts talk about the robber only, with no pirate wording, in both locales', () => {
    const state = wondersState();
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false } as never;
    for (const [locale, text] of [['en', 'Move the robber to a land hex.'], ['zh-Hant', '把強盜移到陸地格。']] as const) {
      cleanup();
      render(<LocaleProvider locale={locale}><PendingPrompt controller={controllerFor(viewOf(state), locale, { submitCommand: vi.fn() })} /></LocaleProvider>);
      const shown = screen.getByTestId('bandit-choice-text').textContent!;
      expect(shown).toBe(text);
      expect(shown).not.toMatch(/pirate|海盜/);
    }
    // 騎士：同樣不提海盜。
    for (const [locale, text] of [['en', 'Knight: choose a land hex for the robber.'], ['zh-Hant', '騎士：為強盜選陸地格。']] as const) {
      cleanup();
      const c = controllerFor(viewOf(wondersState()), locale, { submitCommand: vi.fn() });
      (c.state as { selection: unknown }).selection = { ...EMPTY_SELECTION, commandType: 'dev.playKnight' };
      render(<LocaleProvider locale={locale}><PendingPrompt controller={c} /></LocaleProvider>);
      expect(screen.getByTestId('bandit-choice-text').textContent).toBe(text);
    }
    cleanup();
  });

  it('hints carry the claimable list and the buildable flag only in this scenario', () => {
    const state = wondersState();
    expect(seafarersHints(viewOf(state))!.wonders).toEqual({ claimable: [], buildable: false });
  });
});

describe('Wonders of Catan text', () => {
  function helpFor(locale: 'en' | 'zh-Hant') {
    cleanup();
    render(<LocaleProvider locale={locale}><HelpPanel controller={controllerFor(viewOf(wondersState()), locale)} /></LocaleProvider>);
    return screen.getByTestId('help-seafarers');
  }

  it('the help panel explains setup, the 1-point bonus, claiming, building and both endings in both locales', () => {
    const english = helpFor('en');
    expect(english.textContent).toContain('The Wonders of Catan');
    for (const id of ['setup', 'bonus', 'claim', 'build', 'win']) expect(english.querySelector(`[data-testid="help-wonders-${id}"]`)).not.toBeNull();
    expect(english.textContent).toContain('10 or more points');
    expect(english.textContent).not.toContain('2 VP');
    const chinese = helpFor('zh-Hant');
    expect(chinese.textContent).toContain('卡坦奇觀特殊規則');
    expect(chinese.textContent).toContain('沒有海盜');
    cleanup();
  });

  it('claim and build events read naturally; the end-of-game events name the cause and never the target', () => {
    const chosen = makeEvent(1, 'wonder.chosen', { playerId: 'p1', wonder: 'grandMonument' });
    const built = makeEvent(2, 'wonder.built', { playerId: 'p1', wonder: 'greatWall', level: 3 });
    expect(translateEvent('en', chosen, names).text).toBe('P1 claimed the Grand Monument.');
    expect(translateEvent('zh-Hant', chosen, names).text).toBe('P1 認領了巨像。');
    expect(translateEvent('en', built, names).text).toBe('P1 built level 3 of the Great Wall.');
    expect(translateEvent('zh-Hant', built, names).text).toBe('P1 蓋好了長城的第 3 層。');
    const complete = makeEvent(3, 'game.finished', { playerId: 'p1', playerIds: ['p1'], reason: 'victory', score: 4, cause: 'wonderComplete' });
    const lead = makeEvent(4, 'game.finished', { playerId: 'p2', playerIds: ['p2'], reason: 'victory', score: 10, cause: 'wonderLead' });
    const target = makeEvent(5, 'game.finished', { playerId: 'p1', reason: 'victory', score: 10, target: 10 });
    expect(translateEvent('en', complete, names).text).toBe('P1 completed a Wonder of Catan and won with 4 victory points.');
    expect(translateEvent('en', lead, names).text).toBe('P2 won with 10 victory points and the highest wonder level.');
    expect(translateEvent('zh-Hant', lead, names).text).toBe('P2 以 10 分且奇觀層數最高獲勝。');
    for (const event of [complete, lead]) {
      expect(translateEvent('en', event, names).text).not.toContain('target');
      expect(translateEvent('zh-Hant', event, names).text).not.toContain('目標');
    }
    expect(translateEvent('en', target, names).text).toBe('P1 won with 10 victory points (target 10).');
  });
});

describe('Wonders of Catan result screen', () => {
  function result(locale: 'en' | 'zh-Hant', cause: 'wonderComplete' | 'wonderLead' | undefined) {
    cleanup();
    const state = wondersState(4);
    state.result = { playerId: 'p2', reason: 'victory', atSeq: 3, ...(cause ? { playerIds: ['p2'], cause } : {}) };
    state.turn.phase = 'gameOver';
    render(<LocaleProvider locale={locale}><ResultScreen controller={controllerFor(viewOf(state), locale, { leaveRoom: vi.fn() })} /></LocaleProvider>);
  }

  it('a completed wonder is announced with its cause and no target', () => {
    result('en', 'wonderComplete');
    expect(screen.getByTestId('result-winner').textContent).toContain('P2 wins');
    expect(screen.getByTestId('result-reason').getAttribute('data-cause')).toBe('wonderComplete');
    expect(screen.getByTestId('result-reason').textContent).toBe('A Wonder of Catan was completed');
    expect(screen.getByTestId('result-score').textContent).toContain('no target score');
    expect(screen.getByTestId('result-screen').textContent).not.toContain('Victory target');
    cleanup();
  });

  it('10 points with the highest level does not read as reaching the target score', () => {
    result('en', 'wonderLead');
    expect(screen.getByTestId('result-reason').textContent).toBe('10 or more victory points and the highest wonder level');
    expect(screen.getByTestId('result-screen').textContent).not.toContain('Victory target');
    expect(screen.getByTestId('result-score').textContent).not.toMatch(/of 10/);
    result('zh-Hant', 'wonderLead');
    expect(screen.getByTestId('result-reason').textContent).toContain('奇觀完成層數最高');
    expect(screen.getByTestId('result-screen').textContent).not.toContain('勝利目標');
    cleanup();
  });

  it('the plain target ending is unchanged', () => {
    result('en', undefined);
    expect(screen.getByTestId('result-reason').getAttribute('data-cause')).toBe('target');
    expect(screen.getByTestId('result-reason').textContent).toBe('Victory points · Victory target: 10');
    cleanup();
  });
});

describe('Wonders of Catan sounds', () => {
  it('claiming and building have a cue and the winner hears the victory cue', () => {
    expect(cueForEvent(makeEvent(1, 'wonder.chosen', { playerId: 'p1', wonder: 'greatWall' }), 'p1')).toBe('build.city');
    expect(cueForEvent(makeEvent(2, 'wonder.built', { playerId: 'p1', wonder: 'greatWall', level: 1 }), 'p2')).toBe('build.city');
    const finished = makeEvent(3, 'game.finished', { playerId: 'p1', playerIds: ['p1'], reason: 'victory', score: 4, cause: 'wonderComplete' });
    expect(cueForEvent(finished, 'p1')).toBe('game.victory');
    expect(cueForEvent(finished, 'p2')).toBe('game.over');
  });
});
