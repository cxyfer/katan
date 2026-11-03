import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameSnapshot } from '@catan/protocol';
import type { GameSyncMetadata } from '../state/table.ts';
import {
  boardEffectGroups,
  decideBoardAnimation,
  diceRollPresentations,
  DICE_PRESENTATION_DURATION_MS,
  MAX_EFFECT_GROUPS,
  type DiceRollPresentation,
  enqueueBoardEffects,
  MAX_EFFECT_DURATION_MS,
  placementEffectGroups,
  type BoardEffectGroup,
  type PresentationCursor,
} from './animation.ts';

const NO_ARRIVALS: readonly BoardEffectGroup[] = [];

export function useBoardAnimation(
  snapshot: GameSnapshot | null,
  sync: GameSyncMetadata,
  online: boolean,
  mandatory: boolean,
  /** 骰子佇列（含排隊中的骰子）由空轉非空或反之時，於繪製前同步通知。 */
  onDiceChange?: (presenting: boolean) => void,
  /** 骰子佇列內容（演出 id，依序）每次更新時同步通知；音效依此跟著實際演出。 */
  onDiceQueue?: (ids: readonly string[]) => void,
  /** 棋盤停在擲骰前投影：新落下的棋子還不在盤面上，延到放行時才開始播放。 */
  holdArrivals = false,
) {
  const cursor = useRef<PresentationCursor | null>(null);
  const latest = useRef({ snapshot, sync });
  latest.current = { snapshot, sync };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mandatoryRollSeq = useRef<number | null>(null);
  const visible = useRef(!document.hidden);
  const reduced = useRef(false);
  const [queue, setQueue] = useState<BoardEffectGroup[]>([]);
  const [diceQueue, setDiceQueue] = useState<DiceRollPresentation[]>([]);
  const [arrivals, setArrivals] = useState<BoardEffectGroup[]>([]);
  const arrivalTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const deferredArrivals = useRef<BoardEffectGroup[]>([]);
  const holdArrivalsRef = useRef(holdArrivals);
  holdArrivalsRef.current = holdArrivals;
  const clearArrivals = useCallback(() => {
    arrivalTimers.current.forEach((id) => globalThis.clearTimeout(id));
    arrivalTimers.current.clear();
    deferredArrivals.current = [];
    setArrivals([]);
  }, []);
  const startArrival = useCallback((group: BoardEffectGroup) => {
    if (arrivalTimers.current.size >= MAX_EFFECT_GROUPS) return;
    const id = globalThis.setTimeout(() => {
      arrivalTimers.current.delete(id);
      setArrivals((current) => current.filter((item) => item !== group));
    }, MAX_EFFECT_DURATION_MS);
    arrivalTimers.current.add(id);
    setArrivals((current) => [...current, group]);
  }, []);
  // 以 ref 同步追蹤骰子佇列，才能在同一個 effect 內立即回報是否仍在演出。
  const diceQueueRef = useRef<DiceRollPresentation[]>([]);
  const onDiceChangeRef = useRef(onDiceChange);
  onDiceChangeRef.current = onDiceChange;
  const onDiceQueueRef = useRef(onDiceQueue);
  onDiceQueueRef.current = onDiceQueue;
  const updateDice = useCallback((next: (current: DiceRollPresentation[]) => DiceRollPresentation[]) => {
    const value = next(diceQueueRef.current);
    diceQueueRef.current = value;
    setDiceQueue(value);
    onDiceChangeRef.current?.(value.length > 0);
    onDiceQueueRef.current?.(value.map((roll) => roll.id));
  }, []);

  const resetPresentation = useCallback(() => {
    if (timer.current !== null) globalThis.clearTimeout(timer.current);
    timer.current = null;
    if (diceTimer.current !== null) globalThis.clearTimeout(diceTimer.current);
    diceTimer.current = null;
    cursor.current = decideBoardAnimation(null, latest.current.snapshot, latest.current.sync).cursor;
    setQueue([]);
    clearArrivals();
    updateDice(() => []);
    mandatoryRollSeq.current = null;
  }, [updateDice, clearArrivals]);

  useEffect(() => {
    const media = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.current = media.matches;
    visible.current = !document.hidden;
    const onVisibility = () => { visible.current = !document.hidden; resetPresentation(); };
    const onMotion = () => { reduced.current = media.matches; resetPresentation(); };
    document.addEventListener('visibilitychange', onVisibility);
    media.addEventListener('change', onMotion);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      media.removeEventListener('change', onMotion);
      if (timer.current !== null) globalThis.clearTimeout(timer.current);
      timer.current = null;
      if (diceTimer.current !== null) globalThis.clearTimeout(diceTimer.current);
      diceTimer.current = null;
      arrivalTimers.current.forEach((id) => globalThis.clearTimeout(id));
      arrivalTimers.current.clear();
      cursor.current = null;
      diceQueueRef.current = [];
      onDiceChangeRef.current?.(false);
      onDiceQueueRef.current?.([]);
    };
  }, [resetPresentation]);

  // 在繪製前決定演出，避免新投影的動作選項先閃現一幀才被擲骰演出蓋住。
  useLayoutEffect(() => {
    const decision = decideBoardAnimation(
      cursor.current, snapshot, sync, !online || !visible.current || reduced.current,
    );
    cursor.current = decision.cursor;
    if (decision.kind === 'baseline') {
      setQueue([]);
      clearArrivals();
      updateDice(() => []);
      mandatoryRollSeq.current = null;
      return;
    }
    // 建造落下自抵達起並行播放，不等特效佇列，也不因必要操作而略過；超出上限時直接靜止顯示。
    const placements = snapshot ? placementEffectGroups(snapshot.gameId, decision.events) : [];
    if (placements.length > 0) {
      const [group] = placements as [BoardEffectGroup];
      if (!holdArrivalsRef.current) startArrival(group);
      else if (deferredArrivals.current.length < MAX_EFFECT_GROUPS) deferredArrivals.current.push(group);
    }
    const rolls = snapshot ? diceRollPresentations(snapshot.gameId, decision.events) : [];
    if (mandatory) {
      setQueue([]);
      const pending = snapshot?.view.pending;
      // 擲骰事件先於投影抵達時，舊投影仍停在 preroll；這次擲骰本身就結束了 preroll，
      // 先保留骰子，等投影抵達再判斷是否讓位給必要操作（游標已消耗此事件，清掉就無法補播）。
      if (snapshot && rolls.length > 0 && !pending && !snapshot.view.turn.setup) {
        mandatoryRollSeq.current = snapshot.view.seq;
        updateDice((current) => current.length + rolls.length > MAX_EFFECT_GROUPS ? [] : [...current, ...rolls]);
        return;
      }
      const rollPending = pending?.kind === 'discard' || (pending?.kind === 'moveRobber' && pending.cause === 'seven');
      const isSeven = (roll: DiceRollPresentation) => roll.dice[0] + roll.dice[1] === 7;
      // 事件先到時七點已在佇列中，投影帶來的必要操作仍與它並存。
      const seven = rollPending ? rolls.findLast(isSeven) ?? diceQueueRef.current.findLast(isSeven) : undefined;
      // 同包七點可與必要提示並存；任何後續權威進度都讓位給必要操作，且不補播。
      if (seven && snapshot) {
        mandatoryRollSeq.current = snapshot.view.seq;
        updateDice(() => [seven]);
      } else if (mandatoryRollSeq.current !== snapshot?.view.seq) {
        mandatoryRollSeq.current = null;
        updateDice(() => []);
      } else {
        updateDice((current) => current);
      }
      return;
    }
    mandatoryRollSeq.current = null;
    if (decision.events.length > 0 && snapshot) {
      const groups = boardEffectGroups(snapshot.gameId, decision.events);
      setQueue((current) => enqueueBoardEffects(current, groups));
      if (rolls.length > 0) {
        updateDice((current) => current.length + rolls.length > MAX_EFFECT_GROUPS ? [] : [...current, ...rolls]);
        return;
      }
    }
    // 沒有新擲骰時也回報一次，校正 reducer 對這筆更新的暫定判斷。
    updateDice((current) => current);
  }, [snapshot, sync.generation, sync.cause, online, mandatory, updateDice, clearArrivals, startArrival]);

  // 盤面放行的同一次繪製前開始延後的落下，棋子不會先靜止出現一幀；重設時已清空，不補播。
  useLayoutEffect(() => {
    if (holdArrivals || deferredArrivals.current.length === 0) return;
    const groups = deferredArrivals.current;
    deferredArrivals.current = [];
    groups.forEach(startArrival);
  }, [holdArrivals, startArrival]);

  const active = queue[0] ?? null;
  const activeDice = diceQueue[0] ?? null;
  // 依事件順序串成單一時間軸：同組（或更早）的骰子先揭曉，盤面特效（資源產出等）才播放；
  // 較早的特效組播完前，後一次擲骰也先等待。
  const lastEffectSeq = active ? active.events.at(-1)!.seq : null;
  const effectHeld = activeDice !== null && lastEffectSeq !== null && activeDice.seq <= lastEffectSeq;
  const diceHeld = activeDice !== null && lastEffectSeq !== null && lastEffectSeq < activeDice.seq;
  useEffect(() => {
    if (!active || effectHeld) return;
    timer.current = globalThis.setTimeout(() => {
      timer.current = null;
      setQueue((current) => current.slice(1));
    }, active.durationMs);
    return () => {
      if (timer.current !== null) globalThis.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [active, effectHeld]);

  // 骰子與盤面特效共用事件游標及取消邊界，分開計時以免延長資源／建造特效。
  useEffect(() => {
    if (!activeDice || diceHeld) return;
    diceTimer.current = globalThis.setTimeout(() => {
      diceTimer.current = null;
      updateDice((current) => current.slice(1));
    }, DICE_PRESENTATION_DURATION_MS);
    return () => {
      if (diceTimer.current !== null) globalThis.clearTimeout(diceTimer.current);
      diceTimer.current = null;
    };
  }, [activeDice, diceHeld, updateDice]);

  const canPresent = online && visible.current && !reduced.current &&
    cursor.current?.gameId === snapshot?.gameId && cursor.current?.syncGeneration === sync.generation;
  return {
    activeDice: canPresent && !diceHeld && (!mandatory || mandatoryRollSeq.current === snapshot?.view.seq) ? activeDice : null,
    pendingDiceCount: diceQueue.length,
    active: canPresent && !mandatory && !effectHeld ? active : null,
    arrivals: canPresent ? arrivals : NO_ARRIVALS,
    pendingCount: queue.length,
    resetPresentation,
  };
}
