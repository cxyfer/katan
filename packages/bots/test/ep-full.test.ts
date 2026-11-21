/**
 * Explorers & Pirates（Full）的 B-GAME（Q1）、Q2 門檻與固定狀態決策（E&P 計畫 §6.1、§6.2；E4b）。
 *
 * - 'ep-full-2025'：3、4 人；種子 `seedsFor`；座位 standard 與 easy 交錯，另有「1 個保底席」的對局。
 * - Q2：每局三條軌道（lairs、fish、spices）至少推進兩條；平均每條軌道每局推進 ≥ 1.0；
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

const PROFILE = 'ep-full-2025';
const profile = requireProfile(PROFILE);
const TRACKS = ['lairs', 'fish', 'spices'] as const;

describe('Full B-GAME and Q2', () => {
  const all: Stats[] = [];
  const seeds = seedsFor(profile);
  for (const players of profile.playerCounts) {
    it(`finishes with Q1 invariants (${PROFILE}, ${players} players, ${seeds.length} seeds)`, () => {
      for (const seed of seeds) {
        const game = play(PROFILE, players, seed, false);
        all.push(game.stats);
        assertGame(PROFILE, `${players}p seed ${seed}`, game);
        const advanced = TRACKS.filter((track) => (game.stats.tracks[track] ?? 0) > 0);
        expect(advanced.length, `${players}p seed ${seed}: tracks advanced (${advanced})`).toBeGreaterThanOrEqual(2);
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
    console.table(all.map((s) => ({ game: `${s.players}p s${s.seed}${s.fallbackSeat ? ' fb' : ''}`, steps: s.steps, rounds: s.rounds, lairs: s.lairs, spice: s.spice, farmCrews: s.farmCrews, fish: s.fish, tracks: JSON.stringify(s.tracks), rejections: s.rejections, maxWindow: s.maxWindow })));
    for (const track of TRACKS) expect(average(mixed, (entry) => entry.tracks[track] ?? 0), `average ${track} track advances`).toBeGreaterThanOrEqual(1);
    for (const players of profile.playerCounts) assertLevels(mixed, players);
  });
});

describe('Full fixed-state decisions', () => {
  const policy = (state: GameState, me: string, level: BotLevel = 'standard') =>
    createBotPolicy(level).decide(viewFor(state, me), { selfId: me, level, seed: 1, offerPhases: {} });

  it('delivers a mixed fish and spice hold once, then not again', () => {
    const { state, me } = toAction(PROFILE, 3, 1);
    enterMovement(state, null);
    const slot = slotOf(state);
    slot.turn.fishRolled = true;
    const ship = slot.ships.find((entry) => entry.player === me)!;
    const anchor = epView(viewFor(state, me))!.anchors[0]!;
    ship.edge = getTopology(state.board.layout.topologyId).vertices[anchor]!.edges.find((edge) => !slot.ships.some((other) => other.edge === edge))!;
    ship.cargo = ['fish', 'spice'];
    expect(policy(state, me)).toEqual({ type: 'ep.deliver', ship: ship.id });
    ship.cargo = [];
    expect(policy(state, me)?.type).not.toBe('ep.deliver');
  });
});
