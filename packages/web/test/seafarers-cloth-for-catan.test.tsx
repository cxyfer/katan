/**
 * Cloth for Catan（S6）的前端：部落圓片與布匹在 SVG 與 3D 的位置、玩家面板的布匹與分數來源、
 * 偷布匹的選擇、說明與事件文字、結果畫面（單一／共同勝利、布匹耗盡不顯示目標分）與音效。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameState, type GameView } from '@katan/rules';
import { cueForEvent } from '../src/audio/cues.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { clothPoints, seafarersHints, seafarersView } from '../src/board/seafarers.ts';
import { tribeNumberTokens, tribeSpot } from '../src/board/three/diorama-ships.ts';
import { buildStatsRows } from '../src/components/GameStats.tsx';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { PendingPrompt } from '../src/components/PendingPrompt.tsx';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { ResultScreen } from '../src/components/ResultScreen.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { requiredActionFor } from '../src/state/pending.ts';
import { t as translate } from '../src/i18n/index.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

const PROFILE = 'sf-cloth-for-catan-2025';
const COLORS = ['red', 'blue', 'orange', 'white'] as const;

function clothState(count: 3 | 4 = 3): GameState {
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

const slotOf = (state: GameState) => (state.moduleState as unknown as {
  seafarers: { cloth: { tribes: { vertex: number; number: number; cloth: number }[]; supply: number; links: Record<string, number[]>; cloth: Record<string, number> } };
}).seafarers.cloth;

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

describe('Cloth for Catan board (SVG)', () => {
  const svg = (view: GameView) => {
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    return render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
      arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
  };

  it('draws the 42-hex map, 9 harbours, 8 tribe discs with 5 cloth each and the numbers of the table', () => {
    const view = viewOf(clothState());
    const { container } = svg(view);
    expect(view.board.topologyId).toBe('sf-cloth-for-catan');
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(42);
    expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(9);
    const tribes = [...container.querySelectorAll('[data-tribe-number]')];
    expect(tribes).toHaveLength(8);
    expect(tribes.map((node) => Number(node.getAttribute('data-tribe-number'))).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 8, 9, 10, 11]);
    for (const node of tribes) {
      expect(node.getAttribute('data-tribe-cloth')).toBe('5');
      expect(node.textContent).toContain('×5');
      expect(node.querySelector('title')!.textContent).toBe(`Tribe ${node.getAttribute('data-tribe-number')}: 5 cloth`);
    }
    // 沒有島嶼獎勵標記，也沒有禮物。
    expect(container.querySelectorAll('[data-gift-kind]')).toHaveLength(0);
    cleanup();
  });

  it('shows the remaining cloth, an emptied tribe and the players who trade with it', () => {
    const state = clothState(4);
    const cloth = slotOf(state);
    cloth.tribes[0]!.cloth = 3;
    cloth.tribes[1]!.cloth = 0;
    cloth.links.p1 = [0];
    cloth.links.p3 = [0, 1];
    const { container } = svg(viewOf(state));
    const first = container.querySelector('[data-testid="tribe-0"]')!;
    expect(first.getAttribute('data-tribe-cloth')).toBe('3');
    expect(first.getAttribute('data-tribe-linked')).toBe('P1,P3');
    expect(first.querySelector('title')!.textContent).toBe('Tribe 10: 3 cloth · trading: P1, P3');
    expect(first.querySelectorAll('rect')).toHaveLength(6); // 三捲布，每捲兩個矩形（布身與紅條）
    const empty = container.querySelector('[data-testid="tribe-1"]')!;
    expect(empty.getAttribute('data-tribe-cloth')).toBe('0');
    expect(empty.querySelector('title')!.textContent).toBe('Tribe 9: 0 cloth · trading: P3');
    expect(empty.querySelectorAll('rect')).toHaveLength(0);
    cleanup();
  });
});

describe('Cloth for Catan board (3D)', () => {
  it('stands every tribe on its vertex with the stack of cloth pointing away from the island, and gives the 8 discs a number token', () => {
    const view = viewOf(clothState());
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const cloth = seafarersView(view)!.cloth!;
    expect(cloth.tribes).toHaveLength(8);
    const seen = new Set<string>();
    for (const tribe of cloth.tribes) {
      const spot = tribeSpot(geometry, tribe.vertex)!;
      expect(spot).not.toBeNull();
      expect(Math.hypot(spot.outX, spot.outZ)).toBeCloseTo(1, 5);
      // 小島格在頂點的反方向：往外的向量與「頂點 → 小島格中心」相反。
      const land = geometry.topology.vertices[tribe.vertex]!.hexes.find((hex) => geometry.land[hex] !== false)!;
      const centre = geometry.hexes[land]!;
      const toIsland = { x: centre.cx / geometry.scale - spot.x, z: centre.cy / geometry.scale - spot.z };
      expect(spot.outX * toIsland.x + spot.outZ * toIsland.z).toBeLessThan(0);
      seen.add(`${spot.x.toFixed(3)},${spot.z.toFixed(3)}`);
    }
    expect(seen.size).toBe(8);
    const tokens = tribeNumberTokens(geometry, cloth.tribes);
    expect(tokens.map((token) => token.value).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 8, 9, 10, 11]);
    expect(tribeNumberTokens(geometry, undefined)).toEqual([]);
  });
});

describe('Cloth for Catan players panel', () => {
  function panel(locale: 'en' | 'zh-Hant') {
    cleanup();
    const state = clothState();
    const cloth = slotOf(state);
    cloth.cloth.p1 = 5;
    cloth.cloth.p2 = 1;
    cloth.tribes[0]!.cloth = 0;
    cloth.tribes[1]!.cloth = 0;
    cloth.supply = 6;
    render(<LocaleProvider locale={locale}><PlayersPanel controller={controllerFor(viewOf(state, 'p2'), locale)} /></LocaleProvider>);
  }

  it('shows each player’s cloth and its score (2 cloth = 1 point), the supply pile and the empty tribes — and no Longest Road', () => {
    panel('en');
    expect(screen.getByTestId('players-cloth-0').getAttribute('aria-label')).toBe('5 cloth = 2 VP: 5');
    expect(screen.getByTestId('players-cloth-0').textContent).toContain('2');
    expect(screen.getByTestId('players-cloth-1').getAttribute('aria-label')).toBe('1 cloth = 0 VP: 1');
    expect(clothPoints(5)).toBe(2);
    expect(screen.queryByTestId('players-route-0')).toBeNull();
    const status = screen.getByTestId('cloth-status');
    expect(status.getAttribute('data-empty-tribes')).toBe('2');
    expect(status.getAttribute('data-supply')).toBe('6');
    panel('zh-Hant');
    expect(screen.getByTestId('players-cloth-0').getAttribute('aria-label')).toBe('5 枚布匹 = 2 分: 5');
    expect(screen.getByTestId('cloth-status').textContent).toContain('一般供應堆');
    cleanup();
  });
});

describe('Cloth for Catan pirate and stealing cloth', () => {
  /** p1 搬了海盜，旁邊 p2（有牌也有布匹）與 p3（只有布匹）都有船。 */
  function stealing(): GameView {
    const state = clothState();
    const hex = state.board.layout.terrain.findIndex((terrain) => terrain === 'sea');
    state.players[1]!.resources.grain = 2;
    slotOf(state).cloth.p2 = 2;
    slotOf(state).cloth.p3 = 1;
    state.pending = { kind: 'steal', actor: 'p1', hex, candidates: ['p2', 'p3'], pirate: true } as never;
    return viewOf(state);
  }

  it('offers a card or a cloth token per victim; a victim without cards cannot be robbed of one; the choice is submitted as the right command', () => {
    const view = stealing();
    expect(seafarersHints(view)!.clothVictims).toEqual(['p2', 'p3']);
    const submitCommand = vi.fn();
    render(<LocaleProvider locale="en"><PendingPrompt controller={controllerFor(view, 'en', { submitCommand })} /></LocaleProvider>);
    expect(screen.getByTestId('steal-p2').textContent).toBe('P2 · Steal a card');
    expect(screen.getByTestId('steal-cloth-p2').textContent).toBe('P2 · Steal cloth');
    expect((screen.getByTestId('steal-p3') as HTMLButtonElement).disabled).toBe(true); // handSize 0
    fireEvent.click(screen.getByTestId('steal-cloth-p3'));
    expect(submitCommand).toHaveBeenLastCalledWith({ type: 'cloth.steal', victim: 'p3' }, 'play.pending.stealCloth');
    fireEvent.click(screen.getByTestId('steal-p2'));
    expect(submitCommand).toHaveBeenLastCalledWith({ type: 'pending.steal', victim: 'p2' }, 'play.pending.steal');
    cleanup();
  });

  it('the prompt text names a card, a cloth token or both depending on what the victims can lose', () => {
    const titles = (candidates: string[], locale: 'en' | 'zh-Hant') => {
      const state = clothState();
      state.players[1]!.resources.grain = 2; // p2 有牌
      slotOf(state).cloth.p2 = 2;
      slotOf(state).cloth.p3 = 1; // p3 只有布匹
      state.pending = { kind: 'steal', actor: 'p1', hex: 0, candidates, pirate: true } as never;
      const action = requiredActionFor(controllerFor(viewOf(state), locale).state)!;
      return translate(locale, action.messageId, action.params);
    };
    expect(titles(['p2', 'p3'], 'en')).toBe('Choose a player to take one card or one cloth token from.');
    expect(titles(['p3'], 'en')).toBe('Choose a player to take one cloth token from.');
    expect(titles(['p3'], 'zh-Hant')).toBe('選擇一位玩家，從其手中拿一枚布匹。');
    expect(titles(['p2', 'p3'], 'zh-Hant')).toContain('布匹');
    // 機械盜賊（無布匹可偷）的文案不變。
    const robber = clothState();
    robber.players[1]!.resources.grain = 1;
    robber.pending = { kind: 'steal', actor: 'p1', hex: robber.board.robber, candidates: ['p2'], pirate: false } as never;
    const action = requiredActionFor(controllerFor(viewOf(robber)).state)!;
    expect(translate('en', action.messageId)).toBe('Choose a player to take one card from.');
  });

  it('keeps the single button for the robber (no cloth victims)', () => {
    const state = clothState();
    state.players[1]!.resources.grain = 1;
    state.pending = { kind: 'steal', actor: 'p1', hex: state.board.robber, candidates: ['p2'], pirate: false } as never;
    render(<LocaleProvider locale="en"><PendingPrompt controller={controllerFor(viewOf(state), 'en', { submitCommand: vi.fn() })} /></LocaleProvider>);
    expect(screen.getByTestId('steal-p2').textContent).toBe('P2');
    expect(screen.queryByTestId('steal-cloth-p2')).toBeNull();
    cleanup();
  });

  it('publishes no pirate targets until the player has a route to a tribe', () => {
    const state = clothState();
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false } as never;
    expect(seafarersHints(viewOf(state))!.pirateTargets).toEqual([]);
    expect(seafarersHints(viewOf(state))!.robberTargets.length).toBeGreaterThan(0);
    // 提示只提強盜，不叫玩家去移動不能動的海盜。
    render(<LocaleProvider locale="en"><PendingPrompt controller={controllerFor(viewOf(state), 'en', { submitCommand: vi.fn() })} /></LocaleProvider>);
    expect(screen.getByTestId('bandit-choice-text').textContent).toBe('Move the robber to a land hex (the pirate cannot move now).');
    cleanup();
  });
});

