/** Explorers & Pirates client: actions, prompts, board intents, SVG and 3D pieces, text and cues. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, applyCommand, createGame, projectGame, seededRng, type Command, type GameState, type GameView } from '@catan/rules';
import { cueForEvent } from '../src/audio/cues.ts';
import { epHints, epView, fogRegions, shipSlots } from '../src/board/explorersPirates.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { boardIntent } from '../src/board/intent.ts';
import { epShipPlacements } from '../src/board/three/diorama-explorers.ts';
import { inspectDescription } from '../src/board/inspection.ts';
import { ExplorersPiratesPrompt } from '../src/components/ExplorersPiratesPrompt.tsx';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { TradePanel } from '../src/components/TradePanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { deriveActions } from '../src/state/actions.ts';
import { requiredActionFor } from '../src/state/pending.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

const PLAYERS = ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, nickname: id.toUpperCase(), color: (['red', 'blue', 'orange', 'white'] as const)[seat]! }));

/** Land Ho! with its printed start, p1 in the Action phase. */
function landHo(): GameState {
  const state = createGame({ profileId: 'ep-land-ho-2025', players: PLAYERS, setupMode: 'fixed', rng: seededRng(4) });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.pending = null;
  state.windowId += 1;
  return state;
}

function viewOf(state: GameState): GameView {
  return projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
}

function run(state: GameState, command: { type: string; [field: string]: unknown }): GameState {
  const outcome = applyCommand(state, 'p1', command as Command, seededRng(1));
  if (!outcome.ok) throw new Error(`rejected ${outcome.error.code}`);
  return outcome.state;
}

