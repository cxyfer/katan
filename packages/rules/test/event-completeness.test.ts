/**
 * 轉移回傳的事件必須完整（#143）：`state.log` 只保留最後 200 則（`engine.ts` 的
 * `LOG_LIMIT`），伺服器卻依轉移回傳的事件寫入事件庫，所以回傳的事件不能從 log
 * 推導，一次轉移發出超過上限的事件時也不能少。
 */

import { describe, expect, it } from 'vitest';
import { abandonGame, applyCommand, legalRobberHexes, type Command } from '../src/engine.ts';
import { seededRng } from '../src/rng.ts';
import { RESOURCES, type GameEvent, type GameState, type Resource } from '../src/types.ts';
import { act, playableGame, scriptedRng, setHand } from './helpers.ts';

const LOG_LIMIT = 200;

/** `from + 1` 到 `to` 的連續序號。 */
function seqRange(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index + 1);
}

/** p1 在行動時段開出一則報價後，再複製成 `count` 則開放中的報價，模擬同一時段內大量開出的報價。 */
function crowdedWindow(count: number): GameState {
  const { state } = playableGame({ players: 4 });
  setHand(state, 'p1', { lumber: 1 });
  const offered = act(
    state,
    'p1',
    { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { ore: 1 } },
    scriptedRng([0]),
  ).state;
  const template = offered.offers[0]!;
  offered.offers = Array.from({ length: count }, (_, index) => ({ ...template, id: `offer-crowd-${index}` }));
  return offered;
}

describe('#143 events returned by transitions', () => {
  it('returns every event of a command that emits more than the capped log', () => {
    const crowded = crowdedWindow(250);
    const outcome = applyCommand(crowded, 'p1', { type: 'turn.end' }, scriptedRng([0]));
    if (!outcome.ok) throw new Error(outcome.error.code);
    const { state: next, events } = outcome;

    expect(events.map((event) => event.seq)).toEqual(seqRange(crowded.seq, next.seq));
    const expiries = events.filter((event) => event.type === 'trade.expired');
    expect(expiries.map((event) => event.params.offerId)).toEqual(crowded.offers.map((offer) => offer.id));
    expect(expiries.every((event) => event.params.reason === 'window')).toBe(true);
    expect(events.at(-1)?.type).toBe('turn.started');
    // 狀態內的 log 仍然有上限，只留最後 200 則。
    expect(next.log).toHaveLength(LOG_LIMIT);
    expect(next.log).toEqual(events.slice(-LOG_LIMIT));
  });

  it('keeps returning complete events once the log is already capped', () => {
    const crowded = crowdedWindow(250);
    const ended = act(crowded, 'p1', { type: 'turn.end' }, scriptedRng([0])).state;
    expect(ended.log).toHaveLength(LOG_LIMIT);
    const rolled = act(ended, 'p2', { type: 'turn.roll' }, scriptedRng([2, 3]));
    expect(rolled.events.length).toBeGreaterThan(0);
    expect(rolled.events.map((event) => event.seq)).toEqual(seqRange(ended.seq, rolled.state.seq));
    expect(rolled.state.log).toHaveLength(LOG_LIMIT);
    expect(rolled.state.log.slice(-rolled.events.length)).toEqual(rolled.events);
  });

  it('returns the offer expiries together with the abandonment', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 2 });
    setHand(state, 'p2', { ore: 1 });
    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    current = act(current, 'p2', { type: 'trade.respond', offerId: current.offers[0]!.id, response: 'consented' }, scriptedRng([0])).state;
    current = act(
      current,
      'p1',
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const snapshot = JSON.parse(JSON.stringify(current)) as GameState;

    const { state: ended, events } = abandonGame(current);
    expect(current).toEqual(snapshot);
    expect(ended.result).toMatchObject({ playerId: null, reason: 'abandoned' });
    expect(events.map((event) => [event.type, event.params.reason])).toEqual([
      ['trade.expired', 'gameOver'],
      ['trade.expired', 'gameOver'],
      ['game.abandoned', 'abandoned'],
    ]);
    expect(events.map((event) => event.seq)).toEqual(seqRange(current.seq, ended.seq));
    expect(ended.log.slice(-events.length)).toEqual(events);

    // 已有結果：不再轉移，回傳同一個物件與空事件。
    const again = abandonGame(ended, 'expired');
    expect(again.state).toBe(ended);
    expect(again.events).toEqual([]);
  });

  it('returns every expiry of an abandonment beyond the capped log', () => {
    const crowded = crowdedWindow(250);
    const { state: ended, events } = abandonGame(crowded, 'expired');
    expect(events).toHaveLength(251);
    expect(events.map((event) => event.seq)).toEqual(seqRange(crowded.seq, ended.seq));
    expect(events.at(-1)).toMatchObject({ type: 'game.abandoned', params: { reason: 'expired' } });
    expect(ended.log).toHaveLength(LOG_LIMIT);
  });

  it('accumulates a contiguous history across a game longer than the log', () => {
    const { state: start } = playableGame({ players: 4, phase: 'preroll' });
    // 建局與初始配置的事件不到上限，log 從第一則開始完整保留。
    expect(start.log[0]?.seq).toBe(1);
    const history: GameEvent[] = start.log.slice();
    let state = start;
    const rng = seededRng(97);
    const step = (actorId: string, command: Command): void => {
      const outcome = applyCommand(state, actorId, command, rng);
      if (!outcome.ok) throw new Error(`${command.type} rejected: ${outcome.error.code}`);
      history.push(...outcome.events);
      state = outcome.state;
    };
    for (let guard = 0; state.seq <= 3 * LOG_LIMIT; guard++) {
      if (guard > 5000) throw new Error('the game did not advance');
      const pending = pendingAnswer(state);
      if (pending) {
        step(pending.actorId, pending.command);
        continue;
      }
      const actor = state.players[state.turn.seat]!.id;
      step(actor, state.turn.phase === 'preroll' ? { type: 'turn.roll' } : { type: 'turn.end' });
    }
    expect(history.map((event) => event.seq)).toEqual(seqRange(0, state.seq));
    expect(state.log).toHaveLength(LOG_LIMIT);
    expect(state.log).toEqual(history.slice(-LOG_LIMIT));
  });
});

/** 依待決效果給出一個回應指令；沒有待決效果時回傳 null。 */
function pendingAnswer(state: GameState): { actorId: string; command: Command } | null {
  const pending = state.pending;
  if (!pending) return null;
  switch (pending.kind) {
    case 'discard': {
      const actorId = Object.keys(pending.required).find((candidate) => !pending.submitted[candidate])!;
      const player = state.players.find((candidate) => candidate.id === actorId)!;
      const pool: Resource[] = [];
      for (const resource of RESOURCES) for (let i = 0; i < player.resources[resource]; i++) pool.push(resource);
      return { actorId, command: { type: 'pending.discard', resources: pool.slice(0, pending.required[actorId]) } };
    }
    case 'moveRobber':
      return { actorId: pending.actor, command: { type: 'pending.moveRobber', hex: legalRobberHexes(state, pending.actor)[0]! } };
    case 'steal':
      return { actorId: pending.actor, command: { type: 'pending.steal', victim: pending.candidates[0]! } };
    default:
      throw new Error(`unexpected pending effect: ${pending.kind}`);
  }
}
