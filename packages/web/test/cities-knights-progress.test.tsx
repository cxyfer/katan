/** Cities & Knights progress cards in the client: hand, play flows, answers, merchant, text and cues. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameState, type GameView } from '@catan/rules';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry, type BoardGeometry } from '../src/board/geometry.ts';
import { citiesKnightsPoints, citiesKnightsTargets, merchantSpot, progressGhost, PROGRESS_BOARD_TARGET } from '../src/board/citiesKnights.ts';
import { createMerchantModel, merchantPosition } from '../src/board/three/diorama-merchant.ts';
import { CitiesKnightsPanel } from '../src/components/CitiesKnightsPanel.tsx';
import { CitiesKnightsPrompt } from '../src/components/CitiesKnightsPrompt.tsx';
import { ProgressCardFace } from '../src/components/SvgProgressArt.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { t } from '../src/i18n/index.ts';
import { progressCueForEvent } from '../src/audio/progress-cues.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

const ALL_CARDS = [
  'alchemy', 'crane', 'engineering', 'invention', 'irrigation', 'medicine', 'mining', 'printing', 'roadBuilding', 'smithing',
  'commercialHarbor', 'guildDues', 'merchant', 'merchantFleet', 'resourceMonopoly', 'tradeMonopoly',
  'constitution', 'diplomacy', 'encouragement', 'espionage', 'intrigue', 'sabotage', 'taxation', 'treason', 'wedding',
] as const;

function ckState(): { state: GameState; geometry: BoardGeometry } {
  const state = createGame({
    profileId: 'ck-2025',
    players: ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, nickname: id.toUpperCase(), color: (['red', 'blue', 'orange', 'white'] as const)[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(11),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.windowId += 1;
  state.board.buildings = state.board.buildings.map(() => null);
  state.board.roads = state.board.roads.map(() => null);
  const geometry = buildGeometry(state.board.layout.topologyId, 100, state.board.layout.terrain);
  return { state, geometry };
}

const view = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });

function controllerFor(gameView: GameView) {
  const submitCommand = vi.fn();
  const selectTarget = vi.fn();
  const table: TableState = {
    ...initialTableState('en', 'Alex'),
    bootstrapped: true,
    session: { id: 'p1', nickname: 'Alex', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(gameView),
  };
  const controller = { state: table, actions: { submitCommand, selectTarget, cancelSelection: vi.fn() } } as unknown as TableController;
  return { controller, submitCommand, selectTarget, table };
}

/** A city for player 1 with a settlement elsewhere, resources for Medicine, and a hand. */
function handTable(hand: string[]) {
  const { state, geometry } = ckState();
  state.board.buildings[20] = { player: 'p1', city: true };
  state.board.buildings[27] = { player: 'p1', city: false };
  state.players[0]!.progressCards = hand as GameState['players'][number]['progressCards'];
  state.players[0]!.resources = { lumber: 1, brick: 1, wool: 1, grain: 2, ore: 3 };
  state.players[0]!.commodities = { paper: 2, cloth: 0, coin: 0 };
  return { state, geometry };
}

const renderPanel = (controller: TableController) => render(<LocaleProvider locale="en"><CitiesKnightsPanel controller={controller} /></LocaleProvider>);