describe('Cloth for Catan text', () => {
  const names = (id: string) => id.toUpperCase();

  function helpFor(locale: 'en' | 'zh-Hant') {
    cleanup();
    render(<LocaleProvider locale={locale}><HelpPanel controller={controllerFor(viewOf(clothState()), locale)} /></LocaleProvider>);
    return screen.getByTestId('help-seafarers');
  }

  it('the help panel explains the third settlement, trade, production, scoring, closed routes, the pirate and both endings', () => {
    const english = helpFor('en');
    expect(english.textContent).toContain('Cloth for Catan');
    for (const id of ['setup', 'trade', 'produce', 'score', 'ships', 'pirate', 'win']) expect(english.querySelector(`[data-testid="help-cloth-${id}"]`)).not.toBeNull();
    expect(english.textContent).toContain('14 points');
    expect(english.textContent).toContain('house reading, not an official rule');
    expect(english.textContent).not.toContain('Gold fields');
    expect(english.textContent).not.toContain('+2 victory points');
    const chinese = helpFor('zh-Hant');
    expect(chinese.textContent).toContain('布匹產地特殊規則');
    expect(chinese.textContent).toContain('第三個村莊');
    expect(chinese.textContent).toContain('我們的解釋，不是官方規則');
    cleanup();
  });

  it('trade, production and theft events read naturally in both locales', () => {
    const trade = makeEvent(1, 'cloth.trade', { playerId: 'p1', tribe: 0, number: 10, gained: 1 });
    const tradeEmpty = makeEvent(2, 'cloth.trade', { playerId: 'p1', tribe: 0, number: 10, gained: 0 });
    const produced = makeEvent(3, 'cloth.produced', { tribe: 2, number: 11, gains: { p1: 1, p3: 1 }, fromTribe: 1, fromSupply: 1, shortBy: 0 });
    const short = makeEvent(4, 'cloth.produced', { tribe: 2, number: 11, gains: { p1: 1 }, fromTribe: 1, fromSupply: 0, shortBy: 2 });
    const stolen = makeEvent(5, 'cloth.stolen', { playerId: 'p1', victim: 'p2' });
    expect(translateEvent('en', trade, names).text).toBe('P1 opened trade with the tribe 10 and took 1 cloth.');
    expect(translateEvent('en', tradeEmpty, names).text).toContain('the tribe had no cloth left');
    expect(translateEvent('en', produced, names).text).toBe('Tribe 11 paid out cloth: P1, P3.');
    expect(translateEvent('en', short, names).text).toBe('Tribe 11 paid out cloth: P1 (2 short, the supply ran out).');
    expect(translateEvent('en', stolen, names).text).toBe('P1’s pirate took a cloth token from P2.');
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const event of [trade, tradeEmpty, produced, short, stolen]) {
        const text = translateEvent(locale, event, names);
        expect(text.unknown, `${locale} ${event.type}`).toBe(false);
        expect(text.text).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('setup placements read 1/3 … 3/3 in Cloth for Catan and keep 1/2, 2/2 elsewhere', () => {
    const line = (params: Record<string, unknown>) => translateEvent('en', makeEvent(1, 'setup.building', { playerId: 'p1', vertex: 5, ...params }), names).text;
    expect(line({ round: 3, rounds: 3 })).toBe('P1 placed a 3/3 settlement at intersection 5.');
    expect(line({ round: 2, rounds: 3 })).toBe('P1 placed a 2/3 settlement at intersection 5.');
    expect(line({ round: 2 })).toBe('P1 placed a 2/2 settlement at intersection 5.');
    expect(line({ round: 1 })).toBe('P1 placed a 1/2 settlement at intersection 5.');
  });

  it('the end-of-game event names the cause and every winner; the target path keeps the old sentence', () => {
    const target = makeEvent(1, 'game.finished', { playerId: 'p1', reason: 'victory', score: 14, target: 14 });
    const single = makeEvent(2, 'game.finished', { playerId: 'p1', playerIds: ['p1'], reason: 'victory', score: 6, cause: 'clothExhausted' });
    const shared = makeEvent(3, 'game.finished', { playerId: 'p1', playerIds: ['p1', 'p3'], reason: 'victory', score: 6, cause: 'clothExhausted' });
    expect(translateEvent('en', target, names).text).toBe('P1 won with 14 victory points (target 14).');
    expect(translateEvent('zh-Hant', target, names).text).toBe('P1 以 14 分獲勝（目標 14 分）。');
    expect(translateEvent('en', single, names).text).toBe('The cloth ran out: P1 won with 6 victory points.');
    expect(translateEvent('en', shared, names).text).toBe('The cloth ran out: P1, P3 win together with 6 victory points.');
    expect(translateEvent('zh-Hant', shared, names).text).toBe('布匹耗盡：P1、P3 以 6 分共同獲勝。');
    for (const event of [single, shared]) {
      expect(translateEvent('en', event, names).text).not.toContain('target');
      expect(translateEvent('zh-Hant', event, names).text).not.toContain('目標');
    }
  });
});

describe('Cloth for Catan result screen', () => {
  function result(locale: 'en' | 'zh-Hant', edit: (state: GameState) => void) {
    cleanup();
    const state = clothState(4);
    edit(state);
    const view = viewOf(state);
    const controller = controllerFor(view, locale, { leaveRoom: vi.fn() });
    render(<LocaleProvider locale={locale}><ResultScreen controller={controller} /></LocaleProvider>);
  }

  const exhausted = (winners: string[]) => (state: GameState) => {
    state.result = { playerId: winners[0]!, reason: 'victory', atSeq: 3, playerIds: winners, cause: 'clothExhausted' };
    state.turn.phase = 'gameOver';
  };

  it('a shared victory lists every winner and never shows the target', () => {
    result('en', exhausted(['p1', 'p3']));
    const winners = screen.getByTestId('result-winners');
    expect(winners.textContent).toBe('P1, P3 win together');
    expect(winners.getAttribute('data-shared')).toBe('true');
    expect(screen.queryByTestId('result-winner')).toBeNull();
    expect(screen.getByTestId('result-score').textContent).toContain('no target score');
    const reason = screen.getByTestId('result-reason');
    expect(reason.getAttribute('data-cause')).toBe('clothExhausted');
    expect(reason.textContent).toBe('Cloth ran out (5 or more tribes empty at the end of a turn)');
    expect(screen.getByTestId('result-screen').textContent).not.toContain('Victory target');
    result('zh-Hant', exhausted(['p1', 'p3']));
    expect(screen.getByTestId('result-winners').textContent).toBe('P1、P3 共同獲勝');
    expect(screen.getByTestId('result-reason').textContent).toContain('布匹耗盡');
    expect(screen.getByTestId('result-screen').textContent).not.toContain('勝利目標');
    cleanup();
  });

  it('a single winner of the cloth ending is announced alone, below 14 points, without the target', () => {
    result('en', exhausted(['p2']));
    expect(screen.getByTestId('result-winner').textContent).toContain('P2 wins');
    expect(screen.queryByTestId('result-winners')).toBeNull();
    expect(screen.getByTestId('result-reason').getAttribute('data-cause')).toBe('clothExhausted');
    expect(screen.getByTestId('result-screen').textContent).not.toContain('Victory target');
    cleanup();
  });

  it('the ordinary target ending is unchanged (score of target, victory target line)', () => {
    result('en', (state) => {
      state.result = { playerId: 'p1', reason: 'victory', atSeq: 3 };
      state.turn.phase = 'gameOver';
    });
    expect(screen.getByTestId('result-winner').textContent).toContain('P1 wins');
    expect(screen.getByTestId('result-score').textContent).toMatch(/Final score \d+ of 14/);
    expect(screen.getByTestId('result-reason').getAttribute('data-cause')).toBe('target');
    expect(screen.getByTestId('result-reason').textContent).toBe('Victory points · Victory target: 14');
    cleanup();
  });

  it('the statistics rank every co-winner first', () => {
    const state = clothState(4);
    exhausted(['p2', 'p4'])(state);
    const view = viewOf(state);
    view.stats = projectGame(Object.assign(state, { stats: state.stats }), 'p1').stats ?? view.stats;
    if (!view.stats) throw new Error('stats missing');
    const rows = buildStatsRows(view, view.stats);
    expect(rows.filter((row) => row.winner).map((row) => row.player.id).sort()).toEqual(['p2', 'p4']);
    expect(rows.slice(0, 2).every((row) => row.winner)).toBe(true);
  });
});

describe('Cloth for Catan sounds', () => {
  it('every winner of a shared victory hears the victory cue; the others hear game over; a single winner is unchanged', () => {
    const shared = makeEvent(1, 'game.finished', { playerId: 'p1', playerIds: ['p1', 'p3'], reason: 'victory', score: 6, cause: 'clothExhausted' });
    expect(cueForEvent(shared, 'p1')).toBe('game.victory');
    expect(cueForEvent(shared, 'p3')).toBe('game.victory');
    expect(cueForEvent(shared, 'p2')).toBe('game.over');
    expect(cueForEvent(shared, null)).toBe('game.over');
    const single = makeEvent(2, 'game.finished', { playerId: 'p1', reason: 'victory', score: 14, target: 14 });
    expect(cueForEvent(single, 'p1')).toBe('game.victory');
    expect(cueForEvent(single, 'p2')).toBe('game.over');
    const clothSingle = makeEvent(3, 'game.finished', { playerId: 'p2', playerIds: ['p2'], reason: 'victory', score: 6, cause: 'clothExhausted' });
    expect(cueForEvent(clothSingle, 'p2')).toBe('game.victory');
    expect(cueForEvent(clothSingle, 'p1')).toBe('game.over');
  });

  it('trading, production and theft have cues', () => {
    expect(cueForEvent(makeEvent(1, 'cloth.trade', { playerId: 'p1' }), 'p2')).toBe('island.bonus');
    expect(cueForEvent(makeEvent(2, 'cloth.produced', { gains: { p1: 1 } }), 'p1')).toBe('production.self');
    expect(cueForEvent(makeEvent(3, 'cloth.produced', { gains: { p1: 1 } }), 'p2')).toBeNull();
    expect(cueForEvent(makeEvent(4, 'cloth.stolen', { playerId: 'p1', victim: 'p2' }), 'p2')).toBe('robber.stolenFromYou');
    expect(cueForEvent(makeEvent(5, 'cloth.stolen', { playerId: 'p1', victim: 'p2' }), 'p3')).toBe('robber.steal');
  });
});
