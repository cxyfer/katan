import { describe, expect, it } from 'vitest';
import {
  boardEffectGroup, decideBoardAnimation, enqueueBoardEffects,
  MAX_EFFECT_DURATION_MS, MAX_EFFECT_GROUPS,
} from '../src/board/animation.ts';
import { makeEvent, makeSnapshot, makeView } from '../src/test/fixtures.ts';
import type { GameSyncMetadata } from '../src/state/table.ts';

const online: GameSyncMetadata = { generation: 1, cause: 'snapshot' };
function snapshot(seq: number, revision = 3, events = [makeEvent(seq, 'turn.rolled', { dice: [2, 5] })]) {
  return makeSnapshot({ ...makeView({ events }), seq }, revision);
}
const start = () => decideBoardAnimation(null, snapshot(100), online).cursor!;

describe('presentation cursor (E01–E06, E08)', () => {
  it('baselines on view.seq even when history is empty or only a recent window', () => {
    for (const events of [[], [makeEvent(60, 'turn.rolled')]]) {
      const result = decideBoardAnimation(null, snapshot(100, 3, events), online);
      expect(result.kind).toBe('baseline');
      expect(result.events).toEqual([]);
      expect(result.cursor).toEqual({ gameId: 'g1', revision: 3, viewSeq: 100, syncGeneration: 1, consumedSeq: 100, eventFloor: 100 });
    }
  });

  it('plays a newer snapshot exactly once, sorting and deduplicating authorised events', () => {
    const events = [makeEvent(102, 'production.resolved', { grants: [] }), makeEvent(101, 'turn.rolled'), makeEvent(102, 'production.resolved')];
    const next = snapshot(102, 4, events);
    const decision = decideBoardAnimation(start(), next, online);
    expect(decision.events.map((event) => event.seq)).toEqual([101, 102]);
    expect(decision.events[1]!.params).toEqual({ grants: [] });
    expect(decision.cursor?.revision).toBe(4);
    expect(decision.cursor?.consumedSeq).toBe(102);
    expect(decideBoardAnimation(decision.cursor, next, online).events).toEqual([]);
    expect(decideBoardAnimation(decision.cursor, { ...next, view: { ...next.view, events: events.reverse() } }, online).events).toEqual([]);
  });

  it('compares revisions and view sequences independently, without rolling the cursor back', () => {
    const cursor = start();
    for (const next of [snapshot(101, 2), snapshot(99, 4)]) {
      expect(decideBoardAnimation(cursor, next, online)).toEqual({ kind: 'ignore', cursor, events: [] });
    }
    const revisionOnly = decideBoardAnimation(cursor, snapshot(100, 4), online);
    expect(revisionOnly.events).toEqual([]);
    expect(revisionOnly.cursor?.revision).toBe(4);
    expect(revisionOnly.cursor?.viewSeq).toBe(100);
  });

  it.each(['open', 'resume', 'reconnect', 'gap'] as const)('rebases %s without replaying even a complete event window', (cause) => {
    const result = decideBoardAnimation(start(), snapshot(101, 4), { generation: 2, cause });
    expect(result.kind).toBe('baseline');
    expect(result.events).toEqual([]);
    expect(result.cursor?.consumedSeq).toBe(101);
    expect(decideBoardAnimation(result.cursor, snapshot(102, 5), { generation: 2, cause: 'snapshot' }).events.map((event) => event.seq)).toEqual([102]);
  });

  it.each([[], [makeEvent(103, 'turn.rolled')], [makeEvent(101, 'turn.rolled'), makeEvent(103, 'production.resolved')]].map((events) => ({ events })))(
    'rebases incomplete windows and never fills private gaps', ({ events }) => {
      const result = decideBoardAnimation(start(), snapshot(103, 4, events), online);
      expect(result.kind).toBe('baseline');
      expect(result.events).toEqual([]);
      expect(result.cursor?.consumedSeq).toBe(103);
    },
  );

  it('resets for a new game with smaller counters, then plays its next event', () => {
    const first = { ...snapshot(1, 1), gameId: 'g2' };
    const baseline = decideBoardAnimation(start(), first, online);
    expect(baseline.events).toEqual([]);
    expect(baseline.cursor?.gameId).toBe('g2');
    const next = decideBoardAnimation(baseline.cursor, { ...snapshot(2, 2), gameId: 'g2' }, online);
    expect(next.events.map((event) => event.seq)).toEqual([2]);
    expect(decideBoardAnimation(next.cursor, first, { generation: 0, cause: 'snapshot' }).cursor).toBe(next.cursor);
  });

  it('consumes legacy streamed events separately until their snapshot catches up', () => {
    const streamed = snapshot(100, 4, [makeEvent(101, 'turn.rolled'), makeEvent(102, 'production.resolved')]);
    const result = decideBoardAnimation(start(), streamed, { ...online, cause: 'events' });
    expect(result.cursor).toMatchObject({ revision: 4, viewSeq: 100, consumedSeq: 102 });
    expect(result.events).toHaveLength(2);
    const caughtUp = decideBoardAnimation(result.cursor, snapshot(102, 4, streamed.view.events), online);
    expect(caughtUp.events).toEqual([]);
    expect(caughtUp.cursor?.viewSeq).toBe(102);
  });
});

describe('bounded presentation work (E07)', () => {
  it('allows eight groups including the active group, each capped at 800 ms; overflow drops the queue', () => {
    let queue: ReturnType<typeof boardEffectGroup>[] = [];
    for (let seq = 1; seq <= MAX_EFFECT_GROUPS; seq++) {
      queue = enqueueBoardEffects(queue, [boardEffectGroup('g1', [makeEvent(seq, 'turn.rolled')])]);
    }
    expect(queue).toHaveLength(8);
    expect(queue.every((group) => group.durationMs === MAX_EFFECT_DURATION_MS && group.durationMs <= 800)).toBe(true);
    expect(enqueueBoardEffects(queue, [boardEffectGroup('g1', [makeEvent(9, 'turn.rolled')])])).toEqual([]);
  });
});
