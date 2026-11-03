/** 以簡單策略自動下完一整局，供統計守恆測試使用。 */

import { totalResources } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { seededRng } from '../src/rng.ts';
import { RESOURCES, type GameState, type Resource } from '../src/types.ts';
import { newGame, runSetup } from './helpers.ts';

function attempt(state: GameState, actor: string, command: Command, rng: ReturnType<typeof seededRng>): GameState | null {
  const outcome = applyCommand(state, actor, command, rng);
  return outcome.ok ? outcome.state : null;
}

function richest(state: GameState, actor: string): Resource {
  const player = state.players.find((candidate) => candidate.id === actor)!;
  return RESOURCES.slice().sort((a, b) => player.resources[b] - player.resources[a])[0]!;
}

function poorest(state: GameState, actor: string): Resource {
  const player = state.players.find((candidate) => candidate.id === actor)!;
  return RESOURCES.slice().sort((a, b) => player.resources[a] - player.resources[b])[0]!;
}

/** 處理待決效果；回傳 null 表示沒有可處理的效果。 */
function resolvePending(state: GameState, rng: ReturnType<typeof seededRng>): GameState | null {
  const pending = state.pending;
  if (!pending) return null;
  switch (pending.kind) {
    case 'discard': {
      const id = Object.keys(pending.required).find((candidate) => !pending.submitted[candidate])!;
      const player = state.players.find((candidate) => candidate.id === id)!;
      const pool: Resource[] = [];
      for (const resource of RESOURCES) for (let i = 0; i < player.resources[resource]; i++) pool.push(resource);
      return attempt(state, id, { type: 'pending.discard', resources: pool.slice(0, pending.required[id]) }, rng);
    }
    case 'moveRobber': {
      const hexes = state.board.layout.terrain.length;
      for (let k = 0; k < hexes; k++) {
        const next = attempt(state, pending.actor, { type: 'pending.moveRobber', hex: (state.seq + k * 7) % hexes }, rng);
        if (next) return next;
      }
      return null;
    }
    case 'steal':
      return attempt(state, pending.actor, { type: 'pending.steal', victim: pending.candidates[0]! }, rng);
    case 'yearOfPlenty':
      return attempt(state, pending.actor, { type: 'pending.takeResource', resource: poorest(state, pending.actor) }, rng);
    case 'freeRoads': {
      const edge = actionHints(state, pending.actor).legalRoads[0];
      return edge === undefined ? null : attempt(state, pending.actor, { type: 'build.road', edge }, rng);
    }
    default:
      return null;
  }
}

/** Scenario-specific moves for a simulated game (rules-module frames and actions). */
export interface SimulationBot {
  /** Resolves a module frame; null when there is none to resolve. */
  pending?(state: GameState, rng: ReturnType<typeof seededRng>): GameState | null;
  /** Extra commands the acting player tries, before buying a development card. */
  actions?(state: GameState, actorId: string, step: number): Command[];
}

export function simulateGame(
  seed: number,
  maxSteps = 6000,
  options: { players?: number; profileId?: string; mode?: 'fixed' | 'variable'; bot?: SimulationBot } = {},
): GameState {
  const rng = seededRng(seed);
  let state = runSetup(newGame({ players: options.players ?? 4, seed, ...(options.profileId ? { profileId: options.profileId } : {}), ...(options.mode ? { mode: options.mode } : {}) }).state, rng);
  for (let step = 0; step < maxSteps && !state.result; step++) {
    const pendingNext = resolvePending(state, rng) ?? options.bot?.pending?.(state, rng) ?? null;
    if (pendingNext) {
      state = pendingNext;
      continue;
    }
    const actor = state.players[state.turn.seat]!;
    const hints = actionHints(state, actor.id);
    if (hints.canRoll) {
      const knight = step % 3 === 0 && actor.devCards.includes('knight') && !state.turn.devCardPlayed;
      const played = knight ? attempt(state, actor.id, { type: 'dev.playKnight', hex: (state.board.robber + 5) % 19 }, rng) : null;
      state = played ?? attempt(state, actor.id, { type: 'turn.roll' }, rng)!;
      continue;
    }
    const tries: Command[] = [];
    for (const vertex of hints.legalCities) tries.push({ type: 'build.city', vertex });
    for (const vertex of hints.legalSettlements) tries.push({ type: 'build.settlement', vertex });
    if (!state.turn.devCardPlayed) {
      for (const card of actor.devCards) {
        if (card === 'monopoly') tries.push({ type: 'dev.playMonopoly', resource: poorest(state, actor.id) });
        if (card === 'yearOfPlenty') tries.push({ type: 'dev.playYearOfPlenty' });
        if (card === 'roadBuilding') tries.push({ type: 'dev.playRoadBuilding' });
      }
    }
    if (options.bot?.actions) tries.push(...options.bot.actions(state, actor.id, step));
    tries.push({ type: 'build.devCard' });
    if (hints.legalSettlements.length === 0 && hints.legalRoads[0] !== undefined) {
      tries.push({ type: 'build.road', edge: hints.legalRoads[0] });
    }
    const give = richest(state, actor.id);
    if (actor.resources[give] >= hints.bankRates[give]) {
      tries.push({ type: 'trade.bank', give, receive: poorest(state, actor.id) });
    }
    // 偶爾與下一位玩家做一筆一換一的交易
    const partner = state.players[(state.turn.seat + 1) % state.players.length]!;
    const want = richest(state, partner.id);
    if (step % 5 === 0 && actor.resources[give] > 0 && partner.resources[want] > 0 && give !== want) {
      const offered = attempt(state, actor.id, { type: 'trade.offer', to: partner.id, give: { [give]: 1 }, want: { [want]: 1 } }, rng);
      if (offered) {
        const offerId = offered.offers.at(-1)!.id;
        const consented = attempt(offered, partner.id, { type: 'trade.respond', offerId, response: 'consented' }, rng)!;
        const settled = attempt(consented, actor.id, { type: 'trade.settle', offerId }, rng);
        if (settled) {
          state = settled;
          continue;
        }
      }
    }
    let advanced = false;
    for (const command of tries) {
      const next = attempt(state, actor.id, command, rng);
      if (next) {
        state = next;
        advanced = true;
        break;
      }
    }
    if (!advanced) {
      const ended = applyCommand(state, actor.id, { type: 'turn.end' }, rng);
      if (!ended.ok) throw new Error(`turn.end rejected: ${ended.error.code} ${JSON.stringify(state.pending)}`);
      state = ended.state;
    }
  }
  return state;
}

export function handTotal(state: GameState, playerId: string): number {
  return totalResources(state.players.find((player) => player.id === playerId)!);
}
