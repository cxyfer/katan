/**
 * Cities & Knights progress-card sounds: which event plays which cue. The
 * card cues' procedural recipes live with the others in `synth.ts`.
 */

import type { GameEvent } from '@catan/protocol';
import type { SoundCue } from './cues.ts';

export const PROGRESS_CUES = ['progress.play', 'progress.alchemy', 'progress.merchant', 'progress.request'] as const;
export type ProgressCue = (typeof PROGRESS_CUES)[number];

function param(event: GameEvent, key: string): unknown {
  return event.params?.[key];
}

/** Whether `selfId` is named in a per-player map or list of the event. */
function names(value: unknown, selfId: string | null): boolean {
  if (!selfId || !value) return false;
  if (Array.isArray(value)) return value.includes(selfId);
  return typeof value === 'object' && selfId in (value as Record<string, unknown>);
}

/**
 * The cue of a progress-card event, `undefined` when the event is not one of
 * them (so the caller falls through), or `null` for silence.
 */
export function progressCueForEvent(event: GameEvent, selfId: string | null): SoundCue | null | undefined {
  const actor = param(event, 'playerId');
  const victim = param(event, 'victim');
  switch (event.type) {
    case 'ck.progressPlayed':
      return 'progress.play';
    case 'ck.alchemySet':
      return 'progress.alchemy';
    case 'ck.merchantPlaced':
      return 'progress.merchant';
    case 'ck.harborOffered':
      return selfId !== null && param(event, 'to') === selfId ? 'progress.request' : null;
    case 'ck.sabotageRequired':
    case 'ck.weddingRequired':
      return names(param(event, 'required'), selfId) ? 'progress.request' : null;
    case 'ck.treasonChosen':
      return selfId !== null && victim === selfId ? 'progress.request' : null;
    case 'ck.harborExchanged':
      return 'trade.complete';
    case 'ck.monopolyTaken':
      return 'dev.monopoly';
    case 'ck.freeRoads':
      return 'dev.roadBuilding';
    case 'ck.diplomacyRoadBuilt':
      return 'build.road';
    case 'ck.medicineCity':
      return 'build.city';
    case 'ck.harvest':
      return selfId !== null && actor === selfId ? 'production.self' : 'production.other';
    case 'ck.taxationMoved':
      return 'robber.move';
    case 'ck.taxationStole':
    case 'ck.guildDuesTaken':
    case 'ck.espionageTaken':
      return selfId !== null && victim === selfId ? 'robber.stolenFromYou' : 'robber.steal';
    case 'ck.sabotageDiscarded':
      return 'discard';
    case 'ck.knightsEncouraged':
    case 'ck.knightIntrigued':
    case 'ck.treasonPlaced':
    case 'ck.treasonRemoved':
      return 'knight.act';
    default:
      return undefined;
  }
}
