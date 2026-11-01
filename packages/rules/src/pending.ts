/**
 * Pending queue: the ordered mandatory choices that block normal play.
 *
 * `state.pending` is the active frame; `state.pendingQueue` holds the frames
 * behind it. One roll (or card) may enqueue several frames with explicit
 * responders, and each resolves completely before the next one becomes
 * active. The base game never has more than one frame at a time, so its
 * snapshots carry no `pendingQueue` field at all.
 */

import type { GameState, PendingFrame } from './types.ts';

/** Frames waiting behind the active one; snapshots without a queue read as empty. */
export function pendingQueueOf(state: Pick<GameState, 'pendingQueue'>): readonly PendingFrame[] {
  return state.pendingQueue ?? [];
}

/** The active frame followed by every queued frame, in resolution order. */
export function pendingFrames(state: Pick<GameState, 'pending' | 'pendingQueue'>): PendingFrame[] {
  return state.pending ? [state.pending, ...pendingQueueOf(state)] : [];
}

/** Players who still have to answer a frame. */
export function pendingResponders(frame: PendingFrame): string[] {
  switch (frame.kind) {
    case 'discard':
      return Object.keys(frame.required).filter((id) => !frame.submitted[id]);
    case 'moveRobber':
    case 'steal':
    case 'yearOfPlenty':
    case 'freeRoads':
      return [frame.actor];
    default:
      return frame.responders.slice();
  }
}

/**
 * Appends frames in order. The first one becomes active when nothing is
 * pending; the rest wait in the queue.
 */
export function enqueuePending(state: GameState, ...frames: PendingFrame[]): void {
  const queue = [...pendingQueueOf(state)];
  for (const frame of frames) {
    if (!state.pending) state.pending = frame;
    else queue.push(frame);
  }
  setQueue(state, queue);
}

/**
 * Finishes the active frame and activates the next queued one, if any.
 * Returns the newly active frame.
 */
export function advancePending(state: GameState): PendingFrame | null {
  const queue = [...pendingQueueOf(state)];
  state.pending = queue.shift() ?? null;
  setQueue(state, queue);
  return state.pending;
}

/** Drops every pending frame (new action window, game over, abandonment). */
export function clearPending(state: GameState): void {
  state.pending = null;
  delete state.pendingQueue;
}

/**
 * Reads an older snapshot's pending fields into the current shape. A queue
 * without an active head is promoted so the invariant `queue ⇒ head` holds.
 */
export function normalizePending(state: GameState): void {
  if (state.pending === undefined) state.pending = null;
  if (!state.pending && state.pendingQueue?.length) {
    advancePending(state);
    return;
  }
  setQueue(state, [...pendingQueueOf(state)]);
}

function setQueue(state: GameState, queue: PendingFrame[]): void {
  if (queue.length) state.pendingQueue = queue;
  else delete state.pendingQueue;
}
