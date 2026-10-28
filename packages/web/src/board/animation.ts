import type { GameEvent, GameSnapshot } from '@catan/protocol';
import type { GameSyncMetadata } from '../state/table.ts';

export const MAX_EFFECT_GROUPS = 8;
export const MAX_EFFECT_DURATION_MS = 800;

/** 演出進度獨立於命令版本與盤面狀態。 */
export interface PresentationCursor {
  gameId: string;
  revision: number;
  viewSeq: number;
  syncGeneration: number;
  consumedSeq: number;
  /** baseline 時已見但未投影至盤面的 legacy 事件，不在恢復後補播。 */
  eventFloor: number;
}

export interface AnimationDecision {
  kind: 'baseline' | 'advance' | 'ignore';
  cursor: PresentationCursor | null;
  events: GameEvent[];
}

export function decideBoardAnimation(
  cursor: PresentationCursor | null,
  snapshot: GameSnapshot | null,
  sync: GameSyncMetadata,
  rebase = false,
): AnimationDecision {
  if (!snapshot) return { kind: 'baseline', cursor: null, events: [] };
  const { gameId, revision, view } = snapshot;
  const baseline = (): AnimationDecision => ({
    kind: 'baseline',
    cursor: {
      gameId, revision, viewSeq: view.seq, syncGeneration: sync.generation, consumedSeq: view.seq,
      eventFloor: sync.cause === 'events' ? Math.max(view.seq, ...view.events.map((event) => event.seq)) : view.seq,
    },
    events: [],
  });
  if (cursor && sync.generation < cursor.syncGeneration) {
    return { kind: 'ignore', cursor, events: [] };
  }
  if (!cursor || cursor.gameId !== gameId) return baseline();
  if (revision < cursor.revision || view.seq < cursor.viewSeq) {
    return { kind: 'ignore', cursor, events: [] };
  }
  if (rebase || sync.generation !== cursor.syncGeneration ||
      ['open', 'resume', 'reconnect', 'gap'].includes(sync.cause)) return baseline();

  // 舊式事件封包可能早於 snapshot，不以其 seq 取代 revision 或權威 view.seq。
  const targetSeq = sync.cause === 'events'
    ? Math.max(view.seq, ...view.events.map((event) => event.seq))
    : view.seq;
  const next = { ...cursor, revision, viewSeq: view.seq };
  const afterSeq = Math.max(cursor.consumedSeq, cursor.eventFloor);
  if (targetSeq <= afterSeq) return { kind: 'ignore', cursor: next, events: [] };
  const bySeq = new Map<number, GameEvent>();
  for (const event of view.events) {
    if (event.seq > afterSeq && event.seq <= targetSeq && !bySeq.has(event.seq)) {
      bySeq.set(event.seq, event);
    }
  }
  const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  if (events.length !== targetSeq - afterSeq ||
      events.some((event, index) => event.seq !== afterSeq + index + 1)) return baseline();
  return { kind: 'advance', cursor: { ...next, consumedSeq: targetSeq }, events };
}

/** 同批權威事件一起演出，不延後盤面更新。 */
export interface BoardEffectGroup {
  id: string;
  events: readonly GameEvent[];
  durationMs: number;
}

export function boardEffectGroup(gameId: string, events: readonly GameEvent[]): BoardEffectGroup {
  return {
    id: `${gameId}:${events[0]!.seq}-${events.at(-1)!.seq}`,
    events,
    durationMs: MAX_EFFECT_DURATION_MS,
  };
}

/** 同一 delta 若包含多次擲骰，每次保留一組演出與其後續授權事件。 */
export function boardEffectGroups(gameId: string, events: readonly GameEvent[]): BoardEffectGroup[] {
  const groups: BoardEffectGroup[] = [];
  let batch: GameEvent[] = [];
  let hasRoll = false;
  for (const event of events) {
    if (event.type === 'turn.rolled' && hasRoll) {
      groups.push(boardEffectGroup(gameId, batch));
      batch = [];
    }
    batch.push(event);
    if (event.type === 'turn.rolled') hasRoll = true;
  }
  if (batch.length > 0) groups.push(boardEffectGroup(gameId, batch));
  return groups;
}

/** 溢出時丟棄演出；權威盤面已是最新狀態。 */
export function enqueueBoardEffects(
  queue: readonly BoardEffectGroup[],
  incoming: readonly BoardEffectGroup[],
): BoardEffectGroup[] {
  return queue.length + incoming.length > MAX_EFFECT_GROUPS ? [] : [...queue, ...incoming];
}
