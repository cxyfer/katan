/**
 * 規則事件 → 音效提示的純函式對照。
 *
 * 資訊可見性（docs/SPEC.md §8.3）：音效只依公開參數與「觀看者是否為當事人」決定，
 * 不讀偷竊卡種、購得的發展卡等只有當事人收到的參數，所以同一事件對旁觀者永遠
 * 發出同一個聲音，無法從聲音反推私人資訊。
 *
 * 時間軸跟著盤面實際的骰子演出走（audio/rolls.ts）：擲骰的後果（產出、強盜等）
 * 等那次骰子揭曉才響，不在點數揭曉前透露結果。
 */

import type { GameEvent } from '@catan/protocol';
import { boardEffectGroups } from '../board/animation.ts';
import { TB_SOUND_CUES, tbCueForEvent } from './tb-cues.ts';

export const SOUND_CUES = [
  'dice.roll',
  'dice.land',
  'production.self',
  'production.other',
  'build.road',
  'build.settlement',
  'build.city',
  'dev.buy',
  'dev.knight',
  'dev.monopoly',
  'dev.yearOfPlenty',
  'dev.roadBuilding',
  'robber.alert',
  'robber.move',
  'robber.steal',
  'robber.stolenFromYou',
  'discard',
  'trade.offer',
  'trade.complete',
  'trade.bank',
  'trade.cancel',
  'turn.yours',
  'turn.other',
  'game.victory',
  'game.over',
  'ui.select',
  'ui.error',
  'chat.message',
  ...TB_SOUND_CUES,
] as const;

export type SoundCue = (typeof SOUND_CUES)[number];

export interface ScheduledCue {
  cue: SoundCue;
  /** 相對於這批事件抵達時的延遲。 */
  delayMs: number;
}

/** 每組事件最多發出的提示數（不含骰子聲）；大批事件只保留重要的幾個，不連發一長串。 */
export const MAX_CUES_PER_BATCH = 3;

function playerId(event: GameEvent, key = 'playerId'): string | null {
  const value = event.params?.[key];
  return typeof value === 'string' ? value : null;
}

/** 本人在這次產出中確實拿到資源（產出明細是公開資訊）。 */
function selfProduced(event: GameEvent, selfId: string | null): boolean {
  if (!selfId) return false;
  const grants = event.params?.grants;
  if (!grants || typeof grants !== 'object' || Array.isArray(grants)) return false;
  const own = (grants as Record<string, unknown>)[selfId];
  if (!own || typeof own !== 'object') return false;
  return Object.values(own as Record<string, unknown>).some((amount) => typeof amount === 'number' && amount > 0);
}

/** 單一事件對應的提示；不需要聲音的事件回傳 null。 */
export function cueForEvent(event: GameEvent, selfId: string | null): SoundCue | null {
  const actor = playerId(event);
  const mine = selfId !== null && actor === selfId;
  switch (event.type) {
    case 'setup.building':
    case 'build.settlement':
      return 'build.settlement';
    case 'setup.road':
    case 'build.road':
      return 'build.road';
    case 'build.city':
      return 'build.city';
    case 'build.devCard':
      return 'dev.buy';
    case 'turn.started':
      // 自己的回合由「輪到你」提示負責（useGameSounds 的 attentionCue），這裡不重複。
      return mine ? null : 'turn.other';
    case 'production.resolved':
      return selfProduced(event, selfId) ? 'production.self' : 'production.other';
    case 'discard.required':
    case 'robber.moveRequired':
      return 'robber.alert';
    case 'discard.submitted':
      return 'discard';
    case 'robber.moved':
      return 'robber.move';
    case 'robber.stole':
      return selfId !== null && playerId(event, 'victim') === selfId ? 'robber.stolenFromYou' : 'robber.steal';
    case 'dev.knight':
      return 'dev.knight';
    case 'dev.monopoly':
      return 'dev.monopoly';
    case 'dev.yearOfPlenty':
      return 'dev.yearOfPlenty';
    case 'dev.roadBuilding':
      return 'dev.roadBuilding';
    case 'trade.offered': {
      const from = playerId(event, 'from');
      const to = event.params?.to;
      // 只有被詢價的玩家需要提醒；發起者已從自己的操作得到回饋。
      if (from === selfId) return null;
      return to === 'all' || to === selfId ? 'trade.offer' : null;
    }
    case 'trade.completed':
      return 'trade.complete';
    case 'trade.bank':
      return 'trade.bank';
    case 'trade.withdrawn':
    case 'trade.expired':
      return 'trade.cancel';
    case 'game.finished':
      return mine ? 'game.victory' : 'game.over';
    case 'game.abandoned':
      return 'game.over';
    default:
      return tbCueForEvent(event);
  }
}

