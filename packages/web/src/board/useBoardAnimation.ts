import { useCallback, useEffect, useRef, useState } from 'react';
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
  type BoardEffectGroup,
  type PresentationCursor,
} from './animation.ts';

export function useBoardAnimation(
  snapshot: GameSnapshot | null,
  sync: GameSyncMetadata,
  online: boolean,
  mandatory: boolean,
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

  const resetPresentation = useCallback(() => {
    if (timer.current !== null) globalThis.clearTimeout(timer.current);
    timer.current = null;
    if (diceTimer.current !== null) globalThis.clearTimeout(diceTimer.current);
    diceTimer.current = null;
    cursor.current = decideBoardAnimation(null, latest.current.snapshot, latest.current.sync).cursor;
    setQueue([]);
    setDiceQueue([]);
    mandatoryRollSeq.current = null;
  }, []);

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
      cursor.current = null;
    };
  }, [resetPresentation]);

  useEffect(() => {
    const decision = decideBoardAnimation(
      cursor.current, snapshot, sync, !online || !visible.current || reduced.current,
    );
    cursor.current = decision.cursor;
    if (decision.kind === 'baseline') {
      setQueue([]);
      setDiceQueue([]);
      mandatoryRollSeq.current = null;
      return;
    }
    const rolls = snapshot ? diceRollPresentations(snapshot.gameId, decision.events) : [];
    if (mandatory) {
      setQueue([]);
      const pending = snapshot?.view.pending;
      const rollPending = pending?.kind === 'discard' || (pending?.kind === 'moveRobber' && pending.cause === 'seven');
      const seven = rollPending ? rolls.findLast((roll) => roll.dice[0] + roll.dice[1] === 7) : undefined;
      // 同包七點可與必要提示並存；任何後續權威進度都讓位給必要操作，且不補播。
      if (seven && snapshot) {
        mandatoryRollSeq.current = snapshot.view.seq;
        setDiceQueue([seven]);
      } else if (mandatoryRollSeq.current !== snapshot?.view.seq) {
        mandatoryRollSeq.current = null;
        setDiceQueue([]);
      }
      return;
    }
    mandatoryRollSeq.current = null;
    if (decision.events.length > 0 && snapshot) {
      const groups = boardEffectGroups(snapshot.gameId, decision.events);
      setQueue((current) => enqueueBoardEffects(current, groups));
      if (rolls.length > 0) {
        setDiceQueue((current) => current.length + rolls.length > MAX_EFFECT_GROUPS ? [] : [...current, ...rolls]);
      }
    }
  }, [snapshot, sync.generation, sync.cause, online, mandatory]);

  const active = queue[0] ?? null;
  useEffect(() => {
    if (!active) return;
    timer.current = globalThis.setTimeout(() => {
      timer.current = null;
      setQueue((current) => current.slice(1));
    }, active.durationMs);
    return () => {
      if (timer.current !== null) globalThis.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [active]);

  // 骰子與盤面特效共用事件游標及取消邊界，分開計時以免延長資源／建造特效。
  const activeDice = diceQueue[0] ?? null;
  useEffect(() => {
    if (!activeDice) return;
    diceTimer.current = globalThis.setTimeout(() => {
      diceTimer.current = null;
      setDiceQueue((current) => current.slice(1));
    }, DICE_PRESENTATION_DURATION_MS);
    return () => {
      if (diceTimer.current !== null) globalThis.clearTimeout(diceTimer.current);
      diceTimer.current = null;
    };
  }, [activeDice]);

  const canPresent = online && visible.current && !reduced.current &&
    cursor.current?.gameId === snapshot?.gameId && cursor.current?.syncGeneration === sync.generation;
  return {
    activeDice: canPresent && (!mandatory || mandatoryRollSeq.current === snapshot?.view.seq) ? activeDice : null,
    pendingDiceCount: diceQueue.length,
    active: canPresent && !mandatory ? active : null,
    pendingCount: queue.length,
    resetPresentation,
  };
}
