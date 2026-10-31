import { useEffect, useRef } from 'react';
import type { GameEvent } from '@catan/protocol';
import { requiredActionFor, type RequiredAction } from '../state/pending.ts';
import type { TableState } from '../state/table.ts';
import { IDLE_TIMELINE, scheduleCues, type CueTimeline, type SoundCue } from './cues.ts';

export interface EventCursor {
  gameId: string;
  /** 同步世代；開局、恢復、重連、缺號補抓都會換代，換代後只建立基準不補播。 */
  generation: number;
  seq: number;
}

/**
 * 找出上次之後新抵達的權威事件。事件封包與投影可能先後到達，
 * 以序號為準，所以同一事件不會因為之後的投影而再響一次。
 */
export function advanceEventCursor(cursor: EventCursor | null, state: TableState): { cursor: EventCursor | null; events: GameEvent[] } {
  const game = state.game;
  if (!game) return { cursor: null, events: [] };
  if (state.gameSyncPending) return { cursor, events: [] };
  const seq = Math.max(game.view.seq, ...game.view.events.map((event) => event.seq));
  const generation = state.gameSync.generation;
  if (!cursor || cursor.gameId !== game.gameId || cursor.generation !== generation) {
    return { cursor: { gameId: game.gameId, generation, seq }, events: [] };
  }
  const events = game.view.events.filter((event) => event.seq > cursor.seq);
  return { cursor: { ...cursor, seq: Math.max(cursor.seq, seq) }, events };
}

/** 擲骰演出與等待投影只是過渡，不算「輪到誰」的改變。 */
const TRANSIENT: ReadonlySet<RequiredAction['kind']> = new Set(['rolling', 'syncing']);

/**
 * 「輪到你」提示：義務從別人（或沒有）轉到自己時響一次，包含開局擺放、擲骰、
 * 移動強盜。自己的整個回合都算「自己的」，所以擲出七點後等別人棄牌、再輪到自己
 * 移動強盜時不會再響。棄牌由同時響起的七點警示（robber.alert）提醒，不再疊加。
 */
export function attentionCue(
  previous: boolean | null,
  action: Pick<RequiredAction, 'kind' | 'mine'> | null,
  myTurn = false,
): { mine: boolean | null; cue: SoundCue | null } {
  if (action && TRANSIENT.has(action.kind)) return { mine: previous, cue: null };
  const mine = myTurn || (action?.mine ?? false);
  return { mine, cue: previous === false && mine && action?.kind !== 'discard' ? 'turn.yours' : null };
}

/** 使用者要求減少動態時盤面不播骰子演出，聲音也不必等它。 */
function reducedMotion(): boolean {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface GameSoundOutput {
  play(cue: SoundCue, delayMs?: number): void;
  /** 盤面丟棄排隊中的演出時，取消已排程但尚未響起的提示。 */
  cancelPending(): void;
}

/** 依桌面狀態變化發出音效。只在 App 掛載一次，跨大廳、牌桌與結算畫面持續追蹤。 */
export function useGameSounds(state: TableState, { play, cancelPending }: GameSoundOutput): void {
  const latest = useRef(state);
  latest.current = state;
  const cursor = useRef<EventCursor | null>(null);
  const timeline = useRef<CueTimeline>(IDLE_TIMELINE);
  const mine = useRef<boolean | null>(null);
  const rejected = useRef<string | null>(null);
  const stale = useRef<string | null>(null);
  const unread = useRef(state.chat.unread);
  const selfId = state.session?.id ?? null;

  const { game, gameSyncPending } = state;
  const generation = state.gameSync.generation;
  useEffect(() => {
    const previous = cursor.current;
    const next = advanceEventCursor(previous, latest.current);
    cursor.current = next.cursor;
    // 換代時盤面丟掉排隊中的演出重新建立基準：音效時間軸清空，已排程的提示也取消。
    // （分頁隱藏由引擎自己處理。）
    if (!next.cursor || previous?.gameId !== next.cursor.gameId || previous.generation !== next.cursor.generation) {
      if (timeline.current.ends.length > 0) cancelPending();
      timeline.current = IDLE_TIMELINE;
    } else if (document.hidden) {
      timeline.current = IDLE_TIMELINE;
    }
    if (next.events.length === 0) return;
    // 分頁隱藏時盤面不演出；提示仍交給引擎，由它決定哪些值得在背景響起。
    // effectsShown 與 BoardView 傳給 useBoardAnimation 的 mandatory 判斷相反。
    const view = latest.current.game?.view;
    const scheduled = scheduleCues(timeline.current, next.events, selfId, Date.now(), {
      presented: !document.hidden && !reducedMotion(),
      effectsShown: !view?.pending && !view?.turn.setup && view?.turn.phase !== 'preroll',
    });
    timeline.current = scheduled.timeline;
    if (scheduled.dropped) cancelPending();
    for (const { cue, delayMs } of scheduled.cues) play(cue, delayMs);
  }, [game, generation, gameSyncPending, selfId, play, cancelPending]);

  const action = requiredActionFor(state);
  const actionKind = action?.kind ?? null;
  const actionMine = action?.mine ?? false;
  const gameId = game?.gameId ?? null;
  const myTurn = !!game && !game.view.result && selfId !== null && game.view.turn.playerId === selfId;
  useEffect(() => {
    if (!gameId) {
      mine.current = null;
      return;
    }
    const next = attentionCue(mine.current, actionKind ? { kind: actionKind, mine: actionMine } : null, myTurn);
    mine.current = next.mine;
    if (next.cue) play(next.cue);
  }, [gameId, actionKind, actionMine, myTurn, play]);

  const commandStatus = state.command?.status ?? null;
  const commandId = state.command?.commandId ?? null;
  useEffect(() => {
    if (!commandId) return;
    if (commandStatus === 'stale') {
      stale.current = commandId;
      return;
    }
    if (commandStatus !== 'rejected' || rejected.current === commandId) return;
    rejected.current = commandId;
    // 版本過時（畫面落後，不是操作錯誤）的指令在重新整理後才轉為 rejected，不發錯誤音。
    if (stale.current !== commandId) play('ui.error');
  }, [commandStatus, commandId, play]);

  const { kind: selectionKind, index: selectionIndex } = state.selection;
  useEffect(() => {
    if (selectionKind !== null && selectionIndex !== null) play('ui.select');
  }, [selectionKind, selectionIndex, play]);

  // 未讀數只在聊天面板關閉時、收到他人的即時訊息才增加；載入歷史訊息不會響。
  const { unread: unreadCount, server, muted } = state.chat;
  useEffect(() => {
    const increased = unreadCount > unread.current;
    unread.current = unreadCount;
    const newest = server.at(-1);
    if (increased && newest && newest.kind === 'player' && !muted.includes(newest.playerId)) play('chat.message');
  }, [unreadCount, server, muted, play]);
}