/** 同時響起時保留較重要的提示；數字越大越優先。 */
const PRIORITY: Partial<Record<SoundCue, number>> = {
  'game.victory': 9,
  'game.over': 9,
  'robber.stolenFromYou': 7,
  'robber.alert': 6,
  'turn.yours': 5,
  'production.self': 4,
};

/** 同一時段的多個提示依事件順序錯開，聽得出「騎士 → 移動強盜 → 偷牌」的先後。 */
export const CUE_STAGGER_MS = 320;

/**
 * 需要把玩家叫回來的提示：輪到自己、有人向自己詢價。分頁隱藏時仍會響，
 * 擲骰演出被盤面丟棄時也不會跟著被取消。
 */
export const BACKGROUND_CUES: ReadonlySet<SoundCue> = new Set(['turn.yours', 'trade.offer']);

function pick(slot: readonly SoundCue[], limit: number): SoundCue[] {
  if (slot.length <= limit) return [...slot];
  const kept = new Set([...slot].sort((a, b) => (PRIORITY[b] ?? 0) - (PRIORITY[a] ?? 0)).slice(0, limit));
  return slot.filter((cue) => kept.has(cue));
}

export interface CueGroup {
  /** 這組的擲骰事件序號；沒有擲骰時為 null。 */
  rollSeq: number | null;
  /** 擲骰前（或沒有擲骰時）的提示，抵達時立即播放。 */
  before: SoundCue[];
  /** 擲骰的後果（產出、強盜等），跟著盤面骰子演出在點數揭曉後才播放。 */
  after: SoundCue[];
}

/**
 * 把一批新事件依盤面的方式（boardEffectGroups）在每次擲骰處切組，轉成提示。
 * 每組重複的提示只留一次，最多 MAX_CUES_PER_BATCH 個（依優先度挑選、依事件順序）。
 * 骰子聲本身（dice.roll／dice.land）由 RollSoundCoordinator 依實際演出播放。
 */
export function cueGroups(events: readonly GameEvent[], selfId: string | null): CueGroup[] {
  if (events.length === 0) return [];
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  return boardEffectGroups('', ordered).map(({ events: group }) => {
    const before: SoundCue[] = [];
    const after: SoundCue[] = [];
    let rollSeq: number | null = null;
    for (const event of group) {
      if (event.type === 'turn.rolled' && rollSeq === null) {
        rollSeq = event.seq;
        continue;
      }
      const cue = cueForEvent(event, selfId);
      const slot = rollSeq === null ? before : after;
      if (cue && !slot.includes(cue)) slot.push(cue);
    }
    if (rollSeq === null) return { rollSeq, before: pick(before, MAX_CUES_PER_BATCH), after: [] };
    const early = pick(before, 1);
    return { rollSeq, before: early, after: pick(after, MAX_CUES_PER_BATCH - early.length) };
  });
}

/** 依序錯開的提示。 */
export function stagger(cues: readonly SoundCue[], startMs = 0): ScheduledCue[] {
  return cues.map((cue, index) => ({ cue, delayMs: startMs + index * CUE_STAGGER_MS }));
}
