/**
 * The barbarian track and attack (CK25 pp. 6, 8, 11).
 *
 * - A ship result moves the barbarians one space; on the last space they
 *   attack at once (CK-FAQ: no activation in between).
 * - Barbarians' strength = cities on the board, a metropolis city counting
 *   once (CK25 p. 11 and its worked example). Defenders' strength = all
 *   active knights' strengths.
 * - Barbarians stronger: the lowest contributors (zero active knights counts
 *   as lowest) each lose one city that is not a metropolis; if none of them
 *   can, the next lowest group does, and so on. The owner chooses the city
 *   (CK-FAQ). The city becomes a settlement and loses its wall; without a
 *   settlement piece left it lies on its side (`toppled`) and must be
 *   upgraded before any other settlement.
 * - Defenders at least as strong: the single best contributor takes a
 *   Defender VP token; on a tie each tied player, from the current player,
 *   draws a progress card from a deck of their choice.
 * - Then the ship returns to the start and every knight becomes inactive.
 *   The first attack brings the robber onto the desert (CK25 p. 6).
 */

import { countBuildings, playerById } from '../../analysis.ts';
import type { CommandOutcome, GameState, ModulePending } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import { BARBARIAN_TRACK_LENGTH, CITIES_KNIGHTS, TRACKS, type Track } from './constants.ts';
import { drawProgressCard, queueProgressDiscards } from './progress.ts';
import { ckState, metropolisAt, turnOrder, type AttackSummary } from './state.ts';

export const PILLAGE_FRAME = 'citiesKnights.pillage' as const;
export const DEFENDER_FRAME = 'citiesKnights.defenderDraw' as const;

/** Moves the ship one space; returns true when the barbarians attack. */
export function advanceBarbarians(state: GameState, ctx: ModuleContext): boolean {
  const slot = ckState(state);
  slot.barbarian = Math.min(BARBARIAN_TRACK_LENGTH, slot.barbarian + 1);
  ctx.kit.emit(state, 'ck.barbariansAdvanced', { position: slot.barbarian, length: BARBARIAN_TRACK_LENGTH });
  if (slot.barbarian < BARBARIAN_TRACK_LENGTH) return false;
  resolveAttack(state, ctx);
  return true;
}

export function barbarianStrength(state: GameState): number {
  return state.board.buildings.filter((building) => building?.city).length;
}

export function knightContributions(state: GameState): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  for (const knight of ckState(state).knights) if (knight.active) out[knight.player] = (out[knight.player] ?? 0) + knight.level;
  return out;
}

/** Cities a player can lose: own cities without a metropolis. */
export function pillageableCities(state: GameState, playerId: string): number[] {
  const out: number[] = [];
  state.board.buildings.forEach((building, vertex) => {
    if (building?.city && building.player === playerId && metropolisAt(state, vertex) === null) out.push(vertex);
  });
  return out;
}

function resolveAttack(state: GameState, ctx: ModuleContext): void {
  const slot = ckState(state);
  const barbarians = barbarianStrength(state);
  const contributions = knightContributions(state);
  const defenders = Object.values(contributions).reduce((sum, value) => sum + value, 0);
  const summary: AttackSummary = {
    atSeq: state.seq + 1,
    barbarians,
    defenders,
    contributions,
    outcome: barbarians > defenders ? 'barbarians' : 'defenders',
    losers: [],
    defender: null,
    tied: [],
    pillaged: [],
  };
  slot.lastAttack = summary;
  slot.attacks += 1;
  ctx.kit.emit(state, 'ck.barbariansAttack', { barbarians, defenders, contributions: { ...contributions }, outcome: summary.outcome });

  const choices: string[] = [];
  if (summary.outcome === 'barbarians') {
    summary.losers = losingPlayers(state, contributions);
    for (const playerId of summary.losers) {
      const cities = pillageableCities(state, playerId);
      if (cities.length === 1) pillageCity(state, playerId, cities[0]!, ctx);
      else choices.push(playerId);
    }
  } else {
    const best = Math.max(...Object.values(contributions));
    // Only a player whose active knights took part can be rewarded; when no
    // knight defended (e.g. no city yet), nobody is (explicit interpretation,
    // docs/FIDELITY.md).
    const top = best > 0 ? turnOrder(state).filter((id) => contributions[id] === best) : [];
    if (top.length === 0) {
      // No reward.
    } else if (top.length === 1) {
      summary.defender = top[0]!;
      playerById(state, top[0]!)!.defenders += 1;
      ctx.kit.emit(state, 'ck.defenderOfCatan', { playerId: top[0]! });
    } else {
      summary.tied = top;
      ctx.kit.emit(state, 'ck.defendersTied', { players: top.slice() });
    }
  }

  // The barbarians go home and every knight lies down (CK25 p. 11).
  slot.barbarian = 0;
  for (const knight of slot.knights) knight.active = false;
  if (slot.attacks === 1) {
    state.board.robber = state.board.layout.robber;
    ctx.kit.emit(state, 'ck.robberEntered', { hex: state.board.robber });
  }
  ctx.kit.afterBoardChange(state);

  if (choices.length > 0) {
    ctx.kit.enqueuePending(state, { kind: PILLAGE_FRAME, module: CITIES_KNIGHTS, responders: choices, data: {} });
  }
  if (summary.tied.length > 0) {
    const frame: ModulePending = { kind: DEFENDER_FRAME, module: CITIES_KNIGHTS, responders: summary.tied.slice(), data: {} };
    ctx.kit.enqueuePending(state, frame);
    if (state.pending === frame) skipEmptyDecks(state, frame, ctx);
  }
  ctx.kit.checkVictory(state);
}

