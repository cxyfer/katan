import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameSnapshot } from '@catan/protocol';
import { RESOURCES, type Resource } from '@catan/rules';
import { decideBoardAnimation, type PresentationCursor } from '../board/animation.ts';
import type { GameSyncMetadata } from '../state/table.ts';

export const MAX_HAND_GAIN_CARDS = 12;
export const HAND_GAIN_DURATION_MS = 760;
const MAX_BURST_CARDS = 8;

export interface HandGain {
  id: string;
  resource: Resource;
  delayMs: number;
  expiresAt: number;
  /** 擲骰演出期間建立的卡先保留不播放，演出結束才開始落下並計時。 */
  held: boolean;
}

interface HandCursor {
  playerId: string;
  presentation: PresentationCursor;
  resources: Record<Resource, number>;
}

/** 只比較已投影到本人手牌的快照；legacy events 本身不代表手牌已更新。 */
export function useHandGains(
  snapshot: GameSnapshot | null,
  sync: GameSyncMetadata,
  playerId: string | null,
  online: boolean,
  syncPending = false,
  /** 擲骰演出進行中（含排隊中的骰子）。 */
  held = false,
) {
  const heldRef = useRef(held);
  heldRef.current = held;
  const cursor = useRef<HandCursor | null>(null);
  const latest = useRef({ snapshot, sync, playerId });
  latest.current = { snapshot, sync, playerId };
  const reduced = useRef(false);
  const [gains, setGains] = useState<HandGain[]>([]);

  const baseline = useCallback(() => {
    const { snapshot: current, sync: currentSync, playerId: currentId } = latest.current;
    const resources = current?.view.players.find((player) => player.id === currentId)?.resources;
    const presentation = decideBoardAnimation(null, current, currentSync).cursor;
    cursor.current = currentId && resources && presentation
      ? { playerId: currentId, resources: { ...resources }, presentation }
      : null;
    setGains([]);
  }, []);

  useEffect(() => {
    const media = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.current = media.matches;
    const onMotion = () => { reduced.current = media.matches; baseline(); };
    const onVisibility = () => baseline();
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', baseline);
    window.addEventListener('resize', baseline);
    media.addEventListener('change', onMotion);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', baseline);
      window.removeEventListener('resize', baseline);
      media.removeEventListener('change', onMotion);
      cursor.current = null;
    };
  }, [baseline]);

  useEffect(() => {
    const resources = snapshot?.view.players.find((player) => player.id === playerId)?.resources;
    if (!snapshot || !playerId || !resources || !online || syncPending || document.hidden || reduced.current) {
      baseline();
      return;
    }
    const previous = cursor.current?.playerId === playerId ? cursor.current : null;
    // 事件封包可先於權威投影抵達；不在此消耗其 seq，以免吞掉稍後的資源增量。
    if (sync.cause === 'events' && previous?.presentation.gameId === snapshot.gameId &&
        previous.presentation.syncGeneration === sync.generation) return;
    const decision = decideBoardAnimation(previous?.presentation ?? null, snapshot, sync);
    if (decision.kind === 'ignore') {
      // 已取消的 legacy 事件追上投影時也更新數量，避免下次把舊增量一起算入。
      if (previous && decision.cursor && snapshot.revision >= previous.presentation.revision &&
          snapshot.view.seq >= previous.presentation.viewSeq) {
        cursor.current = { playerId, resources: { ...resources }, presentation: decision.cursor };
      }
      return;
    }
    cursor.current = decision.cursor ? { playerId, resources: { ...resources }, presentation: decision.cursor } : null;
    // 投影跨過尚未投影的取消事件時，無法把資源淨增量精確分配給新舊事件。
    const catchingSuppressedEvents = previous && previous.presentation.viewSeq < previous.presentation.eventFloor;
    if (decision.kind === 'baseline' || !previous || catchingSuppressedEvents) {
      setGains([]);
      return;
    }
    const remaining = RESOURCES.map((resource) => Math.max(0, resources[resource] - previous.resources[resource]));
    // 擲骰產出的資源等骰子演出（含排隊中的骰子）結束才落入手牌，避免點數揭曉前先透露結果。
    const waiting = heldRef.current;
    const incoming: HandGain[] = [];
    // 大量獲取仍呈現各種資源，並限制裝飾性卡片數量。
    while (incoming.length < MAX_BURST_CARDS && remaining.some((count) => count > 0)) {
      for (const [index, resource] of RESOURCES.entries()) {
        if (remaining[index]! <= 0 || incoming.length === MAX_BURST_CARDS) continue;
        remaining[index] = remaining[index]! - 1;
        const delayMs = incoming.length * 45;
        incoming.push({
          id: `${snapshot.gameId}:${playerId}:${snapshot.view.seq}:${incoming.length}`,
          resource, delayMs, held: waiting,
          expiresAt: waiting ? Number.POSITIVE_INFINITY : Date.now() + HAND_GAIN_DURATION_MS + delayMs + 60,
        });
      }
    }
    if (incoming.length) {
      // 同批一起清理，最晚一張落定後只留短暫緩衝。
      const expiresAt = incoming.at(-1)!.expiresAt;
      setGains((current) => [...current, ...incoming.map((gain) => ({ ...gain, expiresAt }))].slice(-MAX_HAND_GAIN_CARDS));
    }
  }, [snapshot, sync.generation, sync.cause, playerId, online, syncPending, baseline]);

  useEffect(() => {
    if (held || !gains.some((gain) => gain.held)) return;
    // 演出結束：保留中的卡從現在開始落下，同批一起清理。
    setGains((current) => {
      const waiting = current.filter((gain) => gain.held);
      if (!waiting.length) return current;
      const expiresAt = Date.now() + HAND_GAIN_DURATION_MS + Math.max(...waiting.map((gain) => gain.delayMs)) + 60;
      return current.map((gain) => gain.held ? { ...gain, held: false, expiresAt } : gain);
    });
  }, [held, gains]);

  useEffect(() => {
    const playing = gains.filter((gain) => !gain.held);
    if (!playing.length) return;
    const deadline = Math.min(...playing.map((gain) => gain.expiresAt));
    const timer = globalThis.setTimeout(() => {
      setGains((current) => current.filter((gain) => gain.held || gain.expiresAt > Date.now()));
    }, Math.max(0, deadline - Date.now()));
    return () => globalThis.clearTimeout(timer);
  }, [gains]);

  const canPresent = online && !syncPending && !document.hidden && !reduced.current &&
    cursor.current?.playerId === playerId && cursor.current.presentation.gameId === snapshot?.gameId &&
    cursor.current.presentation.syncGeneration === sync.generation;
  const playing = useMemo(() => gains.filter((gain) => !gain.held), [gains]);
  return canPresent ? playing : [];
}
