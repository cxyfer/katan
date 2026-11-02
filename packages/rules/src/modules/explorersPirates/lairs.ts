/**
 * Pirate lairs mission (EP25 p. 13, EP25-M pp. 11–12). A third crew captures a
 * lair; after the active player's Movement phase, clockwise from them, every
 * involved player takes 2 gold and advances one space; the hero of the battle
 * (die + own crews there; ties: more crews, then the tied reroll) advances one
 * more space and returns one crew. The lair token is then turned over: its
 * number makes the gold field produce.
 */

import type { GameState } from '../../types.ts';
import type { ModuleContext } from '../types.ts';
import { advanceTrack, gainGold } from './core.ts';
import { epState, siteAt } from './state.ts';

export interface LairRoll {
  playerId: string;
  die: number;
  crews: number;
  total: number;
}

export function resolveCaptures(state: GameState, ctx: ModuleContext): void {
  const slot = epState(state);
  const captures = slot.captures.slice().sort((a, b) => a - b);
  slot.captures = [];
  for (const hex of captures) resolveLair(state, hex, ctx);
}

function resolveLair(state: GameState, hex: number, ctx: ModuleContext): void {
  const slot = epState(state);
  const site = siteAt(slot, hex);
  if (!site || site.kind !== 'lair' || site.captured) return;
  const seat = state.turn.seat;
  const count = state.players.length;
  const involved = state.players
    .map((_, offset) => state.players[(seat + offset) % count]!.id)
    .filter((id) => site.crews.includes(id));
  const crewsOf = (id: string) => site.crews.filter((crew) => crew === id).length;
  for (const playerId of involved) {
    const gold = gainGold(slot, playerId, 2);
    ctx.kit.emit(state, 'ep.lairReward', { playerId, hex, gold });
    advanceTrack(state, 'lairs', playerId, ctx, 'lair');
  }
  const rounds: LairRoll[][] = [];
  let contenders = involved;
  let hero = involved[0]!;
  for (let guard = 0; guard < 32; guard++) {
    const round = contenders.map((playerId) => {
      const die = ctx.rng.int(6) + 1;
      return { playerId, die, crews: crewsOf(playerId), total: die + crewsOf(playerId) };
    });
    rounds.push(round);
    const best = Math.max(...round.map((roll) => roll.total));
    let tied = round.filter((roll) => roll.total === best);
    if (tied.length > 1) {
      const most = Math.max(...tied.map((roll) => roll.crews));
      tied = tied.filter((roll) => roll.crews === most);
    }
    hero = tied[0]!.playerId;
    if (tied.length === 1) break;
    contenders = tied.map((roll) => roll.playerId);
  }
  advanceTrack(state, 'lairs', hero, ctx, 'hero');
  site.crews.splice(site.crews.indexOf(hero), 1);
  const number = slot.lairTokens.splice(ctx.rng.int(slot.lairTokens.length), 1)[0] ?? null;
  site.captured = true;
  state.board.layout.numbers[hex] = number;
  ctx.kit.emit(state, 'ep.lairCaptured', { hex, hero, number, involved, rounds });
  ctx.kit.afterBoardChange(state);
}
