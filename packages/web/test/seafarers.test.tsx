/** Seafarers client: ship and pirate intents, actions, prompts, board pieces and text. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameView } from '@catan/rules';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { targetsFromGeometry } from '../src/board/projection.ts';
import { SEA_LEVEL } from '../src/board/sea.ts';
import { seafarersHints } from '../src/board/seafarers.ts';
import { shipInstances, shipTransform } from '../src/board/three/diorama-ships.ts';
import { placementEffectGroups } from '../src/board/animation.ts';
import { SeafarersPrompt } from '../src/components/SeafarersPrompt.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { deriveActions } from '../src/state/actions.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

/** A real 4-player New Shores game, projected for p1, after the given edits. */
function seaView(edit: (state: ReturnType<typeof createGame>) => void = () => undefined): GameView {
  const state = createGame({
    profileId: 'sf-new-shores-2025',
    players: ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, nickname: id.toUpperCase(), color: (['red', 'blue', 'orange', 'white'] as const)[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(4),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.windowId += 1;
  edit(state);
  return projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
}

// Indices on the 4-player map (see scripts/seafarers/fixtures.mjs).
const COAST = 48;
const NW = 61;
const NE = 65;
const SEA_HEX = 22;

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

describe('seafarers client', () => {
  it('offers ship build and ship move actions only in Seafarers games', () => {
    const view = seaView((state) => {
      state.board.buildings[COAST] = { player: 'p1', city: false };
      state.board.roads[NW] = { player: 'p1', ship: true };
      state.players[0]!.resources = { lumber: 1, brick: 0, wool: 1, grain: 0, ore: 0 };
    });
    const actions = deriveActions(tableWith(view), 'p1');
    expect(actions.find((action) => action.id === 'build.ship')).toMatchObject({ enabled: true, commandType: 'build.ship' });
    expect(actions.find((action) => action.id === 'ship.move')).toMatchObject({ enabled: true, commandType: 'ship.pick', targetCount: 1 });
    const base = deriveActions(tableWith({ ...view, hints: { ...view.hints!, modules: undefined } }), 'p1');
    expect(base.some((action) => action.id === 'build.ship' || action.id === 'ship.move')).toBe(false);
  });

  it('moves a ship in two steps: pick the ship, then its new path', () => {
    const view = seaView((state) => {
      state.board.buildings[COAST] = { player: 'p1', city: false };
      state.board.roads[NW] = { player: 'p1', ship: true };
      state.board.roads[NE] = { player: 'p1', ship: true };
    });
    const pick = boardIntent(tableWith(view, { selection: { ...EMPTY_SELECTION, kind: 'edge', commandType: 'ship.pick' } }), 'p1');
    expect(pick?.targets).toEqual([NE]);
    const move = boardIntent(tableWith(view, {
      selection: { kind: 'edge', index: null, commandType: 'ship.move', labelId: 'sf.move.target', params: { from: NE }, field: 'to' },
    }), 'p1');
    expect(move?.targets).toEqual(seafarersHints(view)!.movableShips[0]!.targets);
    expect(move?.targets.length).toBeGreaterThan(0);
  });

  it('targets land for the robber and sea for the pirate on a 7', () => {
    const view = seaView((state) => {
      state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    });
    const intent = boardIntent(tableWith(view), 'p1')!;
    expect(intent.commandType).toBe('pending.moveRobber');
    expect(intent.targets).toContain(SEA_HEX);
    expect(intent.targets).not.toContain(view.board.robber);
    // The pirate starts on the frame, so it cannot "move" to the frame again.
    expect(seafarersHints(view)!.pirateTargets).not.toContain(null);
  });

  it('collects gold choices and submits exactly the required count', () => {
    const view = seaView((state) => {
      state.pending = { kind: 'seafarers.gold', module: 'seafarers', responders: ['p1'], data: { picks: { p1: 2 } } };
    });
    const submitCommand = vi.fn();
    const controller = { state: tableWith(view), actions: { submitCommand, selectTarget: vi.fn(), cancelSelection: vi.fn() } } as unknown as TableController;
    render(<LocaleProvider locale="en"><SeafarersPrompt controller={controller} /></LocaleProvider>);
    const confirm = screen.getByTestId('gold-confirm');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('gold-ore'));
    fireEvent.click(screen.getByTestId('gold-wool'));
    expect((screen.getByTestId('gold-ore') as HTMLButtonElement).disabled).toBe(true); // two picks reached
    fireEvent.click(confirm);
    expect(submitCommand).toHaveBeenCalledWith({ type: 'gold.choose', resources: ['ore', 'wool'] }, 'play.pending.seafarers.gold');
  });

  it('draws ships, the pirate and island-bonus tokens on the SVG board', () => {
    const view = seaView((state) => {
      state.board.buildings[50] = { player: 'p1', city: false };
      state.board.roads[NE] = { player: 'p1', ship: true };
      state.board.pirate = SEA_HEX;
      state.moduleState = { seafarers: { window: state.windowId, built: [], moved: false, islands: { p1: [3] }, claims: [{ player: 'p1', island: 3, vertex: 50 }] } };
    });
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const { container } = render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
      arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
    expect(container.querySelector(`[data-testid="ship-${NE}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="road-${NE}"]`)).toBeNull();
    expect(container.querySelector('[data-testid="pirate-hex"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="island-bonus-50"]')).not.toBeNull();
  });

  it('picks sea targets at the water plane and floats coastal ships off the beach', () => {
    const view = seaView();
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const [seaHex] = targetsFromGeometry(geometry, 'hex', [SEA_HEX]);
    expect(seaHex!.world.y).toBe(SEA_LEVEL);
    const [land] = targetsFromGeometry(geometry, 'hex', [view.board.robber]);
    expect(land!.world.y).toBe(0);
    const [seaEdge] = targetsFromGeometry(geometry, 'edge', [NW]);
    expect(seaEdge!.world.y).toBe(SEA_LEVEL);
    // A coastal ship sits at sea level, pushed away from its land hex.
    const coastEdge = geometry.edges.findIndex((edge) => {
      const hexes = geometry.topology.edges[edge.index]!.hexes;
      return hexes.length === 2 && hexes.filter((hex) => geometry.land[hex]).length === 1;
    });
    const transform = shipTransform(geometry, coastEdge)!;
    expect(transform.position[1]).toBeCloseTo(SEA_LEVEL + 0.01);
  });

  it.each(['setup.ship', 'ship.built', 'ship.moved'])('keeps separate arrivals for ships after %s', (eventType) => {
    const view = seaView((state) => {
      state.board.roads[NW] = { player: 'p1', ship: true };
      state.board.roads[NE] = { player: 'p1', ship: true };
    });
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const event = (seq: number, edge: number) => makeEvent(seq, eventType,
      eventType === 'ship.moved' ? { playerId: 'p1', from: 0, to: edge } : { playerId: 'p1', edge });
    const first = placementEffectGroups('sf-game', [event(1, NW)]);
    const second = placementEffectGroups('sf-game', [event(2, NE)]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    const arrivals = [...first, ...second];
    const ships = shipInstances(geometry, view.board, arrivals);
    expect(ships.find((ship) => ship.index === NW)?.arrivalKey).toBe(first[0]!.id);
    expect(ships.find((ship) => ship.index === NE)?.arrivalKey).toBe(second[0]!.id);
    expect(shipInstances(geometry, view.board, second).find((ship) => ship.index === NW)?.arrivalKey).toBeNull();

    const { container } = render(<LocaleProvider locale="en"><SvgBoard svgRef={null} geometry={geometry} view={view}
      arrivals={arrivals} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
    expect(container.querySelector(`[data-testid="ship-${NW}"]`)?.classList.contains('board__building-drop')).toBe(true);
    expect(container.querySelector(`[data-testid="ship-${NE}"]`)?.classList.contains('board__building-drop')).toBe(true);
  });

  it('renders the seafarers events in both locales', () => {
    const names = (id: string) => id.toUpperCase();
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const event of [
        makeEvent(1, 'ship.built', { playerId: 'p1', edge: 3, free: true }),
        makeEvent(2, 'ship.moved', { playerId: 'p1', from: 3, to: 4 }),
        makeEvent(3, 'pirate.moved', { playerId: 'p1', hex: null, cause: 'knight' }),
        makeEvent(4, 'gold.chosen', { playerId: 'p1', resources: ['ore', 'ore'], shortBy: 1 }),
        makeEvent(5, 'island.bonus', { playerId: 'p1', island: 3, vertex: 2, points: 2 }),
        makeEvent(6, 'dev.knight', { playerId: 'p1', hex: 4, playedKnights: 1, pirate: true }),
      ]) {
        const text = translateEvent(locale, event, names);
        expect(text.unknown, event.type).toBe(false);
        expect(text.text).not.toMatch(/\{\w+\}/);
      }
    }
    expect(translateEvent('en', makeEvent(6, 'dev.knight', { playerId: 'p1', hex: 4, playedKnights: 1, pirate: true }), names).messageId)
      .toBe('event.dev.knight.pirate');
  });
});
