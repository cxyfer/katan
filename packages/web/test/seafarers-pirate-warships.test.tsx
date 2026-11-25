/**
 * The Pirate Islands（S7c）的前端：戰船（SVG 與 3D 橫放）、騎士牌改裝戰船的按鈕（沒有可改的船時停用並說明）、
 * 進攻與收復的紀錄文字與音效（zh-Hant 與 en）、收復後的堡壘外觀、海盜移出後不再畫航道、HelpPanel 的劇本規則、結果畫面。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameState, type GameView } from '@katan/rules';
import { buildGeometry } from '../src/board/geometry.ts';
import { seafarersHints, seafarersView } from '../src/board/seafarers.ts';
import { createRecapturedBannerModel } from '../src/board/three/diorama-pirate-islands.ts';
import { createShipModel, createWarshipModel, shipInstances } from '../src/board/three/diorama-ships.ts';
import { DevCardPanel } from '../src/components/DevCardPanel.tsx';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { ResultScreen } from '../src/components/ResultScreen.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { t as translate } from '../src/i18n/index.ts';
import { cueForEvent } from '../src/audio/cues.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

const PROFILE = 'sf-pirate-islands-2025';
const COLORS = ['red', 'blue', 'orange', 'white'] as const;
const SESSION = { id: 'p1', nickname: 'Alex', locale: 'en' as const, createdAt: '2026-01-01T00:00:00.000Z' };

function pirateState(): GameState {
  const state = createGame({
    profileId: PROFILE,
    players: ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(4),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.windowId += 1;
  return state;
}
const slotOf = (state: GameState) => (state.moduleState as unknown as { seafarers: { pirateIslands: { warships: Record<string, number[]>; lines: Record<string, { edges: number[] }>; fortresses: { player: string; lairs: number; vertex: number }[] } } }).seafarers.pirateIslands;
const viewOf = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });

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

const svg = (view: GameView) => {
  const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
  return render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
    arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
    viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id.toUpperCase()} /></LocaleProvider>);
};

describe('warships on the board', () => {
  it('SVG: a warship lies on its side with a distinct title; ordinary ships stay upright', () => {
    const state = pirateState();
    const [first, second] = slotOf(state).lines.p1!.edges.concat([-1]);
    expect(first).toBeDefined();
    slotOf(state).warships.p1 = [first!];
    const { container } = svg(viewOf(state));
    const war = container.querySelector(`[data-testid="ship-${first}"]`)!;
    expect(war.querySelector('[data-warship="true"]')).not.toBeNull();
    expect(war.querySelector('title')!.textContent).toBe('Warship · P1');
    // 其他玩家的預置船仍是一般船。
    const other = slotOf(state).lines.p2!.edges[0]!;
    expect(container.querySelector(`[data-testid="ship-${other}"]`)!.querySelector('[data-warship="true"]')).toBeNull();
    expect(container.querySelector(`[data-testid="ship-${other}"] title`)!.textContent).toBe('Ship · P2');
    expect(second).toBeDefined();
    cleanup();
  });

  it('3D: warship instances carry the flag and the model is heeled over (lower and wider than the upright cog)', () => {
    const state = pirateState();
    const edge = slotOf(state).lines.p1!.edges[0]!;
    slotOf(state).warships.p1 = [edge];
    const view = viewOf(state);
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const instances = shipInstances(geometry, view.board, [], seafarersView(view)!.pirateIslands!.warships);
    expect(instances.find((item) => item.index === edge)!.warship).toBe(true);
    expect(instances.filter((item) => item.warship)).toHaveLength(1);
    const upright = createShipModel('#cc3333', 0);
    const war = createWarshipModel('#cc3333', 0);
    upright.computeBoundingBox();
    war.computeBoundingBox();
    const height = (box: typeof upright.boundingBox) => box!.max.y - box!.min.y;
    const depth = (box: typeof upright.boundingBox) => box!.max.z - box!.min.z;
    expect(height(war.boundingBox)).toBeLessThan(height(upright.boundingBox));
    expect(depth(war.boundingBox)).toBeGreaterThan(depth(upright.boundingBox));
    // 側躺後仍在水面之上（不沉入水中）。
    expect(war.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(createRecapturedBannerModel('#cc3333').getAttribute('position')!.count).toBeGreaterThan(0);
  });

  it('a recaptured fortress shows a banner instead of the lair stack, and the pirate and its route are gone once every fortress is recaptured', () => {
    const state = pirateState();
    const fortresses = slotOf(state).fortresses;
    fortresses[0]!.lairs = 0;
    const partial = svg(viewOf(state)).container;
    expect(partial.querySelector(`[data-testid="fortress-${fortresses[0]!.vertex}"]`)!.querySelector('title')!.textContent).toBe('P1’s fortress, recaptured');
    expect(partial.querySelector(`[data-testid="fortress-${fortresses[0]!.vertex}"]`)!.getAttribute('data-lairs')).toBe('0');
    expect(partial.querySelector(`[data-testid="fortress-${fortresses[1]!.vertex}"]`)!.getAttribute('data-lairs')).toBe('3');
    expect(partial.querySelector('[data-testid="pirate-hex"]')).not.toBeNull();
    cleanup();
    for (const fortress of fortresses) fortress.lairs = 0;
    state.board.pirate = null;
    const done = svg(viewOf(state)).container;
    expect(done.querySelector('[data-testid="pirate-hex"]')).toBeNull();
    expect(done.querySelector('[data-testid="pirate-frame"]')).toBeNull();
    expect(done.querySelector('[data-testid="pirate-position"]')).toBeNull();
    expect(done.querySelector('[data-testid="pirate-route"]')).toBeNull();
    expect(done.querySelectorAll('[data-testid^="pirate-route-arrow-"]')).toHaveLength(0);
    expect(done.querySelectorAll('[data-testid^="pirate-step-"]')).toHaveLength(0);
    cleanup();
  });
});

describe('the knight button (warship conversion)', () => {
  function withKnight(edit?: (state: GameState) => void) {
    const state = pirateState();
    state.players[0]!.devCards.push('knight');
    edit?.(state);
    const view = viewOf(state);
    const submitCommand = vi.fn();
    const selectTarget = vi.fn();
    const controller = controllerFor(view, 'en', { submitCommand, selectTarget });
    return { view, submitCommand, selectTarget, controller };
  }

  it('sends the knight without a target hex (no board selection) and says what it does', () => {
    const { controller, submitCommand, selectTarget, view } = withKnight();
    expect(seafarersHints(view)!.pirateLine!.warshipTarget).toBe(slotOf(pirateState()).lines.p1!.edges[0]);
    render(<LocaleProvider locale="en"><DevCardPanel controller={controller} /></LocaleProvider>);
    const button = screen.getByTestId('play-knight-0');
    expect(button.textContent).toBe('Convert a ship (knight)');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent).toContain('Turns the ship closest to your starting settlement into a warship');
    fireEvent.click(button);
    expect(submitCommand).toHaveBeenCalledWith({ type: 'dev.playKnight', hex: null }, 'sf.warship.title');
    expect(selectTarget).not.toHaveBeenCalled();
    cleanup();
  });

  it('is disabled with the reason when no ordinary ship of the line is left', () => {
    const { controller, submitCommand } = withKnight((state) => { slotOf(state).warships.p1 = slotOf(state).lines.p1!.edges.slice(); });
    render(<LocaleProvider locale="en"><DevCardPanel controller={controller} /></LocaleProvider>);
    const button = screen.getByTestId('play-knight-0') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('No ordinary ship on your ship line to convert: build one first.');
    expect(screen.getByTestId('warship-blocked').textContent).toBe(button.title);
    expect(screen.getByTestId('warship-blocked').className).not.toContain('visually-hidden');
    fireEvent.click(button);
    expect(submitCommand).not.toHaveBeenCalled();
    cleanup();
    render(<LocaleProvider locale="zh-Hant"><DevCardPanel controller={controllerFor(viewOf((() => { const s = pirateState(); s.players[0]!.devCards.push('knight'); slotOf(s).warships.p1 = slotOf(s).lines.p1!.edges.slice(); return s; })()), 'zh-Hant', {})} /></LocaleProvider>);
    expect(screen.getByTestId('warship-blocked').textContent).toBe('你的船線上沒有可改裝的一般船：請先蓋船。');
    cleanup();
  });

  it('other scenarios still arm the board to choose a robber hex', () => {
    const state = createGame({ profileId: 'sf-cloth-for-catan-2025', players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })), setupMode: 'fixed', rng: seededRng(4) });
    state.turn.setup = null; state.turn.phase = 'action';
    state.players[0]!.devCards.push('knight');
    const selectTarget = vi.fn();
    render(<LocaleProvider locale="en"><DevCardPanel controller={controllerFor(viewOf(state), 'en', { selectTarget, submitCommand: vi.fn() })} /></LocaleProvider>);
    expect(screen.getByTestId('play-knight-0').textContent).toBe('Play Knight');
    fireEvent.click(screen.getByTestId('play-knight-0'));
    expect(selectTarget).toHaveBeenCalled();
    cleanup();
  });
});

describe('the player panel', () => {
  it('shows the warship count, the line count and the attack warning when the line is at the fortress', () => {
    const state = pirateState();
    slotOf(state).warships.p1 = [slotOf(state).lines.p1!.edges[0]!];
    const c = controllerFor(viewOf(state));
    render(<LocaleProvider locale="en"><PlayersPanel controller={c} onExpand={() => undefined} /></LocaleProvider>);
    const status = screen.getByTestId('warship-status');
    expect(status.textContent).toBe('Warships: 1 (1 on the ship line)');
    expect(status.getAttribute('data-attack')).toBe('false');
    expect(document.querySelector('.players__target')!.textContent).toBe('Win: recapture your fortress and have 10 VP');
    cleanup();
  });
});

describe('the fortress log lines, sounds, help and result', () => {
  const names = (id: string) => id.toUpperCase();
  const text = (locale: 'en' | 'zh-Hant', type: string, params: Record<string, unknown>, scenario?: string) =>
    translateEvent(locale, makeEvent(1, type, params), names, scenario ? { scenario } : undefined);

  it('describes the three attack results, the recapture and the pirate leaving, in both locales', () => {
    const base = { playerId: 'p1', die: 3, warships: 4, lairs: 2, removed: [] };
    expect(text('en', 'fortress.attacked', { ...base, result: 'won' }).text).toBe('P1 attacked the pirate fortress: the die showed 3 against 4 warship(s) on the line, victory: one pirate lair is removed (2 left).');
    expect(text('en', 'fortress.attacked', { ...base, warships: 1, result: 'lost', lairs: 3, removed: [5, 4] }).text).toContain('defeat: the 2 ship(s) closest to the fortress are removed from the line');
    expect(text('en', 'fortress.attacked', { ...base, warships: 3, result: 'tie', lairs: 3, removed: [5] }).text).toContain('a tie is a defeat: the 1 ship closest to the fortress is removed from the line');
    expect(text('zh-Hant', 'fortress.attacked', { ...base, result: 'won' }).text).toBe('P1 進攻海盜堡壘：骰出 3，船線上有 4 艘戰船，獲勝，移除 1 枚海盜巢穴標記（剩 2 枚）。');
    expect(text('zh-Hant', 'fortress.attacked', { ...base, result: 'tie', removed: [9] }).text).toContain('平手視為戰敗');
    expect(text('en', 'fortress.recaptured', { playerId: 'p1' }).text).toBe('P1 recaptured the pirate fortress; it now counts as a settlement.');
    expect(text('zh-Hant', 'fortress.recaptured', { playerId: 'p1' }).text).toBe('P1 收復了海盜堡壘，它現在算一座村落。');
    expect(text('en', 'pirate.removed', { from: 3 }).text).toBe('Every fortress is recaptured: the pirate leaves the game.');
    expect(text('zh-Hant', 'pirate.removed', { from: 3 }).text).toBe('所有堡壘都已收復：海盜退出遊戲。');
    expect(text('en', 'warship.converted', { playerId: 'p1', edge: 22, count: 2 }).text).toBe('P1 turned the ship on edge 22 into a warship (2 warship(s) now).');
    expect(text('zh-Hant', 'warship.converted', { playerId: 'p1', edge: 22, count: 2 }).text).toBe('P1 把航道 22 的船改裝成戰船（現有 2 艘戰船）。');
    for (const type of ['fortress.attacked', 'fortress.recaptured', 'pirate.removed', 'warship.converted']) expect(text('en', type, base).unknown).toBe(false);
  });

  it('the knight line talks about a warship in this scenario only', () => {
    const params = { playerId: 'p1', hex: null, pirate: true, playedKnights: 1 };
    expect(text('en', 'dev.knight', params, 'pirate-islands').text).toBe('P1 played a knight and converted a ship into a warship (1 played).');
    expect(text('zh-Hant', 'dev.knight', params, 'pirate-islands').text).toContain('改裝成戰船');
    expect(text('en', 'dev.knight', params, 'new-shores').text).toContain('moved the pirate');
  });

  it('the ending names its cause', () => {
    expect(text('en', 'game.finished', { playerId: 'p1', score: 10, cause: 'fortressRecaptured' }).text).toBe('P1 recaptured the pirate fortress and won with 10 victory points.');
    expect(text('zh-Hant', 'game.finished', { playerId: 'p1', score: 10, cause: 'fortressRecaptured' }).text).toBe('P1 收復了海盜堡壘，以 10 分獲勝。');
  });

  it('plays a cue for each new event', () => {
    expect(cueForEvent(makeEvent(1, 'warship.converted', { playerId: 'p1' }), 'p1')).toBe('ship.build');
    expect(cueForEvent(makeEvent(2, 'fortress.attacked', { playerId: 'p1', result: 'won' }), 'p1')).toBe('island.bonus');
    expect(cueForEvent(makeEvent(3, 'fortress.attacked', { playerId: 'p1', result: 'lost' }), 'p1')).toBe('robber.stolenFromYou');
    expect(cueForEvent(makeEvent(4, 'fortress.attacked', { playerId: 'p2', result: 'lost' }), 'p1')).toBe('robber.steal');
    expect(cueForEvent(makeEvent(5, 'fortress.attacked', { playerId: 'p1', result: 'tie' }), 'p1')).toBe('ship.move');
    expect(cueForEvent(makeEvent(6, 'fortress.recaptured', { playerId: 'p1' }), 'p1')).toBe('build.city');
    expect(cueForEvent(makeEvent(7, 'pirate.removed', {}), 'p1')).toBe('pirate.move');
  });

  it('has the new ids in both locales', () => {
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const key of ['error.E_NO_WARSHIP_TARGET', 'sf.warship.play', 'sf.warship.noTarget', 'sf.help.pi.title', 'play.resultReason.fortressRecaptured', 'play.resultTarget.pirate']) {
        expect(translate(locale, key as never, { target: 10 }), `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it('the help panel has the scenario rules (line, pirate, 7, warship, attack, win) in both locales and no robber or island bonus wording', () => {
    for (const locale of ['en', 'zh-Hant'] as const) {
      render(<LocaleProvider locale={locale}><HelpPanel controller={controllerFor(viewOf(pirateState()), locale)} /></LocaleProvider>);
      for (const id of ['line', 'cruise', 'seven', 'warship', 'attack', 'win']) expect(screen.getByTestId(`help-pirate-${id}`).textContent!.length).toBeGreaterThan(20);
      const section = screen.getByTestId('help-seafarers').textContent!;
      expect(section).toContain(locale === 'en' ? 'The Pirate Islands' : '海盜巢穴');
      expect(section).not.toMatch(/move either the robber|移動強盜（陸地）/);
      expect(section).not.toMatch(/\+2 victory points|\+2 分/);
      cleanup();
    }
  });

  it('the result screen names the fortress ending', () => {
    for (const [locale, reason] of [['en', 'Recaptured their fortress with 10 or more victory points'], ['zh-Hant', '收復自己的堡壘且達到 10 分以上']] as const) {
      const state = pirateState();
      state.result = { playerId: 'p2', reason: 'victory', atSeq: 3, playerIds: ['p2'], cause: 'fortressRecaptured' };
      state.turn.phase = 'gameOver';
      render(<LocaleProvider locale={locale}><ResultScreen controller={controllerFor(viewOf(state), locale, { leaveRoom: vi.fn() })} /></LocaleProvider>);
      expect(screen.getByTestId('result-reason').getAttribute('data-cause')).toBe('fortressRecaptured');
      expect(screen.getByTestId('result-reason').textContent).toBe(reason);
      cleanup();
    }
  });
});