function tableWith(view: GameView, overrides: Partial<TableState> = {}): TableState {
  return {
    ...initialTableState('en', 'Alex'),
    bootstrapped: true,
    session: { id: 'p1', nickname: 'Alex', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(view),
    ...overrides,
  };
}

function controllerFor(state: TableState) {
  const submitCommand = vi.fn();
  const selectTarget = vi.fn();
  const controller = { state, actions: { submitCommand, selectTarget, cancelSelection: vi.fn() } } as unknown as TableController;
  return { controller, submitCommand, selectTarget };
}

describe('explorers & pirates client', () => {
  it('replaces cities and development cards with harbour settlements and ships', () => {
    const state = landHo();
    state.players[0]!.resources = { lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 };
    const actions = deriveActions(tableWith(viewOf(state)), 'p1');
    const ids = actions.map((action) => action.id);
    expect(ids).toContain('ep.buildHarbor');
    expect(ids).toContain('ep.buildShip');
    expect(ids).not.toContain('build.city');
    expect(ids).not.toContain('dev.buy');
  });

  it('starts the Movement phase from the prompt and then arms a ship move with its id', () => {
    const state = landHo();
    const { controller, submitCommand } = controllerFor(tableWith(viewOf(state)));
    const first = render(<LocaleProvider locale="en"><ExplorersPiratesPrompt controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('ep-turn').dataset.phase).toBe('action');
    fireEvent.click(screen.getByTestId('ep-start-movement'));
    expect(submitCommand).toHaveBeenCalledWith({ type: 'ep.startMovement' }, 'ep.phase.start');
    first.unmount();

    const moving = run(state, { type: 'ep.startMovement' });
    const view = viewOf(moving);
    const ship = epHints(view)!.ships.find((candidate) => candidate.steps.length > 0)!;
    expect(ship).toBeDefined();
    const second = controllerFor(tableWith(view));
    render(<LocaleProvider locale="en"><ExplorersPiratesPrompt controller={second.controller} /></LocaleProvider>);
    expect(screen.getByTestId('ep-turn').dataset.phase).toBe('movement');
    fireEvent.click(screen.getByTestId(`ep-sail-${ship.id}`));
    expect(second.selectTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: 'edge', commandType: 'ep.moveShip', params: { ship: ship.id } }));

    // With the move armed, the board offers exactly that ship's steps and carries its id.
    const armed = boardIntent(tableWith(view, {
      selection: { ...EMPTY_SELECTION, kind: 'edge', commandType: 'ep.moveShip', labelId: 'ep.move.step', params: { ship: ship.id } },
    }), 'p1');
    expect(armed?.targets).toEqual(ship.steps.map((step) => step.edge));
  });

  it('offers piece building on a harbour and coin trades in the Action phase', () => {
    const state = landHo();
    state.players[0]!.resources = { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 3 };
    const view = viewOf(state);
    const { controller, submitCommand } = controllerFor(tableWith(view));
    render(<LocaleProvider locale="en"><ExplorersPiratesPrompt controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('ep-sell-ore'));
    expect(submitCommand).toHaveBeenCalledWith({ type: 'ep.sellForGold', give: 'ore' }, 'ep.trade.sellLabel');
    const hints = epHints(view)!;
    const holder = hints.pieceHarbors[0] !== undefined ? `h${hints.pieceHarbors[0]}` : hints.pieceShips[0];
    if (holder) {
      const button = screen.getByTestId(`ep-build-settler-${holder}`) as HTMLButtonElement;
      if (!button.disabled) {
        fireEvent.click(button);
        expect(submitCommand.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'ep.buildSettler' });
      }
    }
  });

  it('draws fog, harbour settlements and ships on the SVG board', () => {
    const view = viewOf(landHo());
    const slot = epView(view)!;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const { container } = render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
      active={null} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id.toUpperCase()} /></LocaleProvider>);
    expect(container.querySelectorAll('[data-testid^="ep-fog-"]').length).toBe(slot.fog.length);
    expect(slot.fog.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-testid^="ep-ship-"]').length).toBe(slot.ships.length);
    expect(container.querySelectorAll('[data-testid^="ep-harbor-"]').length).toBe(slot.harbors.length);
    expect(container.querySelector('[data-testid="robber"]')).toBeNull();
  });

  it('describes an unexplored hex only by its region when inspected', () => {
    const view = viewOf(landHo());
    const slot = epView(view)!;
    const fogged = slot.fog[0]!;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const description = inspectDescription({ locale: 'en', board: view.board, topology: geometry.topology, nameOf: (id) => id, fog: fogRegions(slot) },
      { kind: 'hex', index: fogged.hex, world: { x: 0, y: 0, z: 0 } } as never);
    expect(description.lines).toEqual([`Unexplored (${fogged.region} region)`]);
  });

  it('places two ships on one path side by side in both renderers', () => {
    const view = viewOf(landHo());
    const slot = structuredClone(epView(view)!);
    const [first, second] = slot.ships;
    second!.edge = first!.edge;
    const slots = shipSlots(slot);
    expect(slots.get(first!.id)).toEqual({ slot: 0, of: 2 });
    expect(slots.get(second!.id)).toEqual({ slot: 1, of: 2 });
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const placed = epShipPlacements(geometry, slot, 1.5).filter((ship) => ship.id === first!.id || ship.id === second!.id);
    expect(placed).toHaveLength(2);
    expect(placed[0]!.position).not.toEqual(placed[1]!.position);
  });

  it('labels the variable setup steps and shows the help section', () => {
    const state = createGame({ profileId: 'ep-fish-2025', players: PLAYERS, setupMode: 'variable', rng: seededRng(4) });
    const view = viewOf(state);
    expect(epView(view)!.setupStep).toBe('harbor');
    const table = tableWith(view);
    expect(requiredActionFor(table)?.messageId).toBe('ep.setup.harbor');
    const { controller } = controllerFor(table);
    render(<LocaleProvider locale="en"><HelpPanel controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('help-explorers-pirates').textContent).toContain('Fish for Catan');
  });

  it('translates exploration and maps E&P events to sound cues', () => {
    const names = (id: string) => (id === 'p1' ? 'Alex' : id);
    const text = translateEvent('en', makeEvent(3, 'ep.explored', { playerId: 'p1', hex: 9, region: 'parrot', tile: 'pasture', number: 5, reward: { resource: 'wool' } }), names);
    expect(text.text).toContain('Alex');
    expect(cueForEvent(makeEvent(3, 'ep.explored', { playerId: 'p1', hex: 9 }), 'p1')).toBe('explore.reveal');
    expect(cueForEvent(makeEvent(4, 'ep.shipMoved', { playerId: 'p2' }), 'p1')).toBe('ship.move');
    expect(cueForEvent(makeEvent(5, 'ep.pirateStole', { playerId: 'p2', victim: 'p1' }), 'p1')).toBe('robber.stolenFromYou');
  });

  it('offers one remove choice per piece when every holder is full, and none a settler cannot use', () => {
    const state = landHo();
    state.players[0]!.resources = { lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 };
    const view = viewOf(state);
    const hints = epHints(view)!;
    const slot = epView(view)!;
    // Every holder full: harbours with two small pieces, ships with a fish haul.
    for (const harbor of slot.harbors) if (harbor.player === 'p1') harbor.cargo = ['crew', 'spice'];
    for (const ship of slot.ships) if (ship.player === 'p1') ship.cargo = ['fish'];
    const { controller, submitCommand } = controllerFor(tableWith(view));
    render(<LocaleProvider locale="en"><ExplorersPiratesPrompt controller={controller} /></LocaleProvider>);
    const harbor = hints.pieceHarbors[0]!;
    // A settler needs an empty holder: two small pieces cannot make room.
    expect((screen.getByTestId(`ep-build-settler-h${harbor}`) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId(`ep-build-settler-h${harbor}-remove-crew`)).toBeNull();
    const ship = hints.pieceShips[0]!;
    expect(ship).toBeDefined();
    fireEvent.click(screen.getByTestId(`ep-build-settler-${ship}-remove-fish`));
    expect(submitCommand).toHaveBeenLastCalledWith({ type: 'ep.buildSettler', ship, remove: 'fish' }, 'ep.build.settler');
  });

  it('adds coins to a domestic offer and shows them in the terms (EP25 p. 9)', () => {
    const state = landHo();
    state.players[1]!.resources.ore = 1;
    const view = viewOf(state);
    epView(view)!.players.p1!.gold = 2;
    const { controller, submitCommand } = controllerFor(tableWith(view));
    const panel = render(<LocaleProvider locale="en"><TradePanel controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('give-add-gold'));
    fireEvent.click(screen.getByTestId('give-add-gold'));
    expect(screen.getByTestId('give-add-gold')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('want-add-ore'));
    fireEvent.click(screen.getByTestId('create-offer'));
    expect(submitCommand).toHaveBeenCalledWith(
      { type: 'trade.offer', to: 'all', give: {}, want: { ore: 1 }, giveGoods: { gold: 2 } }, 'play.tradeNew');
    panel.unmount();
    // A recipient sees the coins on their receiving side.
    const offered = applyCommand(state, 'p1', { type: 'trade.offer', to: 'all', give: {}, want: { ore: 1 }, giveGoods: { gold: 2 } } as unknown as Command, seededRng(1));
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    const theirs = projectGame(offered.state, 'p2', { hints: actionHints(offered.state, 'p2') });
    const other = controllerFor({ ...tableWith(theirs), session: { id: 'p2', nickname: 'P2', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' } });
    render(<LocaleProvider locale="en"><TradePanel controller={other.controller} /></LocaleProvider>);
    const offerId = offered.state.offers[0]!.id;
    expect(screen.getByTestId(`offer-terms-${offerId}`).textContent).toBe('You give: 1×Ore · You receive: — + 2 gold');
  });
});