describe('progress cards in the client', () => {
  it('names and paraphrases every card in both locales and draws a face for each', () => {
    for (const card of ALL_CARDS) {
      for (const locale of ['en', 'zh-Hant'] as const) {
        expect(t(locale, `ck.progress.${card}`), card).not.toBe(`ck.progress.${card}`);
        expect(t(locale, `ck.progressText.${card}`), card).not.toBe(`ck.progressText.${card}`);
      }
      const { container, unmount } = render(<ProgressCardFace card={card} />);
      expect(container.querySelector(`[data-card="${card}"]`)).not.toBeNull();
      unmount();
    }
    for (const reason of ['not-your-turn', 'pending', 'before-roll', 'after-roll', 'no-target', 'cost', 'robber-inactive', 'alchemy-set']) {
      expect(t('en', `ck.cardBlocked.${reason}`)).not.toContain('ck.cardBlocked');
      expect(t('zh-Hant', `ck.cardBlocked.${reason}`)).not.toContain('ck.cardBlocked');
    }
  });

  it('lists the hand with playable cards and the reason a card is blocked', () => {
    const { state } = handTable(['irrigation', 'alchemy', 'taxation', 'merchant', 'merchant']);
    const { controller } = controllerFor(view(state));
    renderPanel(controller);
    expect(screen.getByTestId('ck-card-irrigation').getAttribute('data-playable')).toBe('true');
    expect(screen.getByTestId('ck-card-merchant').textContent).toContain('×2');
    // Alchemy belongs before the roll; Taxation needs the first barbarian attack.
    expect(screen.getByTestId('ck-card-alchemy').getAttribute('data-reason')).toBe('after-roll');
    expect(screen.getByTestId('ck-card-reason-alchemy').textContent).toMatch(/before rolling/i);
    expect(screen.getByTestId('ck-card-taxation').getAttribute('data-reason')).toBe('robber-inactive');
    expect(screen.queryByTestId('ck-play-alchemy')).toBeNull();
  });

  it('plays a direct card, arms the board for a target card and opens forms for choices', () => {
    const { state } = handTable(['irrigation', 'merchant', 'engineering', 'invention', 'merchantFleet']);
    const { controller, submitCommand, selectTarget } = controllerFor(view(state));
    renderPanel(controller);
    fireEvent.click(screen.getByTestId('ck-play-irrigation'));
    expect(submitCommand).toHaveBeenCalledWith({ type: 'progress.play', card: 'irrigation' }, 'ck.progress.irrigation');

    fireEvent.click(screen.getByTestId('ck-play-merchant'));
    expect(selectTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hex', commandType: 'progress.play', params: { card: 'merchant' }, field: 'hex' }));
    fireEvent.click(screen.getByTestId('ck-play-engineering'));
    expect(selectTarget).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'vertex', params: { card: 'engineering' }, field: 'vertex' }));

    fireEvent.click(screen.getByTestId('ck-play-merchantFleet'));
    fireEvent.click(screen.getByTestId('ck-kind-wool'));
    expect(submitCommand).toHaveBeenLastCalledWith({ type: 'progress.play', card: 'merchantFleet', kind: 'wool' }, 'ck.progress.merchantFleet');
  });

  it('asks for two number tokens before Invention and two dice before Alchemy', () => {
    const { state } = handTable(['invention']);
    const { controller, submitCommand } = controllerFor(view(state));
    const first = renderPanel(controller);
    fireEvent.click(screen.getByTestId('ck-play-invention'));
    const confirm = screen.getByTestId('ck-play-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const hexes = (view(state).hints!.modules!.citiesKnights as { progress: { targets: { hexes: number[] } }[] }).progress[0]!.targets.hexes;
    fireEvent.click(screen.getByTestId(`ck-invention-${hexes[0]}`));
    fireEvent.click(screen.getByTestId(`ck-invention-${hexes[1]}`));
    fireEvent.click(confirm);
    expect(submitCommand).toHaveBeenCalledWith({ type: 'progress.play', card: 'invention', hexes: [hexes[0], hexes[1]] }, 'ck.progress.invention');
    first.unmount();

    const roll = handTable(['alchemy']);
    roll.state.turn.phase = 'preroll';
    const preroll = controllerFor(view(roll.state));
    renderPanel(preroll.controller);
    expect(screen.getByTestId('ck-card-alchemy').getAttribute('data-playable')).toBe('true');
    fireEvent.click(screen.getByTestId('ck-play-alchemy'));
    fireEvent.click(screen.getByTestId('ck-alchemy-yellow-3'));
    fireEvent.click(screen.getByTestId('ck-alchemy-red-5'));
    expect(screen.getByTestId('ck-alchemy-total').textContent).toContain('8');
    fireEvent.click(screen.getByTestId('ck-play-confirm'));
    expect(preroll.submitCommand).toHaveBeenCalledWith({ type: 'progress.play', card: 'alchemy', dice: [3, 5] }, 'ck.progress.alchemy');
  });

  it('answers the cards other players play: Commercial Harbor, Guild Dues, Espionage, Sabotage, Wedding', () => {
    const { state } = handTable(['mining']);
    state.players[0]!.commodities = { paper: 1, cloth: 1, coin: 0 };
    const frame = (kind: string, responders: string[], data: Record<string, unknown>) => {
      const next = view(state);
      next.pending = { kind, module: 'citiesKnights', responders, data } as unknown as GameView['pending'];
      return next;
    };
    const run = (gameView: GameView, act: () => void, expected: unknown, label: string) => {
      const harness = controllerFor(gameView);
      const { unmount } = render(<LocaleProvider locale="en"><CitiesKnightsPrompt controller={harness.controller} /></LocaleProvider>);
      act();
      expect(harness.submitCommand).toHaveBeenCalledWith(expected, label);
      unmount();
    };
    run(frame('citiesKnights.harborExchange', ['p1'], { from: 'p2', resource: 'lumber' }),
      () => fireEvent.click(screen.getByTestId('ck-harbor-give-cloth')), { type: 'progress.harborAnswer', commodity: 'cloth' }, 'ck.prompt.harbor');
    run(frame('citiesKnights.guildDues', ['p1'], { victim: 'p2', count: 2, hand: { lumber: 1, brick: 1, ore: 2 } }), () => {
      fireEvent.click(screen.getByTestId('ck-guild-pick-add-ore'));
      fireEvent.click(screen.getByTestId('ck-guild-pick-add-brick'));
      fireEvent.click(screen.getByTestId('ck-guild-pick-submit'));
    }, { type: 'progress.takeCards', cards: ['ore', 'brick'] }, 'ck.prompt.take');
    run(frame('citiesKnights.espionage', ['p1'], { victim: 'p2', count: 2, cards: ['crane', 'wedding'] }),
      () => fireEvent.click(screen.getByTestId('ck-espionage-take-wedding')), { type: 'progress.takeProgress', card: 'wedding' }, 'ck.prompt.take');
    run(frame('citiesKnights.espionage', ['p1'], { victim: 'p2', count: 1, cards: ['crane'] }),
      () => fireEvent.click(screen.getByTestId('ck-espionage-none')), { type: 'progress.takeProgress', card: null }, 'ck.prompt.take');
    run(frame('citiesKnights.sabotage', ['p1'], { actor: 'p2', required: { p1: 2 } }), () => {
      fireEvent.click(screen.getByTestId('ck-sabotage-pick-add-ore'));
      fireEvent.click(screen.getByTestId('ck-sabotage-pick-add-ore'));
      fireEvent.click(screen.getByTestId('ck-sabotage-pick-submit'));
    }, { type: 'progress.sabotageDiscard', cards: ['ore', 'ore'] }, 'ck.progress.sabotage');
    run(frame('citiesKnights.wedding', ['p1'], { actor: 'p2', required: { p1: 2 } }), () => {
      fireEvent.click(screen.getByTestId('ck-wedding-pick-add-grain'));
      fireEvent.click(screen.getByTestId('ck-wedding-pick-add-paper'));
      fireEvent.click(screen.getByTestId('ck-wedding-pick-submit'));
    }, { type: 'progress.weddingGive', cards: ['grain', 'paper'] }, 'ck.progress.wedding');
    run(frame('citiesKnights.treasonRemove', ['p1'], { actor: 'p2', knights: [5, 9] }),
      () => fireEvent.click(screen.getByTestId('ck-treason-remove-9')), { type: 'progress.treasonRemove', vertex: 9 }, 'ck.progress.treason');
    run(frame('citiesKnights.treasonPlace', ['p1'], { level: 2, active: true, from: 5, levels: [1, 2], sites: [4, 6] }),
      () => fireEvent.click(screen.getByTestId('ck-treason-skip')), { type: 'progress.treasonPlace', vertex: null }, 'ck.progress.treason');
    run(frame('citiesKnights.diplomacyRoad', ['p1'], { edge: 3, edges: [3, 4] }),
      () => fireEvent.click(screen.getByTestId('ck-diplomacy-skip')), { type: 'progress.diplomacyRoad', edge: null }, 'ck.progress.diplomacy');
  });

  it('shows another player’s hand only to the player the engine sent it to', () => {
    const { state } = handTable([]);
    const next = view(state);
    next.pending = { kind: 'citiesKnights.espionage', module: 'citiesKnights', responders: ['p2'], data: { victim: 'p3', count: 2 } } as unknown as GameView['pending'];
    const { controller } = controllerFor(next);
    render(<LocaleProvider locale="en"><CitiesKnightsPrompt controller={controller} /></LocaleProvider>);
    // The viewer is not the responder: nothing to answer, no card faces.
    expect(screen.queryByTestId('ck-espionage')).toBeNull();
  });

  it('arms the board for the cards that answer with a board target', () => {
    const { state } = handTable([]);
    const frame = (kind: string, data: Record<string, unknown>) => {
      const next = view(state);
      next.pending = { kind, module: 'citiesKnights', responders: ['p1'], data } as unknown as GameView['pending'];
      return next;
    };
    const table = (gameView: GameView, selection = EMPTY_SELECTION): TableState => ({ ...controllerFor(gameView).table, selection });
    expect(boardIntent(table(frame('citiesKnights.treasonRemove', { actor: 'p2', knights: [5] })), 'p1'))
      .toMatchObject({ kind: 'vertex', commandType: 'progress.treasonRemove', targets: [5] });
    expect(boardIntent(table(frame('citiesKnights.diplomacyRoad', { edge: 3, edges: [3, 4] })), 'p1'))
      .toMatchObject({ kind: 'edge', commandType: 'progress.diplomacyRoad', targets: [3, 4] });
    expect(citiesKnightsTargets(frame('citiesKnights.treasonPlace', { sites: [4, 6], levels: [1], level: 1 }), { commandType: 'progress.treasonPlace' })).toEqual([4, 6]);
    expect(Object.keys(PROGRESS_BOARD_TARGET).sort()).toEqual(['diplomacy', 'engineering', 'intrigue', 'medicine', 'merchant', 'taxation']);
    expect(progressGhost('progress.play', { card: 'merchant' })).toBe('merchant');
    expect(progressGhost('progress.play', { card: 'diplomacy' })).toBe('none');
    expect(progressGhost('build.road')).toBe('default');
  });

  it('draws the merchant on its hex in SVG and builds the 3D piece', () => {
    const { state, geometry } = handTable([]);
    const ck = (state.moduleState as Record<string, { merchant?: { player: string; hex: number } | null }>).citiesKnights!;
    ck.merchant = { player: 'p1', hex: 3 };
    const gameView = view(state, 'p2');
    const { container } = render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={gameView}
      active={null} selection={EMPTY_SELECTION} selfId="p2" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
    const merchant = container.querySelector('[data-testid="merchant"]');
    expect(merchant?.getAttribute('data-hex')).toBe('3');
    expect(merchant?.getAttribute('data-player')).toBe('p1');
    expect(citiesKnightsPoints(gameView, 'p1').merchant).toBe(1);
    expect(citiesKnightsPoints(gameView, 'p2').merchant).toBeUndefined();

    const model = createMerchantModel('#c0392b', 0);
    expect(model.getAttribute('position').count).toBeGreaterThan(0);
    const spot = merchantSpot(geometry.hexes[3]!);
    const position = merchantPosition(geometry, 3)!;
    expect(position[0]).toBeCloseTo(spot.x / geometry.scale);
    expect(merchantPosition(geometry, 9999)).toBeNull();
  });

  it('renders every progress event in both locales and maps the sound cues', () => {
    const names = (id: string) => id.toUpperCase();
    const events = [
      makeEvent(1, 'ck.progressPlayed', { playerId: 'p1', card: 'crane', track: 'science' }),
      makeEvent(2, 'ck.alchemySet', { playerId: 'p1', dice: [3, 4], total: 7 }),
      makeEvent(3, 'ck.numbersSwapped', { playerId: 'p1', hexes: [3, 5], numbers: [4, 9] }),
      makeEvent(4, 'ck.harvest', { playerId: 'p1', card: 'mining', resource: 'ore', hexes: 2, amount: 4 }),
      makeEvent(5, 'ck.medicineCity', { playerId: 'p1', vertex: 8 }),
      makeEvent(6, 'ck.freeRoads', { playerId: 'p1', roads: 2 }),
      makeEvent(7, 'ck.harborOpened', { playerId: 'p1' }),
      makeEvent(8, 'ck.harborOffered', { playerId: 'p1', to: 'p2', resource: 'wool' }),
      makeEvent(9, 'ck.harborReturned', { playerId: 'p1', to: 'p2' }),
      makeEvent(10, 'ck.harborExchanged', { playerId: 'p1', to: 'p2', resource: 'wool', commodity: 'paper' }),
      makeEvent(11, 'ck.guildDuesTaken', { playerId: 'p1', victim: 'p2', count: 2, cards: ['ore', 'ore'] }),
      makeEvent(12, 'ck.merchantPlaced', { playerId: 'p1', hex: 4, from: 'p2' }),
      makeEvent(13, 'ck.fleetNamed', { playerId: 'p1', kind: 'coin' }),
      makeEvent(14, 'ck.monopolyTaken', { playerId: 'p1', card: 'resourceMonopoly', kind: 'ore', taken: { p2: 2, p3: 1 } }),
      makeEvent(15, 'ck.roadRemoved', { playerId: 'p1', owner: 'p2', edge: 9 }),
      makeEvent(16, 'ck.diplomacyRoadBuilt', { playerId: 'p1', edge: 9 }),
      makeEvent(17, 'ck.diplomacyRoadSkipped', { playerId: 'p1' }),
      makeEvent(18, 'ck.knightsEncouraged', { playerId: 'p1', vertices: [3, 4] }),
      makeEvent(19, 'ck.espionageLooked', { playerId: 'p1', victim: 'p2', count: 2 }),
      makeEvent(20, 'ck.espionageTaken', { playerId: 'p1', victim: 'p2', took: true, card: 'wedding' }),
      makeEvent(21, 'ck.espionageTaken', { playerId: 'p3', victim: 'p2', took: true }),
      makeEvent(22, 'ck.knightIntrigued', { playerId: 'p1', victim: 'p2', vertex: 5, level: 2 }),
      makeEvent(23, 'ck.sabotageRequired', { playerId: 'p1', required: { p2: 2 } }),
      makeEvent(24, 'ck.sabotageDiscarded', { playerId: 'p2', count: 2, cards: ['ore', 'wool'] }),
      makeEvent(25, 'ck.weddingRequired', { playerId: 'p1', required: { p2: 2 } }),
      makeEvent(26, 'ck.weddingGift', { playerId: 'p2', to: 'p1', count: 2 }),
      makeEvent(27, 'ck.taxationMoved', { playerId: 'p1', hex: 6 }),
      makeEvent(28, 'ck.taxationStole', { playerId: 'p1', victim: 'p2', card: 'paper' }),
      makeEvent(29, 'ck.treasonChosen', { playerId: 'p1', victim: 'p2' }),
      makeEvent(30, 'ck.treasonRemoved', { playerId: 'p2', vertex: 5, level: 2, active: true }),
      makeEvent(31, 'ck.treasonPlaced', { playerId: 'p1', vertex: 6, level: 2, active: true }),
      makeEvent(32, 'ck.treasonNoPlace', { playerId: 'p1' }),
    ];
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const event of events) {
        const text = translateEvent(locale, event, names);
        expect(text.unknown, event.type).toBe(false);
        expect(text.text, event.type).not.toMatch(/\{\w+\}/);
      }
    }
    expect(translateEvent('en', events[0]!, names).text).toBe('P1 played Crane (Science).');
    expect(translateEvent('zh-Hant', events[1]!, names).text).toContain('黃骰 3');
    expect(progressCueForEvent(events[0]!, 'p1')).toBe('progress.play');
    expect(progressCueForEvent(events[1]!, 'p2')).toBe('progress.alchemy');
    expect(progressCueForEvent(events[11]!, 'p2')).toBe('progress.merchant');
    // A request cue only for the player who has to answer.
    expect(progressCueForEvent(events[7]!, 'p2')).toBe('progress.request');
    expect(progressCueForEvent(events[7]!, 'p3')).toBeNull();
    expect(progressCueForEvent(events[22]!, 'p2')).toBe('progress.request');
    expect(progressCueForEvent(events[22]!, 'p3')).toBeNull();
    expect(progressCueForEvent(makeEvent(40, 'build.road', {}), 'p1')).toBeUndefined();
  });
});
