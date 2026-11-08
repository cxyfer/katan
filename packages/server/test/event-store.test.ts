/**
 * 事件庫完整性（#143）：狀態內的 log 只保留最後 200 則，事件庫則要保存每一則事件，
 * 序號從 1 連續到目前狀態的序號，一次指令發出超過 200 則事件時也一樣。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameState } from '@catan/rules';
import {
  openOfferOverApi,
  runSetupOverApi,
  seqRange,
  startHarness,
  startedGame,
  storedHistory,
  type TestHarness,
} from './helpers.ts';

const LOG_LIMIT = 200;

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

describe('#143 event store completeness', () => {
  it('stores every event of a command that emits more than the capped log, then keeps the history contiguous', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const { actor, revision } = await openOfferOverApi(harness, clients, gameId);

    // 直接塞入超過 log 上限的開放報價，模擬同一個行動時段內大量開出的報價。
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as GameState;
    const template = state.offers[0]!;
    state.offers = Array.from({ length: 250 }, (_, index) => ({ ...template, id: `offer-crowd-${index}` }));
    await harness.service.repo.db.run('UPDATE games SET state_json = ? WHERE id = ?', [JSON.stringify(state), gameId]);

    const ended = actor.expectOk<{ outcome: string; revision: number }>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'end-crowded-window',
        expectedRevision: revision,
        command: { type: 'turn.end' },
      }),
    );
    expect(ended.outcome).toBe('accepted');

    const afterEnd = await storedHistory(harness, gameId);
    expect(afterEnd.logLength).toBe(LOG_LIMIT);
    expect(afterEnd.events.map((event) => event.seq)).toEqual(seqRange(0, afterEnd.seq));
    const window = afterEnd.events.filter((event) => event.revision === ended.revision);
    expect(window.map((event) => event.seq)).toEqual(seqRange(state.seq, afterEnd.seq));
    const expiries = window.filter((event) => event.type === 'trade.expired');
    expect(expiries.map((event) => event.params.offerId)).toEqual(state.offers.map((offer) => offer.id));
    expect(expiries.every((event) => event.params.reason === 'window')).toBe(true);

    // log 已經截斷之後，下一個指令的事件同樣接續寫入。
    const next = JSON.parse((await harness.service.repo.findGame(gameId))!.state_json) as GameState;
    const roller = clients.find((client) => client.playerId === next.players[next.turn.seat]!.id)!;
    const rolled = roller.expectOk<{ outcome: string; revision: number }>(
      await roller.post(`/api/games/${gameId}/commands`, {
        commandId: 'roll-after-crowded-window',
        expectedRevision: ended.revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(rolled.outcome).toBe('accepted');
    const afterRoll = await storedHistory(harness, gameId);
    expect(afterRoll.seq).toBeGreaterThan(afterEnd.seq);
    expect(afterRoll.logLength).toBe(LOG_LIMIT);
    expect(afterRoll.events.map((event) => event.seq)).toEqual(seqRange(0, afterRoll.seq));
  });
});