/**
 * The lowest contributing group that can lose a city (CK25 p. 11): groups are
 * taken from the lowest strength upwards until one has a pillageable city;
 * within that group every player who can lose a city does.
 */
function losingPlayers(state: GameState, contributions: Record<string, number>): string[] {
  const levels = [...new Set(Object.values(contributions))].sort((a, b) => a - b);
  for (const level of levels) {
    const group = turnOrder(state).filter((id) => contributions[id] === level && pillageableCities(state, id).length > 0);
    if (group.length > 0) return group;
  }
  return [];
}

function pillageCity(state: GameState, playerId: string, vertex: number, ctx: ModuleContext): void {
  const slot = ckState(state);
  const building = state.board.buildings[vertex]!;
  const toppled = countBuildings(state, playerId, 'settlement') >= ctx.profile.pieces.settlements;
  building.city = false;
  const hadWall = slot.walls.includes(vertex);
  if (hadWall) {
    slot.walls = slot.walls.filter((wall) => wall !== vertex);
    playerById(state, playerId)!.cityWalls = slot.walls.filter((wall) => state.board.buildings[wall]?.player === playerId).length;
  }
  if (toppled) slot.toppled.push(vertex);
  slot.lastAttack?.pillaged.push({ player: playerId, vertex });
  ctx.kit.emit(state, 'ck.cityPillaged', { playerId, vertex, wallLost: hadWall, toppled });
}

/** `barbarians.pillage { vertex }` — a losing player chooses their city. */
export function choosePillage(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = state.pending as ModulePending | null;
  if (!frame || frame.kind !== PILLAGE_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  if (!frame.responders.includes(actorId)) return kit.fail('E_NOT_ACTOR');
  const vertex = command.vertex;
  if (typeof vertex !== 'number' || !pillageableCities(state, actorId).includes(vertex)) {
    return kit.fail('E_ILLEGAL_TARGET', { vertex });
  }
  pillageCity(state, actorId, vertex, ctx);
  kit.afterBoardChange(state);
  frame.responders = frame.responders.filter((id) => id !== actorId);
  if (frame.responders.length === 0) kit.completePending(state, ctx.rng);
  return kit.accept(state);
}

function decksWithCards(state: GameState): Track[] {
  return TRACKS.filter((track) => state.progressDecks[track].length > 0);
}

/** With every deck empty the remaining tied players receive nothing. */
function skipEmptyDecks(state: GameState, frame: ModulePending, ctx: ModuleContext): void {
  if (decksWithCards(state).length > 0) return;
  for (const playerId of frame.responders) ctx.kit.emit(state, 'ck.progressDeckEmpty', { playerId, track: null });
  frame.responders = [];
  finishDefenderDraws(state, frame, ctx);
}

function finishDefenderDraws(state: GameState, frame: ModulePending, ctx: ModuleContext): void {
  if (frame.responders.length > 0 || state.pending !== frame) return;
  // Off-turn players over the hand limit discard before the roll goes on.
  queueProgressDiscards(state, ctx, true);
  ctx.kit.completePending(state, ctx.rng);
}

/** `barbarians.chooseDeck { track }` — a tied defender draws from a deck of choice. */
export function chooseDefenderDeck(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = state.pending as ModulePending | null;
  if (!frame || frame.kind !== DEFENDER_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  if (!frame.responders.includes(actorId)) return kit.fail('E_NOT_ACTOR');
  if (frame.responders[0] !== actorId) return kit.fail('E_NOT_YOUR_TURN', { waitingFor: frame.responders[0] });
  const track = command.track as Track;
  if (!TRACKS.includes(track)) return kit.fail('E_INVALID_SELECTION', { track });
  if (state.progressDecks[track].length === 0) return kit.fail('E_DECK_EMPTY', { track });
  drawProgressCard(state, actorId, track, ctx, 'defense');
  frame.responders.shift();
  kit.checkVictory(state);
  if (state.result) return kit.accept(state);
  if (frame.responders.length > 0) skipEmptyDecks(state, frame, ctx);
  else finishDefenderDraws(state, frame, ctx);
  return kit.accept(state);
}
