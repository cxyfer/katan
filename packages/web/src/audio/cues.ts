/**
 * 規則事件 → 音效提示的純函式對照。
 *
 * 資訊可見性（docs/SPEC.md §8.3）：音效只依公開參數與「觀看者是否為當事人」決定，
 * 不讀偷竊卡種、購得的發展卡等只有當事人收到的參數，所以同一事件對旁觀者永遠
 * 發出同一個聲音，無法從聲音反推私人資訊。
 *
 * 時間軸與盤面演出一致（board/animation.ts）：擲骰聲立即開始、點數揭曉時落定，
 * 同批中擲骰之後的事件（產出、強盜等）等骰子演出結束才響，不在點數揭曉前透露結果。
 */

import type { GameEvent } from '@catan/protocol';
import {
  boardEffectGroups,
  DICE_PRESENTATION_DURATION_MS,
  DICE_ROLL_DURATION_MS,
  MAX_EFFECT_DURATION_MS,
  MAX_EFFECT_GROUPS,
} from '../board/animation.ts';

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
] as const;

export type SoundCue = (typeof SOUND_CUES)[number];

export interface ScheduledCue {
  cue: SoundCue;
  /** 相對於這批事件抵達時的延遲。 */
  delayMs: number;
}

/** 一批事件最多發出的提示數（不含骰子聲）；大批事件只保留重要的幾個，不連發一長串。 */
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
      return null;
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
 * 把一批新事件轉成排程的提示。擲骰聲在 0 ms 開始、點數揭曉時落定，
 * 之後的事件延到骰子演出結束。每個時段內重複的提示只留一次，最多留
 * MAX_CUES_PER_BATCH 個（依優先度挑選、依事件順序播放）。
 *
 * `presented` 為 false（減少動態、背景分頁）時盤面直接顯示結果：不播搖骰，
 * 落定聲立即響起，後續事件緊接著錯開播放。
 */
export function cuesForEvents(events: readonly GameEvent[], selfId: string | null, presented = true): ScheduledCue[] {
  const before: SoundCue[] = [];
  const after: SoundCue[] = [];
  let rolled = false;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type === 'turn.rolled') {
      rolled = true;
      continue;
    }
    const cue = cueForEvent(event, selfId);
    const slot = rolled ? after : before;
    if (cue && !slot.includes(cue)) slot.push(cue);
  }
  const pick = (slot: readonly SoundCue[], limit: number): SoundCue[] => {
    if (slot.length <= limit) return [...slot];
    const kept = new Set([...slot].sort((a, b) => (PRIORITY[b] ?? 0) - (PRIORITY[a] ?? 0)).slice(0, limit));
    return slot.filter((cue) => kept.has(cue));
  };
  const stagger = (slot: readonly SoundCue[], start: number): ScheduledCue[] =>
    slot.map((cue, index) => ({ cue, delayMs: start + index * CUE_STAGGER_MS }));

  if (!rolled) return stagger(pick(before, MAX_CUES_PER_BATCH), 0);
  // 骰子聲固定對齊骰子演出；擲骰前與擲骰後的事件各自分配剩餘名額。
  const early = pick(before, 1);
  if (!presented) {
    return [
      ...stagger(early, 0),
      { cue: 'dice.land' as const, delayMs: early.length * CUE_STAGGER_MS },
      ...stagger(pick(after, MAX_CUES_PER_BATCH - early.length), (early.length + 1) * CUE_STAGGER_MS),
    ];
  }
  return [
    ...stagger(early, 0),
    { cue: 'dice.roll' as const, delayMs: 0 },
    { cue: 'dice.land' as const, delayMs: DICE_ROLL_DURATION_MS },
    ...stagger(pick(after, MAX_CUES_PER_BATCH - early.length), DICE_PRESENTATION_DURATION_MS),
  ].sort((a, b) => a.delayMs - b.delayMs);
}

/**
 * 盤面把演出串成單一時間軸（board/useBoardAnimation.ts）：每批事件在每次擲骰處切成
 * 特效組（boardEffectGroups），每組播 MAX_EFFECT_DURATION_MS，含擲骰的組先播完骰子
 * 演出，下一組要等前一組結束。盤面處於必要操作模式（`effectsShown` 為 false：
 * 有待處理、開局擺放或擲骰前）時不播特效組，只剩骰子演出佔用時間軸。
 */
export function presentationLength(events: readonly GameEvent[], effectsShown = true): number {
  const dice = events.some((event) => event.type === 'turn.rolled') ? DICE_PRESENTATION_DURATION_MS : 0;
  return dice + (effectsShown ? MAX_EFFECT_DURATION_MS : 0);
}

export interface CueTimeline {
  /** 盤面佇列中每個演出組預計結束的時間（毫秒時鐘）。 */
  ends: readonly number[];
}

export const IDLE_TIMELINE: CueTimeline = Object.freeze({ ends: [] });

export interface ScheduleMode {
  /** 盤面會演出這批事件（未要求減少動態、分頁可見）。 */
  presented: boolean;
  /** 盤面不在必要操作模式，會播特效組。 */
  effectsShown: boolean;
}

/**
 * 把一批新事件排上與盤面一致的時間軸。批次在每次擲骰處切組，各組依序從
 * 「前一組結束」開始，所以佇列中的第二、第三次擲骰的落定聲與七點警示，
 * 都等到它們自己的骰子揭曉時才響，不會比畫面先透露點數。
 *
 * 盤面不演出（減少動態、背景分頁），或排隊組數超過盤面上限而被整批丟棄
 * （enqueueBoardEffects）時，畫面直接顯示結果，聲音也立即播放、不搖骰。
 * 畫面因此較快時，聲音只會較晚，不會較早。
 */
export function scheduleCues(
  timeline: CueTimeline,
  events: readonly GameEvent[],
  selfId: string | null,
  now: number,
  mode: ScheduleMode,
): { timeline: CueTimeline; cues: ScheduledCue[]; dropped: boolean } {
  if (events.length === 0) return { timeline, cues: [], dropped: false };
  const groups = boardEffectGroups('', events).map((group) => group.events);
  const queued = timeline.ends.filter((end) => end > now);
  const occupying = groups.filter((group) => presentationLength(group, mode.effectsShown) > 0);
  if (!mode.presented || queued.length + occupying.length > MAX_EFFECT_GROUPS) {
    // 盤面此時丟掉排隊中的演出；`dropped` 通知呼叫端一併取消已排程的提示。
    return { timeline: IDLE_TIMELINE, cues: cuesForEvents(events, selfId, false), dropped: queued.length > 0 };
  }
  const ends = [...queued];
  const cues: ScheduledCue[] = [];
  for (const group of groups) {
    const start = Math.max(now, ends.at(-1) ?? now);
    for (const entry of cuesForEvents(group, selfId, true)) cues.push({ ...entry, delayMs: entry.delayMs + start - now });
    const length = presentationLength(group, mode.effectsShown);
    if (length > 0) ends.push(start + length);
  }
  return { timeline: { ends }, cues, dropped: false };
}
