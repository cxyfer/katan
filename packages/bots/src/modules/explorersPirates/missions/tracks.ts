/**
 * 魚與香料軌道的共用計算（計畫 §4.6；E4b 由 fish.ts 抽出）：軌道是否還有路可走、再交付一份的邊際分，
 * 以及還缺 crew 的香料農場。
 */

import { EP_TRACK_BONUS, EP_TRACK_VALUES } from '@katan/rules';
import type { EpView } from '../view.ts';

export type TrackMission = 'fish' | 'spices';
type Track = { positions: Record<string, number>; leader: string | null };

/** 沒有立即加分的一份貨也有的進度價值。 */
const PROGRESS_VALUE = 0.35;

const trackOf = (ep: EpView, mission: TrackMission): Track | undefined => (ep.tracks as Partial<Record<TrackMission, Track>>)[mission];

/** 自己在這條軌道上還有路可走。 */
export function trackOpen(ep: EpView, me: string, mission: TrackMission): boolean {
  const track = trackOf(ep, mission);
  return !!track && (track.positions[me] ?? 0) < EP_TRACK_VALUES[mission].length;
}

/** 再交付一份貨的價值（勝利分當量）：下一次加分 ÷ 還要幾份，領先者的 bonus 另計。 */
export function haulValue(ep: EpView, me: string, mission: TrackMission): number {
  const track = trackOf(ep, mission)!;
  const values = EP_TRACK_VALUES[mission];
  const at = track.positions[me] ?? 0;
  const score = (space: number): number => (space > 0 ? values[space - 1]! : 0);
  let gain = 0;
  let hauls = 0;
  for (let space = at + 1; space <= values.length && gain === 0; space++) {
    hauls += 1;
    gain = score(space) - score(at);
  }
  const best = Math.max(0, ...Object.entries(track.positions).filter(([id]) => id !== me).map(([, space]) => space));
  const lead = at + 1 > best && track.leader !== me ? EP_TRACK_BONUS : 0;
  return Math.max(PROGRESS_VALUE, gain / Math.max(1, hauls)) + lead;
}

type Farm = Extract<EpView['sites'][number], { kind: 'spice' }>;

/** 自己還沒放 crew 的香料農場（香料軌道還沒走完才算）。 */
export function farmsToCrew(ep: EpView, me: string): Farm[] {
  if (!trackOpen(ep, me, 'spices')) return [];
  return ep.sites.filter((site): site is Farm => site.kind === 'spice' && !site.crews.includes(me));
}

/** 自己有 crew 而且還沒裝走香料袋的農場。 */
export function farmsToLoad(ep: EpView, me: string): Farm[] {
  if (!trackOpen(ep, me, 'spices')) return [];
  return ep.sites.filter((site): site is Farm => site.kind === 'spice' && site.crews.includes(me) && site.sacks.includes(me));
}
