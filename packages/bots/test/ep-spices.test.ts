/**
 * Spices 的 B-GAME（Q1）、Q2 門檻與固定狀態決策（E&P 計畫 §6.1、§6.2；E4b）。
 *
 * - 'ep-spices-2025'：3、4 人；種子 `seedsFor`；座位 standard 與 easy 交錯，另有「1 個保底席」的對局。
 * - 每局（Q2）：交付香料 ≥ 1 且交付魚 ≥ 1；平均交付香料 ≥ 2.0、農場 crew ≥ 2.0；
 *   easy 與 standard 各自送出 `ep.buildSettler`、`ep.moveShip`、`ep.found`，以及 `ep.dropCrew` 或 `ep.deliver`。
 */

import { describe, expect, it } from 'vitest';
import { getTopology, requireProfile, type GameState } from '@katan/rules';
import { createBotPolicy } from '../src/policy.ts';
import type { BotLevel } from '../src/types.ts';
import { epView } from '../src/modules/explorersPirates/view.ts';
import { GAME_TIMEOUT, seedsFor, viewFor } from './harness.ts';
import { assertGame, assertLevels, average, play, type Stats } from './ep-games.ts';
import { enterMovement, slotOf, toAction } from './ep-fixtures.ts';

declare const console: { table(data: unknown): void };

const PROFILE = 'ep-spices-2025';
const profile = requireProfile(PROFILE);

describe('Spices B-GAME and Q2', () => {
  const all: Stats[] = [];
  const seeds = seedsFor(profile);
  for (const players of profile.playerCounts) {
    it(`finishes with Q1 invariants (${PROFILE}, ${players} players, ${seeds.length} seeds)`, () => {
      for (const seed of seeds) {
        const game = play(PROFILE, players, seed, false);
        all.push(game.stats);
        assertGame(PROFILE, `${players}p seed ${seed}`, game);
        expect(game.stats.spice, `${players}p seed ${seed}: spice delivered`).toBeGreaterThanOrEqual(1);
        expect(game.stats.fish, `${players}p seed ${seed}: fish delivered`).toBeGreaterThanOrEqual(1);
      }
    }, GAME_TIMEOUT * 2);

    it(`finishes with one fallback seat (${PROFILE}, ${players} players)`, () => {
      const game = play(PROFILE, players, 1, true);
      all.push(game.stats);
      assertGame(PROFILE, `${players}p fallback seat`, game);
      expect(game.run.state.result?.playerId).not.toBe('bot1');
    }, GAME_TIMEOUT);
  }

  it('meets the average and per-level Q2 thresholds', () => {
    const mixed = all.filter((entry) => !entry.fallbackSeat);
    console.table(all.map((s) => ({ game: `${s.players}p s${s.seed}${s.fallbackSeat ? ' fb' : ''}`, steps: s.steps, rounds: s.rounds, spice: s.spice, farmCrews: s.farmCrews, fish: s.fish, lairs: s.lairs, rejections: s.rejections, maxWindow: s.maxWindow })));
    expect(average(mixed, (entry) => entry.spice), 'average spice delivered').toBeGreaterThanOrEqual(2);
    expect(average(mixed, (entry) => entry.farmCrews), 'average spice-farm crews').toBeGreaterThanOrEqual(2);
    for (const players of profile.playerCounts) assertLevels(mixed, players);
  });
});

describe('Spices fixed-state decisions', () => {
  const policy = (state: GameState, me: string, level: BotLevel = 'standard') =>
    createBotPolicy(level).decide(viewFor(state, me), { selfId: me, level, seed: 1, offerPhases: {} });
  const setup = () => {
    const { state, me } = toAction(PROFILE, 3, 1);
    const slot = slotOf(state);
    enterMovement(state, null);
    slot.turn.fishRolled = true;
    slot.ships = slot.ships.filter((ship) => ship.player !== me).concat(slot.ships.filter((ship) => ship.player === me).slice(0, 1));
    const ship = slot.ships.find((entry) => entry.player === me)!;
    // 在船旁邊放一個農場（船端點碰到的格子）。
    const topo = getTopology(state.board.layout.topologyId);
    const hex = topo.edges[ship.edge]!.vertices.flatMap((vertex) => topo.vertices[vertex]!.hexes).find((candidate) => !slot.sites.some((site) => site.hex === candidate))!;
    const farm = { hex, kind: 'spice', ability: 'swift', bonus: null, crews: [] as string[], sacks: state.players.map((player) => player.id) };
    (slot.sites as unknown[]).push(farm);
    return { state, me, slot, ship, farm };
  };

  it('lands a crew on a farm where it has none, then loads its sack', () => {
    const { state, me, ship, farm } = setup();
    ship.cargo = ['crew'];
    expect(policy(state, me)).toEqual({ type: 'ep.dropCrew', ship: ship.id, hex: farm.hex });
    ship.cargo = [];
    farm.crews.push(me);
    expect(policy(state, me)).toEqual({ type: 'ep.loadSpice', ship: ship.id, hex: farm.hex });
  });

  it('delivers a sack once at a Council anchor', () => {
    const { state, me, slot, ship } = setup();
    const anchor = epView(viewFor(state, me))!.anchors[0]!;
    ship.edge = getTopology(state.board.layout.topologyId).vertices[anchor]!.edges.find((edge) => !slot.ships.some((other) => other.edge === edge))!;
    ship.cargo = ['spice'];
    expect(policy(state, me)).toEqual({ type: 'ep.deliver', ship: ship.id });
  });
});
