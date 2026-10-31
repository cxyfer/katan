/**
 * 音效偏好：靜音、效果音量與背景音樂音量，存在瀏覽器本機（docs/SPEC.md §8.2
 * 要求尊重靜音偏好）。與語系、暱稱相同，持久化只是便利，讀寫失敗一律退回預設值。
 */

import type { StorageLike } from '../state/session.ts';

export const AUDIO_KEY = 'catan.audio';

export interface AudioPreferences {
  muted: boolean;
  /** 0–100，效果音（事件提示）音量。 */
  effects: number;
  /** 0–100，背景音樂與環境聲音量。 */
  music: number;
}

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = Object.freeze({
  muted: false,
  effects: 70,
  music: 35,
});

function level(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function normalizeAudioPreferences(value: unknown): AudioPreferences {
  const raw = value && typeof value === 'object' ? value as Partial<Record<keyof AudioPreferences, unknown>> : {};
  return {
    muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_AUDIO_PREFERENCES.muted,
    effects: level(raw.effects, DEFAULT_AUDIO_PREFERENCES.effects),
    music: level(raw.music, DEFAULT_AUDIO_PREFERENCES.music),
  };
}

export function readStoredAudio(storage: StorageLike): AudioPreferences {
  try {
    const raw = storage.getItem(AUDIO_KEY);
    return normalizeAudioPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

export function writeStoredAudio(storage: StorageLike, preferences: AudioPreferences): void {
  try {
    storage.setItem(AUDIO_KEY, JSON.stringify(normalizeAudioPreferences(preferences)));
  } catch {
    // 私密瀏覽等情況下無法寫入；偏好只在本次分頁有效。
  }
}

/** 滑桿刻度轉為增益：平方曲線較接近聽感上的線性音量。 */
export function levelToGain(value: number): number {
  const clamped = level(value, 0) / 100;
  return clamped * clamped;
}
